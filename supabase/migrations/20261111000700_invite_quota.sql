-- Etapa 2 (validação na pilha real) · Limite de convites ATÔMICO e anterior ao envio do e-mail.
--
-- Problema do desenho anterior: o limite contava vínculos já criados e era checado no pré-check e no
-- create_membership, mas o e-mail do convite é enviado ENTRE os dois. Com chamadas simultâneas, N
-- requisições passavam pelo pré-check ao mesmo tempo e todas enviavam e-mail antes de qualquer vínculo
-- ser gravado: o limite não protegia o que pretendia proteger.
--
-- Agora: a Edge Function reserva uma "vaga" (reserve_invite_slot) logo após o pré-check e ANTES de
-- consultar contas ou enviar e-mail. A reserva é serializada por pessoa com uma trava consultiva e
-- gravada em transação própria, então chamadas simultâneas enxergam as reservas umas das outras.
-- Tentativas contam mesmo que o cadastro falhe depois (é o envio de e-mail que se quer limitar).

drop index if exists public.memberships_created_by_idx;

create table public.invite_attempts (
  id          bigint generated always as identity primary key,
  actor_id    uuid not null,
  created_at  timestamptz not null default clock_timestamp()
);
create index invite_attempts_actor_idx on public.invite_attempts (actor_id, created_at desc);
alter table public.invite_attempts enable row level security; -- sem políticas: ninguém lê pela API
revoke all on public.invite_attempts from public, anon, authenticated;

create function public.reserve_invite_slot() returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := private.active_uid();
  v_n int;
begin
  if v_uid is null then
    perform private.fail('PT401', 'Sessão inválida ou conta desativada. Entre novamente.');
  end if;
  if private.is_general_admin() then return; end if; -- administrador geral não é limitado
  -- Serializa por pessoa: quem chega depois só conta DEPOIS de a reserva anterior ser confirmada.
  perform pg_advisory_xact_lock(hashtextextended('invite:' || v_uid::text, 0));
  delete from public.invite_attempts where actor_id = v_uid and created_at < now() - interval '1 day';
  select count(*) into v_n from public.invite_attempts
   where actor_id = v_uid and created_at > now() - interval '1 hour';
  if v_n >= 30 then
    perform private.fail('PT429', 'Limite de convites por hora atingido. Tente novamente mais tarde.');
  end if;
  insert into public.invite_attempts (actor_id) values (v_uid);
end
$$;

-- O limite agora vive em reserve_invite_slot; a autorização de vínculo volta a ser só autorização.
create or replace function private.authorize_membership_creation(p_store uuid, p_role text, p_permissions jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_perms jsonb;
begin
  if private.active_uid() is null then
    perform private.fail('PT401', 'Sessão inválida ou conta desativada. Entre novamente.');
  end if;
  if not exists (select 1 from public.stores s where s.id = p_store) then
    perform private.fail('PT404', 'Loja não encontrada.');
  end if;
  if not private.can_manage_team(p_store, 'create') then
    perform private.fail('PT403', 'Você não tem permissão para cadastrar pessoas nesta loja.');
  end if;
  if p_role is null or p_role not in ('responsavel', 'funcionario') then
    perform private.fail('PT422', 'Perfil inválido.', 'role');
  end if;
  if p_role <> 'funcionario' and not private.is_general_admin() then
    perform private.fail('PT403', 'Somente o administrador geral pode conceder o papel de responsável.');
  end if;
  v_perms := private.normalize_permissions(p_permissions, p_role);
  if v_perms = '{}'::jsonb then
    perform private.fail('PT422', 'Libere ao menos um módulo (visualizar) para que a pessoa consiga acessar a loja.', 'permissions');
  end if;
  if private.permissions_beyond(private.actor_permissions(p_store), '{}'::jsonb, v_perms) then
    perform private.fail('PT403', 'Você não pode conceder permissões que você mesmo não possui.');
  end if;
  return v_perms;
end
$$;

revoke execute on all functions in schema private from public, anon, authenticated;
grant execute on function
  private.is_general_admin(), private.can_see_store(uuid), private.has_permission(uuid, text, text),
  private.actor_role(uuid), private.active_uid()
  to authenticated;
grant execute on all functions in schema private to service_role;

revoke all on function public.reserve_invite_slot() from public, anon, authenticated, service_role;
grant execute on function public.reserve_invite_slot() to authenticated;

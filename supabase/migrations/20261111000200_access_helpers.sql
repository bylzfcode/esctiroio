-- Etapa 2 · Funções de autorização usadas pelo RLS e pelas RPCs.
-- Sempre derivam a identidade de auth.uid() (JWT validado pela API); nunca de parâmetros.
-- SECURITY DEFINER evita recursão do RLS; search_path vazio evita sequestro de nomes.
-- Todas leem o estado ATUAL das tabelas: desativar um vínculo vale na próxima consulta.

-- Conta autenticada E ativa (senão, nulo).
create function private.active_uid() returns uuid
language sql stable security definer set search_path = '' as $$
  select p.id from public.profiles p where p.id = auth.uid() and p.active
$$;

create function private.is_general_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.active and p.is_general_admin
  )
$$;

-- Perfil efetivo do chamador na loja: 'admin_geral', 'responsavel', 'funcionario' ou nulo.
-- Vínculo inativo, loja inativa ou conta inativa => nulo (sem acesso).
create function private.actor_role(p_store uuid) returns text
language sql stable security definer set search_path = '' as $$
  select case
    when private.is_general_admin() then 'admin_geral'
    else (
      select m.role
      from public.memberships m
      join public.stores s on s.id = m.store_id
      join public.profiles p on p.id = m.person_id
      where m.person_id = auth.uid() and m.store_id = p_store
        and m.active and s.active and p.active
    )
  end
$$;

create function private.actor_permissions(p_store uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_role text := private.actor_role(p_store);
  v_perms jsonb;
begin
  if v_role is null then return '{}'::jsonb; end if;
  if v_role = 'admin_geral' then return private.full_permissions(); end if;
  select private.normalize_permissions(m.permissions, m.role) into v_perms
  from public.memberships m where m.person_id = auth.uid() and m.store_id = p_store;
  return coalesce(v_perms, '{}'::jsonb);
end
$$;

create function private.has_permission(p_store uuid, p_module text, p_action text) returns boolean
language sql stable security definer set search_path = '' as $$
  select private.perm_has(private.actor_permissions(p_store), p_module, p_action)
$$;

-- Gerir equipe exige perfil de responsável (ou admin) E a ação liberada no módulo.
create function private.can_manage_team(p_store uuid, p_action text) returns boolean
language sql stable security definer set search_path = '' as $$
  select private.actor_role(p_store) in ('admin_geral', 'responsavel')
     and private.has_permission(p_store, 'team', p_action)
$$;

create function private.can_see_store(p_store uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select private.actor_role(p_store) is not null
$$;

-- Erros previsíveis. Os códigos "PT4xx" fazem o PostgREST responder com o status HTTP
-- correspondente; "hint" carrega o nome do campo do formulário, quando houver.
create function private.fail(p_code text, p_message text, p_field text default null) returns void
language plpgsql set search_path = '' as $$
begin
  -- RAISE não aceita HINT nulo.
  if p_field is null then
    raise exception '%', p_message using errcode = p_code;
  end if;
  raise exception '%', p_message using errcode = p_code, hint = p_field;
end
$$;

-- Execução: nada é público. O RLS (papel authenticated) precisa destas funções.
revoke execute on all functions in schema private from public, anon, authenticated;
grant execute on function
  private.is_general_admin(), private.can_see_store(uuid), private.has_permission(uuid, text, text),
  private.actor_role(uuid), private.active_uid()
  to authenticated;
-- service_role: necessário para a CHECK de permissões em inserções administrativas diretas.
grant execute on all functions in schema private to service_role;

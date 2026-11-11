-- Etapa 2 · Funções RPC: única porta de escrita para usuários autenticados.
-- Cada função: (1) deriva o ator de auth.uid(); (2) confere autorização no servidor;
-- (3) valida; (4) altera. A auditoria é gravada por gatilho, na mesma transação.
-- Mensagens em português; "hint" = campo do formulário; SQLSTATE PT4xx = status HTTP.

-- ---------------------------------------------------------------------------
-- Verificações compartilhadas
-- ---------------------------------------------------------------------------

-- Autoriza a criação de um vínculo e devolve as permissões normalizadas.
create function private.authorize_membership_creation(p_store uuid, p_role text, p_permissions jsonb)
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
  -- Freio contra abuso: cada cadastro bem-sucedido pode disparar um e-mail de convite a terceiros.
  -- O limite do serviço de e-mail é global; este é por pessoa (administrador geral não é limitado).
  if not private.is_general_admin() and (
       select count(*) from public.memberships m
       where m.created_by = auth.uid() and m.created_at > now() - interval '1 hour') >= 30 then
    perform private.fail('PT429', 'Limite de cadastros por hora atingido. Tente novamente mais tarde.');
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

-- Regras sobre o ALVO de edição/desativação: admin gerencia qualquer vínculo; responsável
-- gerencia apenas funcionários, nunca outros responsáveis nem o próprio vínculo.
create function private.authorize_membership_target(p_membership public.memberships, p_action text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if private.active_uid() is null then
    perform private.fail('PT401', 'Sessão inválida ou conta desativada. Entre novamente.');
  end if;
  if not private.can_manage_team(p_membership.store_id, p_action) then
    perform private.fail('PT403', 'Você não tem permissão para esta ação na equipe desta loja.');
  end if;
  if private.is_general_admin() then return; end if;
  if p_membership.person_id = auth.uid() then
    perform private.fail('PT403', 'Você não pode alterar o seu próprio vínculo.');
  end if;
  if p_membership.role <> 'funcionario' then
    perform private.fail('PT403', 'Responsáveis não podem alterar outros responsáveis.');
  end if;
end
$$;

create function private.require_general_admin() returns void
language plpgsql security definer set search_path = '' as $$
begin
  if private.active_uid() is null then
    perform private.fail('PT401', 'Sessão inválida ou conta desativada. Entre novamente.');
  end if;
  if not private.is_general_admin() then
    perform private.fail('PT403', 'Esta ação é exclusiva do administrador geral.');
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- Escrita
-- ---------------------------------------------------------------------------

-- Validação prévia do convite, sem efeito colateral e SEM revelar se o e-mail tem conta.
create function public.precheck_member_invite(p_store_id uuid, p_email text, p_role text, p_permissions jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare v_email text := lower(btrim(coalesce(p_email, ''))); v_target public.profiles;
begin
  perform private.authorize_membership_creation(p_store_id, p_role, p_permissions);
  if v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
    perform private.fail('PT422', 'Informe um e-mail válido.', 'email');
  end if;
  select * into v_target from public.profiles p where p.email = v_email;
  if found then
    -- Mesma mensagem para contas inexistentes na lista de e-mails vinculáveis e para administradores.
    if v_target.is_general_admin then
      perform private.fail('PT422', 'Este e-mail não pode ser vinculado a esta loja.', 'email');
    end if;
    if exists (select 1 from public.memberships m where m.person_id = v_target.id and m.store_id = p_store_id and m.active) then
      perform private.fail('PT409', 'Esta pessoa já está vinculada à loja.', 'email');
    end if;
    if exists (select 1 from public.memberships m where m.person_id = v_target.id and m.store_id = p_store_id) then
      perform private.fail('PT409', 'Esta pessoa tem um vínculo desativado nesta loja. Reative-o na lista de inativos.', 'email');
    end if;
  end if;
end
$$;

-- Cria SOMENTE o vínculo para uma conta já existente e ativa (a conta é criada pela Edge Function).
create function public.create_membership(
  p_store_id uuid, p_person_id uuid, p_role text, p_job_title text, p_permissions jsonb
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_perms jsonb; v_target public.profiles; v_job text := btrim(coalesce(p_job_title, '')); v_id uuid;
begin
  v_perms := private.authorize_membership_creation(p_store_id, p_role, p_permissions);
  if char_length(v_job) > 60 then
    perform private.fail('PT422', 'Use no máximo 60 caracteres.', 'jobTitle');
  end if;
  select * into v_target from public.profiles p where p.id = p_person_id;
  if not found or not v_target.active then
    perform private.fail('PT422', 'Não foi possível vincular esta conta.', 'email');
  end if;
  if v_target.is_general_admin then
    perform private.fail('PT422', 'Este e-mail não pode ser vinculado a esta loja.', 'email');
  end if;
  if exists (select 1 from public.memberships m where m.person_id = p_person_id and m.store_id = p_store_id) then
    perform private.fail('PT409', 'Esta pessoa já tem vínculo (ativo ou desativado) com esta loja.', 'email');
  end if;
  insert into public.memberships (person_id, store_id, role, job_title, permissions, created_by)
  values (p_person_id, p_store_id, p_role, v_job, v_perms, auth.uid())
  returning id into v_id;
  return v_id;
end
$$;

create function public.update_membership(
  p_membership_id uuid, p_job_title text, p_role text, p_permissions jsonb, p_account_name text default null
) returns void language plpgsql security definer set search_path = '' as $$
declare
  v_m public.memberships; v_perms jsonb; v_job text := btrim(coalesce(p_job_title, ''));
  v_name text := btrim(p_account_name); v_current text;
begin
  select * into v_m from public.memberships m where m.id = p_membership_id for update;
  if not found then perform private.fail('PT404', 'Vínculo não encontrado.'); end if;
  perform private.authorize_membership_target(v_m, 'edit');
  if not v_m.active then
    perform private.fail('PT409', 'Reative o vínculo antes de editá-lo.');
  end if;
  if p_role is null or p_role not in ('responsavel', 'funcionario') then
    perform private.fail('PT422', 'Perfil inválido.', 'role');
  end if;
  if p_role <> v_m.role and not private.is_general_admin() then
    perform private.fail('PT403', 'Somente o administrador geral pode alterar o perfil de um vínculo.');
  end if;
  if char_length(v_job) > 60 then
    perform private.fail('PT422', 'Use no máximo 60 caracteres.', 'jobTitle');
  end if;
  v_perms := private.normalize_permissions(p_permissions, p_role);
  if v_perms = '{}'::jsonb then
    perform private.fail('PT422', 'Libere ao menos um módulo (visualizar) para que a pessoa consiga acessar a loja.', 'permissions');
  end if;
  if private.permissions_beyond(private.actor_permissions(v_m.store_id), v_m.permissions, v_perms) then
    perform private.fail('PT403', 'Você não pode conceder nem retirar permissões que você mesmo não possui.');
  end if;

  -- Nome da conta (dado compartilhado entre lojas): só o administrador geral altera, na MESMA transação.
  if v_name is not null then
    select p.full_name into v_current from public.profiles p where p.id = v_m.person_id;
    if v_name is distinct from v_current then
      if not private.is_general_admin() then
        perform private.fail('PT403', 'Somente o administrador geral pode alterar dados da conta.');
      end if;
      if char_length(v_name) < 2 or char_length(v_name) > 120 then
        perform private.fail('PT422', 'Informe o nome da pessoa.', 'name');
      end if;
      update public.profiles set full_name = v_name where id = v_m.person_id;
    end if;
  end if;

  update public.memberships set job_title = v_job, role = p_role, permissions = v_perms where id = v_m.id;
end
$$;

create function public.set_membership_active(p_membership_id uuid, p_active boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare v_m public.memberships;
begin
  select * into v_m from public.memberships m where m.id = p_membership_id for update;
  if not found then perform private.fail('PT404', 'Vínculo não encontrado.'); end if;
  perform private.authorize_membership_target(v_m, case when p_active then 'edit' else 'delete' end);
  if v_m.active = p_active then return; end if;
  -- Muda só ESTE vínculo: a conta, os demais vínculos e o histórico permanecem.
  update public.memberships
     set active = p_active, deactivated_at = case when p_active then null else now() end
   where id = v_m.id;
end
$$;

-- Exclusivas do administrador geral ------------------------------------------------------

create function public.set_general_admin(p_person_id uuid, p_value boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare v_target public.profiles;
begin
  perform private.require_general_admin();
  select * into v_target from public.profiles p where p.id = p_person_id for update;
  if not found then perform private.fail('PT404', 'Conta não encontrada.'); end if;
  if p_value and not v_target.active then
    perform private.fail('PT422', 'A conta precisa estar ativa para receber o papel de administrador geral.');
  end if;
  update public.profiles set is_general_admin = p_value where id = p_person_id;  -- gatilho protege o último admin
end
$$;

create function public.set_account_active(p_person_id uuid, p_active boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare v_target public.profiles;
begin
  perform private.require_general_admin();
  select * into v_target from public.profiles p where p.id = p_person_id for update;
  if not found then perform private.fail('PT404', 'Conta não encontrada.'); end if;
  if v_target.activated_at is null then
    perform private.fail('PT409', 'Esta conta ainda não foi ativada por convite.');
  end if;
  update public.profiles set active = p_active where id = p_person_id;
end
$$;

-- Somente service_role (Edge Function): ativa a conta recém-convidada, uma única vez.
-- "p_invited_by" é o usuário já validado pelo JWT na função; entra como ator na auditoria.
create function public.activate_profile(p_id uuid, p_name text, p_invited_by uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform set_config('app.actor_id', coalesce(p_invited_by::text, ''), true);
  update public.profiles
     set active = true, activated_at = now(), full_name = left(btrim(coalesce(p_name, '')), 120)
   where id = p_id and activated_at is null;
end
$$;

-- ---------------------------------------------------------------------------
-- Leitura filtrada (dados de outras pessoas só por aqui)
-- ---------------------------------------------------------------------------

create function private.person_json(p public.profiles) returns jsonb
language sql immutable set search_path = '' as $$
  select jsonb_build_object('id', p.id, 'email', p.email, 'full_name', p.full_name,
                            'is_general_admin', p.is_general_admin, 'active', p.active, 'created_at', p.created_at)
$$;

create function public.list_store_members(p_store_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_admin boolean := private.is_general_admin();
begin
  if private.active_uid() is null then
    perform private.fail('PT401', 'Sessão inválida ou conta desativada. Entre novamente.');
  end if;
  if not private.has_permission(p_store_id, 'team', 'view') then
    perform private.fail('PT403', 'Você não tem permissão para ver a equipe desta loja.');
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'membership', to_jsonb(m) - 'created_by',
             'person', private.person_json(p),
             'active_store_count', case when v_admin then
               (select count(*) from public.memberships x where x.person_id = p.id and x.active) end)
           order by m.active desc, (m.role <> 'responsavel'), lower(p.full_name), p.email)
    from public.memberships m join public.profiles p on p.id = m.person_id
    where m.store_id = p_store_id
  ), '[]'::jsonb);
end
$$;

create function public.list_all_people() returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_general_admin();
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'person', private.person_json(p),
             'links', coalesce((
               select jsonb_agg(jsonb_build_object('membership', to_jsonb(m) - 'created_by', 'store_name', s.name)
                                order by s.name)
               from public.memberships m join public.stores s on s.id = m.store_id
               where m.person_id = p.id), '[]'::jsonb))
           order by lower(p.full_name), p.email)
    from public.profiles p where p.activated_at is not null
  ), '[]'::jsonb);
end
$$;

create function private.team_stats(p_store uuid) returns jsonb
language sql security definer set search_path = '' as $$
  select jsonb_build_object(
    'responsibles', coalesce((select jsonb_agg(coalesce(nullif(p.full_name, ''), p.email) order by lower(p.full_name))
        from public.memberships m join public.profiles p on p.id = m.person_id
        where m.store_id = p_store and m.active and m.role = 'responsavel' and p.active), '[]'::jsonb),
    'active_employees', (select count(*) from public.memberships m join public.profiles p on p.id = m.person_id
        where m.store_id = p_store and m.active and m.role = 'funcionario' and p.active),
    'inactive_links', (select count(*) from public.memberships m where m.store_id = p_store and not m.active))
$$;

create function public.store_summary(p_store_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_store public.stores;
begin
  if private.active_uid() is null then
    perform private.fail('PT401', 'Sessão inválida ou conta desativada. Entre novamente.');
  end if;
  if not private.has_permission(p_store_id, 'overview', 'view') then
    perform private.fail('PT403', 'Você não tem acesso à visão geral desta loja.');
  end if;
  select * into v_store from public.stores s where s.id = p_store_id;
  return jsonb_build_object(
    'store', jsonb_build_object('id', v_store.id, 'name', v_store.name, 'code', v_store.code),
    'team', case when private.has_permission(p_store_id, 'team', 'view') then private.team_stats(p_store_id) end,
    'last_activity_at', case when private.has_permission(p_store_id, 'activity', 'view')
        then (select max(a.created_at) from public.audit_log a where a.store_id = p_store_id) end);
end
$$;

create function public.consolidated_summary() returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_general_admin();
  return jsonb_build_object(
    'stores', coalesce((select jsonb_agg(jsonb_build_object(
        'store', jsonb_build_object('id', s.id, 'name', s.name, 'code', s.code),
        'team', private.team_stats(s.id),
        'last_activity_at', (select max(a.created_at) from public.audit_log a where a.store_id = s.id))
        order by s.name) from public.stores s), '[]'::jsonb),
    'people_with_access', (select count(distinct m.person_id) from public.memberships m
        join public.profiles p on p.id = m.person_id where m.active and p.active),
    'active_links', (select count(*) from public.memberships m where m.active),
    'inactive_links', (select count(*) from public.memberships m where not m.active));
end
$$;

-- ---------------------------------------------------------------------------
-- Permissões de execução (por padrão o Postgres concede EXECUTE a PUBLIC)
-- ---------------------------------------------------------------------------
revoke execute on all functions in schema private from public, anon, authenticated;
grant execute on function
  private.is_general_admin(), private.can_see_store(uuid), private.has_permission(uuid, text, text),
  private.actor_role(uuid), private.active_uid()
  to authenticated;
grant execute on all functions in schema private to service_role;

revoke all on function
  public.precheck_member_invite(uuid, text, text, jsonb), public.create_membership(uuid, uuid, text, text, jsonb),
  public.update_membership(uuid, text, text, jsonb, text), public.set_membership_active(uuid, boolean),
  public.set_general_admin(uuid, boolean), public.set_account_active(uuid, boolean),
  public.activate_profile(uuid, text, uuid),
  public.list_store_members(uuid), public.list_all_people(), public.store_summary(uuid), public.consolidated_summary()
  from public, anon, authenticated, service_role;

grant execute on function
  public.precheck_member_invite(uuid, text, text, jsonb), public.create_membership(uuid, uuid, text, text, jsonb),
  public.update_membership(uuid, text, text, jsonb, text), public.set_membership_active(uuid, boolean),
  public.set_general_admin(uuid, boolean), public.set_account_active(uuid, boolean),
  public.list_store_members(uuid), public.list_all_people(), public.store_summary(uuid), public.consolidated_summary()
  to authenticated;

-- Somente a Edge Function (service_role) ativa contas.
grant execute on function public.activate_profile(uuid, text, uuid) to service_role;

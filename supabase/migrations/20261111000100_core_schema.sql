-- Etapa 2 · Esquema central: lojas, contas (profiles), vínculos (memberships) e auditoria.
--
-- Princípios:
--  * Conta (profiles) e vínculo com a loja (memberships) são tabelas separadas.
--  * Nenhum papel de API (anon/authenticated) escreve diretamente nas tabelas:
--    toda alteração passa por funções RPC com autorização no servidor (migração 5).
--  * Funções auxiliares ficam no schema "private", que NÃO é exposto pela API.

create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Catálogo de módulos/ações (espelha src/domain/modules.ts)
-- ---------------------------------------------------------------------------

create function private.all_modules() returns text[]
language sql immutable parallel safe set search_path = '' as $$
  select array['overview', 'finance', 'team', 'calendar', 'activity', 'settings']
$$;

create function private.all_actions() returns text[]
language sql immutable parallel safe set search_path = '' as $$
  select array['view', 'create', 'edit', 'delete', 'export']
$$;

-- Ações que fazem sentido em cada módulo.
create function private.module_actions(p_module text) returns text[]
language sql immutable parallel safe set search_path = '' as $$
  select case p_module
    when 'overview' then array['view']
    when 'finance'  then array['view', 'create', 'edit', 'delete', 'export']
    when 'team'     then array['view', 'create', 'edit', 'delete', 'export']
    when 'calendar' then array['view', 'create', 'edit', 'delete', 'export']
    when 'activity' then array['view', 'export']
    when 'settings' then array['view']
  end
$$;

-- Teto por perfil: funcionários só consultam "Equipe e permissões".
create function private.role_ceiling(p_role text, p_module text) returns text[]
language sql immutable parallel safe set search_path = '' as $$
  select case when p_role = 'funcionario' and p_module = 'team'
              then array['view'] else private.module_actions(p_module) end
$$;

create function private.full_permissions() returns jsonb
language sql immutable parallel safe set search_path = '' as $$
  select coalesce(jsonb_object_agg(m, to_jsonb(private.module_actions(m))), '{}'::jsonb)
  from unnest(private.all_modules()) m
$$;

create function private.perm_has(p_perms jsonb, p_module text, p_action text) returns boolean
language sql immutable parallel safe set search_path = '' as $$
  select coalesce((p_perms -> p_module) ? p_action, false)
$$;

-- Remove módulos/ações inválidos, aplica o teto do perfil e exige "view".
create function private.normalize_permissions(p_perms jsonb, p_role text) returns jsonb
language sql immutable parallel safe set search_path = '' as $$
  select coalesce(jsonb_object_agg(t.m, t.acts), '{}'::jsonb)
  from (
    select m,
           to_jsonb(array(
             select a from unnest(private.all_actions()) with ordinality u(a, ord)
             where a = any (private.role_ceiling(p_role, m))
               and private.perm_has(p_perms, m, a)
             order by ord
           )) as acts
    from unnest(private.all_modules()) m
  ) t
  where t.acts ? 'view'
$$;

-- Formato estrito aceito no banco (a normalização acima produz sempre um formato válido).
create function private.valid_permissions(p_perms jsonb, p_role text) returns boolean
language plpgsql immutable parallel safe set search_path = '' as $$
declare
  k text; v jsonb; acts text[]; a text;
begin
  if p_perms is null or jsonb_typeof(p_perms) <> 'object' then return false; end if;
  for k, v in select * from jsonb_each(p_perms) loop
    if private.module_actions(k) is null or jsonb_typeof(v) <> 'array' or jsonb_array_length(v) = 0 then
      return false;
    end if;
    acts := array(select jsonb_array_elements_text(v));
    foreach a in array acts loop
      if not (a = any (private.role_ceiling(p_role, k))) then return false; end if;
    end loop;
    if not ('view' = any (acts)) then return false; end if;
    if cardinality(acts) <> (select count(distinct x) from unnest(acts) x) then return false; end if;
  end loop;
  return true;
end
$$;

-- Há alguma mudança (conceder OU retirar) fora das permissões de quem altera?
create function private.permissions_beyond(p_actor jsonb, p_before jsonb, p_after jsonb) returns boolean
language sql immutable parallel safe set search_path = '' as $$
  select exists (
    select 1
    from unnest(private.all_modules()) m cross join unnest(private.all_actions()) a
    where private.perm_has(p_before, m, a) <> private.perm_has(p_after, m, a)
      and not private.perm_has(p_actor, m, a)
  )
$$;

-- Descrição textual das diferenças, para a auditoria. Ex.: "Calendário: liberou editar".
create function private.permissions_diff_text(p_before jsonb, p_after jsonb) returns text
language sql immutable parallel safe set search_path = '' as $$
  select string_agg(
           format('%s: %s %s',
             case m when 'overview' then 'Visão geral' when 'finance' then 'Financeiro'
                    when 'team' then 'Equipe e permissões' when 'calendar' then 'Calendário'
                    when 'activity' then 'Histórico de atividades' else 'Configurações' end,
             case when private.perm_has(p_after, m, a) then 'liberou' else 'retirou' end,
             case a when 'view' then 'visualizar' when 'create' then 'criar' when 'edit' then 'editar'
                    when 'delete' then 'excluir' else 'exportar' end),
           '; ' order by mo, ao)
  from unnest(private.all_modules()) with ordinality mm(m, mo)
  cross join unnest(private.all_actions()) with ordinality aa(a, ao)
  where private.perm_has(p_before, m, a) <> private.perm_has(p_after, m, a)
$$;

-- ---------------------------------------------------------------------------
-- Tabelas
-- ---------------------------------------------------------------------------

create table public.stores (
  id          uuid primary key default gen_random_uuid(),
  code        text not null unique check (code ~ '^[A-Za-z0-9-]{2,12}$'),
  name        text not null check (char_length(btrim(name)) between 2 and 80),
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);

-- Uma linha por conta de autenticação. NÃO guarda perfil de loja nem permissões.
create table public.profiles (
  id                uuid primary key references auth.users (id) on delete restrict,
  email             text not null
                      check (email = lower(btrim(email)) and email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'),
  full_name         text not null default '' check (char_length(full_name) <= 120),
  is_general_admin  boolean not null default false,
  -- Contas nascem INATIVAS: só convite validado no servidor (ou bootstrap) ativa.
  -- Assim, um cadastro público acidentalmente habilitado não dá acesso a nada.
  active            boolean not null default false,
  activated_at      timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  check (active = false or activated_at is not null)
);
create unique index profiles_email_key on public.profiles (email);

-- Vínculo da conta com UMA loja: perfil, cargo e permissões valem só nela.
create table public.memberships (
  id              uuid primary key default gen_random_uuid(),
  person_id       uuid not null references public.profiles (id) on delete restrict,
  store_id        uuid not null references public.stores (id) on delete restrict,
  role            text not null check (role in ('responsavel', 'funcionario')),
  job_title       text not null default '' check (char_length(job_title) <= 60),
  permissions     jsonb not null default '{}'::jsonb,
  active          boolean not null default true,
  created_by      uuid,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  deactivated_at  timestamptz,
  unique (person_id, store_id),
  constraint memberships_permissions_valid check (private.valid_permissions(permissions, role)),
  constraint memberships_deactivation_consistent
    check ((active and deactivated_at is null) or (not active and deactivated_at is not null))
);
create index memberships_store_idx on public.memberships (store_id);
create index memberships_person_idx on public.memberships (person_id);
create index memberships_created_by_idx on public.memberships (created_by, created_at); -- limite de cadastros por hora

-- Auditoria append-only. Sem chaves estrangeiras: o histórico sobrevive a qualquer desativação.
create table public.audit_log (
  id                  uuid primary key default gen_random_uuid(),
  -- Ordem estrita dos eventos, mesmo com timestamps iguais.
  seq                 bigint generated always as identity,
  -- clock_timestamp(): hora real do evento (now() é constante dentro de uma transação).
  created_at          timestamptz not null default clock_timestamp(),
  actor_id            uuid,            -- null = operação de sistema (SQL/serviço sem usuário)
  actor_name          text not null,
  store_id            uuid,            -- null = evento global (ex.: administrador geral)
  store_name          text,
  action              text not null check (action in (
                        'conta_criada', 'conta_editada', 'conta_desativada', 'conta_reativada',
                        'admin_concedido', 'admin_removido',
                        'vinculo_criado', 'vinculo_editado', 'permissoes_alteradas',
                        'vinculo_desativado', 'vinculo_reativado')),
  target_person_id    uuid,
  target_person_name  text,
  summary             text not null,
  details             jsonb not null default '{}'::jsonb
);
create index audit_log_store_idx on public.audit_log (store_id, seq desc);
create index audit_log_created_idx on public.audit_log (seq desc);

-- ---------------------------------------------------------------------------
-- Privilégios: papéis de API só LEEM (e ainda assim filtrados por RLS).
-- Os privilégios padrão do Supabase concedem tudo a anon/authenticated em novas tabelas.
-- ---------------------------------------------------------------------------
revoke all on public.stores, public.profiles, public.memberships, public.audit_log from public, anon, authenticated;
grant select on public.stores, public.profiles, public.memberships, public.audit_log to authenticated;

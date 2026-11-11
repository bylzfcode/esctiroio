-- Etapa 2 · Row Level Security.
-- Sem política de INSERT/UPDATE/DELETE: papéis de API não escrevem nas tabelas
-- (e os privilégios de escrita já foram revogados). Escritas só via RPC (migração 5).
-- "anon" não tem nenhuma política nem privilégio: não lê nada.

alter table public.stores      enable row level security;
alter table public.profiles    enable row level security;
alter table public.memberships enable row level security;
alter table public.audit_log   enable row level security;

-- Lojas: administrador geral vê todas; os demais, só as que têm vínculo ativo.
create policy stores_select on public.stores
  for select to authenticated
  using (private.can_see_store(id));

-- Contas: cada pessoa lê apenas a própria (e só se ativa); administrador geral lê todas.
-- Dados de outras pessoas chegam somente por RPC, filtrados por loja e permissão.
create policy profiles_select_self on public.profiles
  for select to authenticated
  using (id = (select auth.uid()) and active);

create policy profiles_select_admin on public.profiles
  for select to authenticated
  using (private.is_general_admin());

-- Vínculos: o próprio (ativo, em loja ativa), todos para o administrador geral, ou os da
-- loja para quem tem "visualizar" em Equipe e permissões nela.
create policy memberships_select on public.memberships
  for select to authenticated
  using (
    (person_id = (select auth.uid()) and private.actor_role(store_id) is not null)
    or private.is_general_admin()
    or private.has_permission(store_id, 'team', 'view')
  );

-- Auditoria: global só para administrador geral; por loja, para quem tem "visualizar" em Histórico.
create policy audit_select on public.audit_log
  for select to authenticated
  using (
    private.is_general_admin()
    or (store_id is not null and private.has_permission(store_id, 'activity', 'view'))
  );

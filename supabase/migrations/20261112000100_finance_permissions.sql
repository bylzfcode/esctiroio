-- Financeiro (parte 1) · Novas ações de permissão, SOMENTE no módulo Financeiro.
--   settle       = confirmar liquidação (pagamento/recebimento) e anexar comprovante
--   reverse      = estornar liquidação
--   confirm_send = registrar que o comprovante foi enviado (manualmente)
-- "delete" em Financeiro significa CANCELAR conta (nada é apagado).
--
-- NENHUMA permissão existente é alterada: vínculos já gravados continuam exatamente como estão e, portanto,
-- NÃO recebem as novas ações. Quem as concede é o administrador geral (ou quem já as possui, até o limite
-- das próprias permissões). O administrador geral tem "tudo" por definição (full_permissions).

create or replace function private.all_actions() returns text[]
language sql immutable parallel safe set search_path = '' as $$
  select array['view', 'create', 'edit', 'delete', 'export', 'settle', 'reverse', 'confirm_send']
$$;

create or replace function private.module_actions(p_module text) returns text[]
language sql immutable parallel safe set search_path = '' as $$
  select case p_module
    when 'overview' then array['view']
    when 'finance'  then array['view', 'create', 'edit', 'delete', 'export', 'settle', 'reverse', 'confirm_send']
    when 'team'     then array['view', 'create', 'edit', 'delete', 'export']
    when 'calendar' then array['view', 'create', 'edit', 'delete', 'export']
    when 'activity' then array['view', 'export']
    when 'settings' then array['view']
  end
$$;

create or replace function private.permissions_diff_text(p_before jsonb, p_after jsonb) returns text
language sql immutable parallel safe set search_path = '' as $$
  select string_agg(
           format('%s: %s %s',
             case m when 'overview' then 'Visão geral' when 'finance' then 'Financeiro'
                    when 'team' then 'Equipe e permissões' when 'calendar' then 'Calendário'
                    when 'activity' then 'Histórico de atividades' else 'Configurações' end,
             case when private.perm_has(p_after, m, a) then 'liberou' else 'retirou' end,
             case a when 'view' then 'visualizar' when 'create' then 'criar' when 'edit' then 'editar'
                    when 'delete' then case when m = 'finance' then 'cancelar conta' else 'excluir' end
                    when 'export' then 'exportar' when 'settle' then 'confirmar liquidação'
                    when 'reverse' then 'estornar' else 'confirmar envio de comprovante' end),
           '; ' order by mo, ao)
  from unnest(private.all_modules()) with ordinality mm(m, mo)
  cross join unnest(private.all_actions()) with ordinality aa(a, ao)
  where private.perm_has(p_before, m, a) <> private.perm_has(p_after, m, a)
$$;

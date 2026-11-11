-- Financeiro (parte 1) · RPCs. Única porta de escrita; autorização SEMPRE no servidor, a partir de auth.uid().
-- Erros: PT401 sessão · PT403 sem permissão · PT404 não encontrado · PT409 conflito · PT422 validação (hint = campo).

create function private.finance_require(p_store uuid, p_action text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if private.active_uid() is null then
    perform private.fail('PT401', 'Sessão inválida ou conta desativada. Entre novamente.');
  end if;
  if not exists (select 1 from public.stores s where s.id = p_store) then
    perform private.fail('PT404', 'Loja não encontrada.');
  end if;
  if not private.has_permission(p_store, 'finance', p_action) then
    perform private.fail('PT403', 'Você não tem permissão para esta ação financeira nesta loja.');
  end if;
end
$$;

create function private.finance_validate_account(
  p_description text, p_category text, p_counterparty text, p_amount_cents bigint,
  p_competence date, p_due date, p_notes text
) returns void language plpgsql immutable set search_path = '' as $$
begin
  if char_length(btrim(coalesce(p_description, ''))) < 2 or char_length(btrim(p_description)) > 200 then
    perform private.fail('PT422', 'Informe a descrição (2 a 200 caracteres).', 'description');
  end if;
  if char_length(coalesce(p_category, '')) > 80 then perform private.fail('PT422', 'Use no máximo 80 caracteres.', 'category'); end if;
  if char_length(coalesce(p_counterparty, '')) > 120 then perform private.fail('PT422', 'Use no máximo 120 caracteres.', 'counterparty'); end if;
  if char_length(coalesce(p_notes, '')) > 1000 then perform private.fail('PT422', 'Use no máximo 1000 caracteres.', 'notes'); end if;
  if p_amount_cents is null or p_amount_cents <= 0 then
    perform private.fail('PT422', 'Informe um valor maior que zero.', 'amountCents');
  end if;
  if p_amount_cents > 99999999999 then perform private.fail('PT422', 'Valor acima do limite permitido.', 'amountCents'); end if;
  if p_competence is null or p_competence not between date '2000-01-01' and date '2100-12-31' then
    perform private.fail('PT422', 'Informe uma data de competência válida.', 'competenceDate');
  end if;
  if p_due is null or p_due not between date '2000-01-01' and date '2100-12-31' then
    perform private.fail('PT422', 'Informe um vencimento válido.', 'dueDate');
  end if;
end
$$;

-- ---------------------------------------------------------------------------------------------
-- Escrita
-- ---------------------------------------------------------------------------------------------
create function public.create_finance_account(
  p_store_id uuid, p_kind text, p_description text, p_category text, p_counterparty text,
  p_amount_cents bigint, p_competence_date date, p_due_date date, p_notes text, p_idempotency_key uuid default null
) returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  perform private.finance_require(p_store_id, 'create');
  if p_kind is null or p_kind not in ('payable', 'receivable') then perform private.fail('PT422', 'Escolha a pagar ou a receber.', 'kind'); end if;
  perform private.finance_validate_account(p_description, p_category, p_counterparty, p_amount_cents, p_competence_date, p_due_date, p_notes);
  insert into public.finance_accounts (store_id, kind, description, category, counterparty, amount_cents, competence_date, due_date, notes,
                                       idempotency_key, created_by, created_by_name)
  values (p_store_id, p_kind, btrim(p_description), btrim(coalesce(p_category, '')), btrim(coalesce(p_counterparty, '')), p_amount_cents,
          p_competence_date, p_due_date, btrim(coalesce(p_notes, '')), p_idempotency_key, auth.uid(), private.actor_display_name())
  on conflict (store_id, idempotency_key) do nothing
  returning id into v_id;
  if v_id is null then -- repetição da mesma requisição: devolve a conta já criada, sem duplicar
    select a.id into v_id from public.finance_accounts a where a.store_id = p_store_id and a.idempotency_key = p_idempotency_key;
  end if;
  return v_id;
end
$$;

create function public.update_finance_account(
  p_account_id uuid, p_description text, p_category text, p_counterparty text,
  p_amount_cents bigint, p_competence_date date, p_due_date date, p_notes text
) returns void language plpgsql security definer set search_path = '' as $$
declare v_a public.finance_accounts; v_settled bigint;
begin
  select * into v_a from public.finance_accounts a where a.id = p_account_id for update;
  if not found then perform private.fail('PT404', 'Conta não encontrada.'); end if;
  perform private.finance_require(v_a.store_id, 'edit');
  if v_a.status = 'canceled' then perform private.fail('PT409', 'Conta cancelada não pode ser editada.'); end if;
  perform private.finance_validate_account(p_description, p_category, p_counterparty, p_amount_cents, p_competence_date, p_due_date, p_notes);
  v_settled := private.finance_settled(v_a.id);
  if p_amount_cents < v_settled then
    perform private.fail('PT422', format('O valor não pode ser menor que o total já liquidado (%s).', private.fmt_brl(v_settled)), 'amountCents');
  end if;
  update public.finance_accounts
     set description = btrim(p_description), category = btrim(coalesce(p_category, '')), counterparty = btrim(coalesce(p_counterparty, '')),
         amount_cents = p_amount_cents, competence_date = p_competence_date, due_date = p_due_date, notes = btrim(coalesce(p_notes, ''))
   where id = v_a.id;
end
$$;

create function public.cancel_finance_account(p_account_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare v_a public.finance_accounts;
begin
  select * into v_a from public.finance_accounts a where a.id = p_account_id for update;
  if not found then perform private.fail('PT404', 'Conta não encontrada.'); end if;
  perform private.finance_require(v_a.store_id, 'delete');
  if char_length(btrim(coalesce(p_reason, ''))) < 3 or char_length(btrim(p_reason)) > 300 then
    perform private.fail('PT422', 'Informe o motivo do cancelamento (3 a 300 caracteres).', 'reason');
  end if;
  if v_a.status = 'canceled' then perform private.fail('PT409', 'Esta conta já está cancelada.'); end if;
  if private.finance_settled(v_a.id) > 0 then
    perform private.fail('PT409', 'Esta conta tem liquidações. Estorne-as antes de cancelar a conta.');
  end if;
  update public.finance_accounts
     set status = 'canceled', canceled_at = now(), canceled_by = auth.uid(), canceled_by_name = private.actor_display_name(), cancel_reason = btrim(p_reason)
   where id = v_a.id;
end
$$;

-- Confirmar pagamento/recebimento (total ou parcial). Idempotente pela chave enviada pelo cliente.
create function public.confirm_finance_payment(
  p_account_id uuid, p_amount_cents bigint, p_paid_on date, p_method text, p_notes text, p_idempotency_key uuid
) returns uuid language plpgsql security definer set search_path = '' as $$
declare v_a public.finance_accounts; v_ex public.finance_payments; v_balance bigint; v_id uuid;
begin
  -- Trava a conta: liquidações simultâneas da mesma conta são executadas uma de cada vez.
  select * into v_a from public.finance_accounts a where a.id = p_account_id for update;
  if not found then perform private.fail('PT404', 'Conta não encontrada.'); end if;
  perform private.finance_require(v_a.store_id, 'settle');
  if p_idempotency_key is null then perform private.fail('PT422', 'Requisição sem chave de idempotência.', 'idempotencyKey'); end if;

  select * into v_ex from public.finance_payments p where p.account_id = p_account_id and p.idempotency_key = p_idempotency_key;
  if found then -- repetição da mesma requisição (clique duplo, reenvio): não cria nada, devolve o mesmo pagamento
    if v_ex.amount_cents = p_amount_cents and v_ex.paid_on = p_paid_on and v_ex.method = p_method and v_ex.created_by = auth.uid() then
      return v_ex.id;
    end if;
    perform private.fail('PT409', 'Esta requisição já foi usada com outros dados. Atualize a página e tente novamente.');
  end if;

  if v_a.status = 'canceled' then perform private.fail('PT409', 'Conta cancelada não aceita liquidações.'); end if;
  if p_amount_cents is null or p_amount_cents <= 0 then perform private.fail('PT422', 'Informe um valor maior que zero.', 'amountCents'); end if;
  if p_method is null or p_method not in ('pix', 'dinheiro', 'transferencia', 'boleto', 'cartao_debito', 'cartao_credito', 'cheque', 'outro') then
    perform private.fail('PT422', 'Escolha a forma de pagamento.', 'method');
  end if;
  if p_paid_on is null or p_paid_on < date '2000-01-01' then perform private.fail('PT422', 'Informe a data.', 'paidOn'); end if;
  if p_paid_on > private.today_sp() then perform private.fail('PT422', 'A data não pode ser futura.', 'paidOn'); end if;
  if char_length(coalesce(p_notes, '')) > 500 then perform private.fail('PT422', 'Use no máximo 500 caracteres.', 'notes'); end if;

  v_balance := v_a.amount_cents - private.finance_settled(v_a.id);
  if p_amount_cents > v_balance then
    perform private.fail('PT422', format('O valor excede o saldo pendente (%s).', private.fmt_brl(v_balance)), 'amountCents');
  end if;

  insert into public.finance_payments (account_id, store_id, amount_cents, paid_on, method, notes, idempotency_key, created_by, created_by_name)
  values (v_a.id, v_a.store_id, p_amount_cents, p_paid_on, p_method, btrim(coalesce(p_notes, '')), p_idempotency_key, auth.uid(), private.actor_display_name())
  returning id into v_id;
  return v_id;
end
$$;

create function public.reverse_finance_payment(p_payment_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare v_p public.finance_payments;
begin
  select * into v_p from public.finance_payments p where p.id = p_payment_id;
  if not found then perform private.fail('PT404', 'Pagamento não encontrado.'); end if;
  perform 1 from public.finance_accounts a where a.id = v_p.account_id for update; -- mesma ordem de travas das liquidações
  select * into v_p from public.finance_payments p where p.id = p_payment_id for update;
  perform private.finance_require(v_p.store_id, 'reverse');
  if char_length(btrim(coalesce(p_reason, ''))) < 3 or char_length(btrim(p_reason)) > 300 then
    perform private.fail('PT422', 'Informe o motivo do estorno (3 a 300 caracteres).', 'reason');
  end if;
  if v_p.reversed_at is not null then perform private.fail('PT409', 'Este pagamento já foi estornado.'); end if;
  update public.finance_payments
     set reversed_at = clock_timestamp(), reversed_by = auth.uid(), reversed_by_name = private.actor_display_name(), reversal_reason = btrim(p_reason)
   where id = v_p.id;
end
$$;

create function public.confirm_receipt_sent(p_payment_id uuid, p_note text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare v_p public.finance_payments;
begin
  select * into v_p from public.finance_payments p where p.id = p_payment_id for update;
  if not found then perform private.fail('PT404', 'Pagamento não encontrado.'); end if;
  perform private.finance_require(v_p.store_id, 'confirm_send');
  if char_length(coalesce(p_note, '')) > 300 then perform private.fail('PT422', 'Use no máximo 300 caracteres.', 'note'); end if;
  if v_p.reversed_at is not null then perform private.fail('PT409', 'Este pagamento foi estornado.'); end if;
  if v_p.receipt_path is null then perform private.fail('PT409', 'Anexe o comprovante antes de confirmar o envio.'); end if;
  if v_p.receipt_sent_at is not null then return; end if; -- já confirmado: repetição não altera quem/quando
  update public.finance_payments
     set receipt_sent_at = clock_timestamp(), receipt_sent_by = auth.uid(), receipt_sent_by_name = private.actor_display_name(),
         receipt_sent_note = nullif(btrim(coalesce(p_note, '')), '')
   where id = v_p.id;
end
$$;

-- ---------------------------------------------------------------------------------------------
-- Leitura (mesmos filtros para listagem e resumo: uma única definição)
-- ---------------------------------------------------------------------------------------------
create function private.finance_filtered(
  p_store uuid, p_kind text, p_status text, p_competence_from date, p_competence_to date,
  p_due_from date, p_due_to date, p_search text, p_overdue boolean, p_receipt_pending boolean
) returns setof public.finance_accounts_v language sql stable security definer set search_path = '' as $$
  select v.* from public.finance_accounts_v v
  where (p_store is null or v.store_id = p_store)
    and (p_kind is null or v.kind = p_kind)
    and (p_status is null or case p_status when 'open' then v.situation in ('pending', 'partial') else v.situation = p_status end)
    and (p_competence_from is null or v.competence_date >= p_competence_from)
    and (p_competence_to is null or v.competence_date <= p_competence_to)
    and (p_due_from is null or v.due_date >= p_due_from)
    and (p_due_to is null or v.due_date <= p_due_to)
    and (coalesce(btrim(p_search), '') = ''
         or v.description ilike '%' || replace(replace(replace(btrim(p_search), '\', '\\'), '%', '\%'), '_', '\_') || '%' escape '\'
         or v.counterparty ilike '%' || replace(replace(replace(btrim(p_search), '\', '\\'), '%', '\%'), '_', '\_') || '%' escape '\')
    and (not coalesce(p_overdue, false) or v.is_overdue)
    and (not coalesce(p_receipt_pending, false) or v.receipts_pending > 0)
$$;

-- p_store nulo = visão consolidada (somente administrador geral)
create function private.finance_scope(p_store uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if p_store is null then perform private.require_general_admin(); else perform private.finance_require(p_store, 'view'); end if;
end
$$;

create function public.finance_list(
  p_store_id uuid, p_kind text default null, p_status text default null,
  p_competence_from date default null, p_competence_to date default null,
  p_due_from date default null, p_due_to date default null, p_search text default null,
  p_overdue boolean default false, p_receipt_pending boolean default false,
  p_limit int default 50, p_offset int default 0
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_limit int := least(greatest(coalesce(p_limit, 50), 1), 100); v_offset int := greatest(coalesce(p_offset, 0), 0); v_rows jsonb; v_total bigint;
begin
  perform private.finance_scope(p_store_id);
  if p_kind is not null and p_kind not in ('payable', 'receivable') then perform private.fail('PT422', 'Tipo inválido.', 'kind'); end if;
  if p_status is not null and p_status not in ('open', 'pending', 'partial', 'paid', 'canceled') then perform private.fail('PT422', 'Situação inválida.', 'status'); end if;
  select count(*) into v_total from private.finance_filtered(p_store_id, p_kind, p_status, p_competence_from, p_competence_to, p_due_from, p_due_to, p_search, p_overdue, p_receipt_pending);
  select coalesce(jsonb_agg(to_jsonb(x) order by x.due_date, x.created_at, x.id), '[]'::jsonb) into v_rows from (
    select f.id, f.store_id, s.name as store_name, f.kind, f.description, f.category, f.counterparty, f.amount_cents, f.currency,
           f.competence_date, f.due_date, f.notes, f.status, f.created_by_name, f.created_at,
           f.settled_cents, f.balance_cents, f.situation, f.is_overdue, f.payments_count, f.receipts_pending
    from private.finance_filtered(p_store_id, p_kind, p_status, p_competence_from, p_competence_to, p_due_from, p_due_to, p_search, p_overdue, p_receipt_pending) f
    join public.stores s on s.id = f.store_id
    order by f.due_date, f.created_at, f.id limit v_limit offset v_offset) x;
  return jsonb_build_object('rows', v_rows, 'total', v_total);
end
$$;

-- Resumo dos MESMOS filtros da listagem. Cada conta entra uma única vez; na visão consolidada o total é a
-- soma dos valores por loja calculada sobre o mesmo conjunto (sem duplicar).
create function public.finance_summary(
  p_store_id uuid, p_kind text default null, p_status text default null,
  p_competence_from date default null, p_competence_to date default null,
  p_due_from date default null, p_due_to date default null, p_search text default null,
  p_overdue boolean default false, p_receipt_pending boolean default false
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_empty constant jsonb := '{"count":0,"amount_cents":0,"settled_cents":0,"open_cents":0,"overdue_cents":0,"overdue_count":0}'::jsonb;
begin
  perform private.finance_scope(p_store_id);
  return (
    with f as (
      select x.*, s.name as store_name from private.finance_filtered(p_store_id, p_kind, p_status, p_competence_from, p_competence_to, p_due_from, p_due_to, p_search, p_overdue, p_receipt_pending) x
      join public.stores s on s.id = x.store_id),
    a as (
      select store_id, store_name, kind,
             count(*) filter (where situation <> 'canceled')                                   as count,
             coalesce(sum(amount_cents) filter (where situation <> 'canceled'), 0)            as amount_cents,
             coalesce(sum(settled_cents) filter (where situation <> 'canceled'), 0)           as settled_cents,
             coalesce(sum(balance_cents) filter (where situation in ('pending', 'partial')), 0) as open_cents,
             coalesce(sum(balance_cents) filter (where is_overdue), 0)                         as overdue_cents,
             count(*) filter (where is_overdue)                                                as overdue_count
      from f group by 1, 2, 3),
    t as (
      select kind, sum(count) as count, sum(amount_cents) as amount_cents, sum(settled_cents) as settled_cents,
             sum(open_cents) as open_cents, sum(overdue_cents) as overdue_cents, sum(overdue_count) as overdue_count
      from a group by kind)
    select jsonb_build_object(
      'today', private.today_sp(),
      'payable', coalesce((select to_jsonb(t) - 'kind' from t where kind = 'payable'), v_empty),
      'receivable', coalesce((select to_jsonb(t) - 'kind' from t where kind = 'receivable'), v_empty),
      'canceled_count', (select count(*) from f where situation = 'canceled'),
      'receipts_pending_count', (select coalesce(sum(receipts_pending), 0) from f where situation <> 'canceled'),
      'by_store', case when p_store_id is null then coalesce((
          select jsonb_agg(jsonb_build_object('store_id', s.store_id, 'store_name', s.store_name,
            'payable', coalesce((select to_jsonb(a2) - 'store_id' - 'store_name' - 'kind' from a a2 where a2.store_id = s.store_id and a2.kind = 'payable'), v_empty),
            'receivable', coalesce((select to_jsonb(a2) - 'store_id' - 'store_name' - 'kind' from a a2 where a2.store_id = s.store_id and a2.kind = 'receivable'), v_empty))
            order by s.store_name)
          from (select distinct store_id, store_name from a) s), '[]'::jsonb) end));
end
$$;

create function public.finance_get_account(p_account_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_store uuid;
begin
  select a.store_id into v_store from public.finance_accounts a where a.id = p_account_id;
  if v_store is null then
    if private.active_uid() is null then perform private.fail('PT401', 'Sessão inválida ou conta desativada. Entre novamente.'); end if;
    perform private.fail('PT404', 'Conta não encontrada.');
  end if;
  perform private.finance_require(v_store, 'view');
  return jsonb_build_object(
    'account', (select to_jsonb(x) from (
        select v.id, v.store_id, s.name as store_name, v.kind, v.description, v.category, v.counterparty, v.amount_cents, v.currency,
               v.competence_date, v.due_date, v.notes, v.status, v.canceled_at, v.canceled_by_name, v.cancel_reason,
               v.created_by_name, v.created_at, v.updated_at, v.settled_cents, v.balance_cents, v.situation, v.is_overdue, v.payments_count, v.receipts_pending
        from public.finance_accounts_v v join public.stores s on s.id = v.store_id where v.id = p_account_id) x),
    'payments', coalesce((select jsonb_agg(to_jsonb(p) order by p.created_at) from (
        select fp.id, fp.amount_cents, fp.paid_on, fp.method, fp.notes, fp.created_by_name, fp.created_at,
               fp.reversed_at, fp.reversed_by_name, fp.reversal_reason,
               fp.receipt_path, fp.receipt_name, fp.receipt_mime, fp.receipt_size, fp.receipt_attached_at, fp.receipt_attached_by_name,
               fp.receipt_sent_at, fp.receipt_sent_by_name, fp.receipt_sent_note
        from public.finance_payments fp where fp.account_id = p_account_id) p), '[]'::jsonb));
end
$$;

-- Histórico da conta (criação, edição, liquidação, estorno, comprovante, envio) — exige só "visualizar" em Financeiro.
create function public.finance_account_history(p_account_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_store uuid;
begin
  select a.store_id into v_store from public.finance_accounts a where a.id = p_account_id;
  if v_store is null then perform private.fail('PT404', 'Conta não encontrada.'); end if;
  perform private.finance_require(v_store, 'view');
  return coalesce((select jsonb_agg(jsonb_build_object('id', l.id, 'at', l.created_at, 'actor_name', l.actor_name, 'action', l.action, 'summary', l.summary) order by l.seq desc)
                   from public.audit_log l where l.details ->> 'account_id' = p_account_id::text), '[]'::jsonb);
end
$$;

-- ---------------------------------------------------------------------------------------------
revoke execute on all functions in schema private from public, anon, authenticated;
grant execute on function
  private.is_general_admin(), private.can_see_store(uuid), private.has_permission(uuid, text, text),
  private.actor_role(uuid), private.active_uid(), private.today_sp(timestamptz)
  to authenticated;
grant execute on all functions in schema private to service_role;

revoke all on function
  public.create_finance_account(uuid, text, text, text, text, bigint, date, date, text, uuid),
  public.update_finance_account(uuid, text, text, text, bigint, date, date, text),
  public.cancel_finance_account(uuid, text), public.confirm_finance_payment(uuid, bigint, date, text, text, uuid),
  public.reverse_finance_payment(uuid, text), public.confirm_receipt_sent(uuid, text),
  public.finance_list(uuid, text, text, date, date, date, date, text, boolean, boolean, int, int),
  public.finance_summary(uuid, text, text, date, date, date, date, text, boolean, boolean),
  public.finance_get_account(uuid), public.finance_account_history(uuid)
  from public, anon, authenticated, service_role;
grant execute on function
  public.create_finance_account(uuid, text, text, text, text, bigint, date, date, text, uuid),
  public.update_finance_account(uuid, text, text, text, bigint, date, date, text),
  public.cancel_finance_account(uuid, text), public.confirm_finance_payment(uuid, bigint, date, text, text, uuid),
  public.reverse_finance_payment(uuid, text), public.confirm_receipt_sent(uuid, text),
  public.finance_list(uuid, text, text, date, date, date, date, text, boolean, boolean, int, int),
  public.finance_summary(uuid, text, text, date, date, date, date, text, boolean, boolean),
  public.finance_get_account(uuid), public.finance_account_history(uuid)
  to authenticated;

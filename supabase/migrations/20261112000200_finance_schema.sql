-- Financeiro (parte 1) · Contas (a pagar / a receber) e liquidações.
--
-- Princípios:
--  * Valores em CENTAVOS (bigint), moeda BRL: nenhum ponto flutuante em nenhum ponto do sistema.
--  * Vencimento, competência e data de pagamento são `date` (sem fuso). "Hoje" é sempre o dia civil em
--    America/Sao_Paulo (private.today_sp), calculado no servidor.
--  * Situação (pendente/parcial/quitada) e saldo são CALCULADOS (view) a partir das liquidações não
--    estornadas: nunca gravados, portanto nunca desatualizados. "Em atraso" é indicação calculada sobre o saldo.
--  * Liquidações nunca são apagadas: estorno marca o registro (motivo, quem, quando) e o saldo se recalcula.
--  * As invariantes valem para QUALQUER escritor (RPC, serviço, SQL) por gatilhos; as RPCs só adicionam
--    autorização, mensagens e idempotência.

create function private.today_sp(p_at timestamptz default now()) returns date
language sql stable set search_path = '' as $$
  select (p_at at time zone 'America/Sao_Paulo')::date
$$;

-- 123456 -> 'R$ 1.234,56' (aritmética inteira; usado nos textos de auditoria e mensagens)
create function private.fmt_brl(p_cents bigint) returns text
language sql immutable set search_path = '' as $$
  select 'R$ ' || regexp_replace((p_cents / 100)::text, '(\d)(?=(\d{3})+$)', '\1.', 'g') || ',' || lpad((p_cents % 100)::text, 2, '0')
$$;

create function private.actor_display_name() returns text
language sql stable security definer set search_path = '' as $$
  select coalesce(nullif(p.full_name, ''), p.email) from public.profiles p where p.id = auth.uid()
$$;

-- ---------------------------------------------------------------------------------------------
create table public.finance_accounts (
  id               uuid primary key default gen_random_uuid(),
  store_id         uuid not null references public.stores (id) on delete restrict,
  kind             text not null check (kind in ('payable', 'receivable')),
  description      text not null check (char_length(btrim(description)) between 2 and 200),
  category         text not null default '' check (char_length(category) <= 80),
  counterparty     text not null default '' check (char_length(counterparty) <= 120),
  amount_cents     bigint not null check (amount_cents > 0 and amount_cents <= 99999999999),
  currency         text not null default 'BRL' check (currency = 'BRL'),
  competence_date  date not null check (competence_date between date '2000-01-01' and date '2100-12-31'),
  due_date         date not null check (due_date between date '2000-01-01' and date '2100-12-31'),
  notes            text not null default '' check (char_length(notes) <= 1000),
  status           text not null default 'open' check (status in ('open', 'canceled')),
  canceled_at      timestamptz,
  canceled_by      uuid,
  canceled_by_name text,
  cancel_reason    text,
  idempotency_key  uuid,
  created_by       uuid,
  created_by_name  text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (store_id, idempotency_key),
  check ((status = 'canceled') = (canceled_at is not null))
);
create index finance_accounts_store_due_idx on public.finance_accounts (store_id, due_date);
create index finance_accounts_store_competence_idx on public.finance_accounts (store_id, competence_date);

create table public.finance_payments (
  id                    uuid primary key default gen_random_uuid(),
  account_id            uuid not null references public.finance_accounts (id) on delete restrict,
  store_id              uuid not null references public.stores (id) on delete restrict,
  amount_cents          bigint not null check (amount_cents > 0 and amount_cents <= 99999999999),
  paid_on               date not null check (paid_on between date '2000-01-01' and date '2100-12-31'),
  method                text not null check (method in ('pix', 'dinheiro', 'transferencia', 'boleto', 'cartao_debito', 'cartao_credito', 'cheque', 'outro')),
  notes                 text not null default '' check (char_length(notes) <= 500),
  idempotency_key       uuid not null,
  created_by            uuid not null,
  created_by_name       text not null,
  created_at            timestamptz not null default clock_timestamp(),
  -- estorno (o registro original permanece)
  reversed_at           timestamptz,
  reversed_by           uuid,
  reversed_by_name      text,
  reversal_reason       text,
  -- comprovante (anexo) — NÃO implica envio
  receipt_path          text,
  receipt_name          text,
  receipt_mime          text,
  receipt_size          bigint,
  receipt_attached_at   timestamptz,
  receipt_attached_by   uuid,
  receipt_attached_by_name text,
  -- confirmação MANUAL de envio do comprovante (o sistema não envia mensagens)
  receipt_sent_at       timestamptz,
  receipt_sent_by       uuid,
  receipt_sent_by_name  text,
  receipt_sent_note     text,
  unique (account_id, idempotency_key),
  check ((reversed_at is null) = (reversed_by is null and reversal_reason is null)),
  check (receipt_sent_at is null or receipt_path is not null)
);
create index finance_payments_account_idx on public.finance_payments (account_id);
create index finance_payments_receipt_pending_idx on public.finance_payments (store_id)
  where receipt_path is not null and receipt_sent_at is null and reversed_at is null;

-- ---------------------------------------------------------------------------------------------
-- Invariantes (gatilhos)
-- ---------------------------------------------------------------------------------------------
create function private.finance_settled(p_account uuid) returns bigint
language sql stable security definer set search_path = '' as $$
  select coalesce(sum(amount_cents), 0)::bigint from public.finance_payments where account_id = p_account and reversed_at is null
$$;

create function private.finance_account_guard() returns trigger
language plpgsql set search_path = '' as $$
declare v_settled bigint;
begin
  if tg_op = 'UPDATE' then
    if new.store_id <> old.store_id or new.kind <> old.kind or new.currency <> old.currency
       or new.created_by is distinct from old.created_by or new.created_at <> old.created_at
       or new.idempotency_key is distinct from old.idempotency_key then
      raise exception 'Loja, tipo e moeda de uma conta não podem ser alterados.' using errcode = 'PT403';
    end if;
    if old.status = 'canceled' then
      raise exception 'Conta cancelada não pode ser alterada.' using errcode = 'PT409';
    end if;
    v_settled := private.finance_settled(old.id);
    if new.amount_cents < v_settled then
      raise exception 'O valor da conta não pode ser menor que o total já liquidado (%).', private.fmt_brl(v_settled)
        using errcode = 'PT422', hint = 'amountCents';
    end if;
    if new.status = 'canceled' and v_settled > 0 then
      raise exception 'Esta conta tem liquidações. Estorne-as antes de cancelar a conta.' using errcode = 'PT409';
    end if;
    new.updated_at := now();
  end if;
  return new;
end
$$;
create trigger finance_accounts_guard before update on public.finance_accounts
  for each row execute function private.finance_account_guard();

create function private.finance_payment_guard() returns trigger
language plpgsql set search_path = '' as $$
declare v_acc public.finance_accounts; v_settled bigint;
begin
  if tg_op = 'INSERT' then
    -- Trava a conta: duas liquidações simultâneas disputando o saldo são serializadas, para QUALQUER escritor.
    select * into v_acc from public.finance_accounts a where a.id = new.account_id for update;
    if not found then raise exception 'Conta não encontrada.' using errcode = 'PT404'; end if;
    if v_acc.status = 'canceled' then raise exception 'Conta cancelada não aceita liquidações.' using errcode = 'PT409'; end if;
    new.store_id := v_acc.store_id; -- a loja do pagamento é SEMPRE a da conta
    v_settled := private.finance_settled(new.account_id);
    if new.amount_cents > v_acc.amount_cents - v_settled then
      raise exception 'O valor excede o saldo pendente (%).', private.fmt_brl(v_acc.amount_cents - v_settled)
        using errcode = 'PT422', hint = 'amountCents';
    end if;
    return new;
  end if;

  -- UPDATE: o registro original é imutável; só mudam estorno, comprovante e envio (cada um uma única vez).
  if new.account_id <> old.account_id or new.store_id <> old.store_id or new.amount_cents <> old.amount_cents
     or new.paid_on <> old.paid_on or new.method <> old.method or new.notes <> old.notes
     or new.idempotency_key <> old.idempotency_key or new.created_by <> old.created_by or new.created_at <> old.created_at then
    raise exception 'Os dados de uma liquidação confirmada não podem ser alterados. Use o estorno.' using errcode = 'PT403';
  end if;
  if old.reversed_at is not null and (new.reversed_at is distinct from old.reversed_at or new.reversal_reason is distinct from old.reversal_reason) then
    raise exception 'Um estorno não pode ser desfeito.' using errcode = 'PT409';
  end if;
  if old.reversed_at is null and new.reversed_at is not null then
    if char_length(btrim(coalesce(new.reversal_reason, ''))) < 3 then
      raise exception 'Informe o motivo do estorno.' using errcode = 'PT422', hint = 'reason';
    end if;
    perform 1 from public.finance_accounts a where a.id = old.account_id for update;
  end if;
  if old.receipt_path is not null and (new.receipt_path is distinct from old.receipt_path or new.receipt_name is distinct from old.receipt_name
     or new.receipt_mime is distinct from old.receipt_mime or new.receipt_size is distinct from old.receipt_size) then
    raise exception 'O comprovante anexado não pode ser trocado.' using errcode = 'PT409';
  end if;
  if old.receipt_sent_at is not null and new.receipt_sent_at is distinct from old.receipt_sent_at then
    raise exception 'A confirmação de envio já foi registrada.' using errcode = 'PT409';
  end if;
  return new;
end
$$;
create trigger finance_payments_guard before insert or update on public.finance_payments
  for each row execute function private.finance_payment_guard();

-- Nada financeiro é apagado, para nenhum papel.
create function private.finance_no_delete() returns trigger
language plpgsql set search_path = '' as $$
begin
  raise exception 'Registros financeiros não podem ser apagados. Use cancelamento ou estorno.' using errcode = 'PT403';
end
$$;
create trigger finance_accounts_no_delete before delete on public.finance_accounts for each row execute function private.finance_no_delete();
create trigger finance_payments_no_delete before delete on public.finance_payments for each row execute function private.finance_no_delete();
create trigger finance_accounts_no_truncate before truncate on public.finance_accounts for each statement execute function private.finance_no_delete();
create trigger finance_payments_no_truncate before truncate on public.finance_payments for each statement execute function private.finance_no_delete();

-- ---------------------------------------------------------------------------------------------
-- Auditoria (mesma transação; ator = auth.uid())
-- ---------------------------------------------------------------------------------------------
alter table public.audit_log drop constraint audit_log_action_check;
alter table public.audit_log add constraint audit_log_action_check check (action in (
  'conta_criada', 'conta_editada', 'conta_desativada', 'conta_reativada', 'admin_concedido', 'admin_removido',
  'vinculo_criado', 'vinculo_editado', 'permissoes_alteradas', 'vinculo_desativado', 'vinculo_reativado',
  'financeiro_conta_criada', 'financeiro_conta_editada', 'financeiro_conta_cancelada',
  'financeiro_liquidacao', 'financeiro_estorno', 'financeiro_comprovante_anexado', 'financeiro_envio_confirmado'));
create index audit_log_finance_account_idx on public.audit_log ((details ->> 'account_id')) where details ? 'account_id';

create function private.audit_finance_account() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_parts text[] := '{}'; v_kind text := case new.kind when 'payable' then 'a pagar' else 'a receber' end;
begin
  if tg_op = 'INSERT' then
    perform private.audit_write(new.store_id, 'financeiro_conta_criada', null,
      format('Conta %s criada: %s (%s), vencimento %s.', v_kind, new.description, private.fmt_brl(new.amount_cents), to_char(new.due_date, 'DD/MM/YYYY')),
      jsonb_build_object('account_id', new.id, 'kind', new.kind, 'amount_cents', new.amount_cents, 'due_date', new.due_date, 'competence_date', new.competence_date));
    return new;
  end if;
  if old.status = 'open' and new.status = 'canceled' then
    perform private.audit_write(new.store_id, 'financeiro_conta_cancelada', null,
      format('Conta %s cancelada: %s. Motivo: %s', v_kind, new.description, new.cancel_reason),
      jsonb_build_object('account_id', new.id, 'reason', new.cancel_reason));
    return new;
  end if;
  if old.description <> new.description then v_parts := array_append(v_parts, format('descrição alterada para "%s"', new.description)); end if;
  if old.category <> new.category then v_parts := array_append(v_parts, 'categoria alterada'); end if;
  if old.counterparty <> new.counterparty then v_parts := array_append(v_parts, 'contraparte alterada'); end if;
  if old.amount_cents <> new.amount_cents then v_parts := array_append(v_parts, format('valor alterado de %s para %s', private.fmt_brl(old.amount_cents), private.fmt_brl(new.amount_cents))); end if;
  if old.competence_date <> new.competence_date then v_parts := array_append(v_parts, format('competência alterada de %s para %s', to_char(old.competence_date, 'DD/MM/YYYY'), to_char(new.competence_date, 'DD/MM/YYYY'))); end if;
  if old.due_date <> new.due_date then v_parts := array_append(v_parts, format('vencimento alterado de %s para %s', to_char(old.due_date, 'DD/MM/YYYY'), to_char(new.due_date, 'DD/MM/YYYY'))); end if;
  if old.notes <> new.notes then v_parts := array_append(v_parts, 'observações alteradas'); end if;
  if cardinality(v_parts) > 0 then
    perform private.audit_write(new.store_id, 'financeiro_conta_editada', null,
      format('Conta %s "%s" editada: %s.', v_kind, new.description, array_to_string(v_parts, '; ')),
      jsonb_build_object('account_id', new.id,
        'before', jsonb_build_object('description', old.description, 'amount_cents', old.amount_cents, 'competence_date', old.competence_date, 'due_date', old.due_date),
        'after', jsonb_build_object('description', new.description, 'amount_cents', new.amount_cents, 'competence_date', new.competence_date, 'due_date', new.due_date)));
  end if;
  return new;
end
$$;
create trigger finance_accounts_audit after insert or update on public.finance_accounts
  for each row execute function private.audit_finance_account();

create function private.audit_finance_payment() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_acc public.finance_accounts; v_noun text; v_d jsonb;
begin
  select * into v_acc from public.finance_accounts a where a.id = new.account_id;
  v_noun := case v_acc.kind when 'payable' then 'Pagamento' else 'Recebimento' end;
  v_d := jsonb_build_object('account_id', new.account_id, 'payment_id', new.id);
  if tg_op = 'INSERT' then
    perform private.audit_write(new.store_id, 'financeiro_liquidacao', null,
      format('%s de %s confirmado em "%s" (%s, %s).', v_noun, private.fmt_brl(new.amount_cents), v_acc.description, new.method, to_char(new.paid_on, 'DD/MM/YYYY')),
      v_d || jsonb_build_object('amount_cents', new.amount_cents, 'paid_on', new.paid_on, 'method', new.method));
    return new;
  end if;
  if old.reversed_at is null and new.reversed_at is not null then
    perform private.audit_write(new.store_id, 'financeiro_estorno', null,
      format('Estorno de %s de %s em "%s". Motivo: %s', lower(v_noun), private.fmt_brl(new.amount_cents), v_acc.description, new.reversal_reason),
      v_d || jsonb_build_object('amount_cents', new.amount_cents, 'reason', new.reversal_reason));
  end if;
  if old.receipt_path is null and new.receipt_path is not null then
    perform private.audit_write(new.store_id, 'financeiro_comprovante_anexado', null,
      format('Comprovante anexado ao %s de %s em "%s" (%s).', lower(v_noun), private.fmt_brl(new.amount_cents), v_acc.description, new.receipt_name),
      v_d || jsonb_build_object('file_name', new.receipt_name, 'mime', new.receipt_mime, 'size', new.receipt_size));
  end if;
  if old.receipt_sent_at is null and new.receipt_sent_at is not null then
    perform private.audit_write(new.store_id, 'financeiro_envio_confirmado', null,
      format('Envio do comprovante confirmado (%s de %s em "%s").', lower(v_noun), private.fmt_brl(new.amount_cents), v_acc.description),
      v_d || jsonb_build_object('note', new.receipt_sent_note));
  end if;
  return new;
end
$$;
create trigger finance_payments_audit after insert or update on public.finance_payments
  for each row execute function private.audit_finance_payment();

-- ---------------------------------------------------------------------------------------------
-- Visão calculada: saldo, situação e atraso (respeita o RLS de quem consulta)
-- ---------------------------------------------------------------------------------------------
create view public.finance_accounts_v with (security_invoker = true) as
select a.*,
       coalesce(p.settled, 0)::bigint                                   as settled_cents,
       (a.amount_cents - coalesce(p.settled, 0))::bigint                as balance_cents,
       case when a.status = 'canceled' then 'canceled'
            when coalesce(p.settled, 0) = 0 then 'pending'
            when coalesce(p.settled, 0) < a.amount_cents then 'partial'
            else 'paid' end                                              as situation,
       (a.status = 'open' and a.amount_cents - coalesce(p.settled, 0) > 0
          and a.due_date < private.today_sp())                           as is_overdue,
       coalesce(p.cnt, 0)::int                                           as payments_count,
       coalesce(p.pending_receipts, 0)::int                              as receipts_pending
from public.finance_accounts a
left join lateral (
  select sum(fp.amount_cents) filter (where fp.reversed_at is null) as settled,
         count(*) filter (where fp.reversed_at is null) as cnt,
         count(*) filter (where fp.reversed_at is null and fp.receipt_path is not null and fp.receipt_sent_at is null) as pending_receipts
  from public.finance_payments fp where fp.account_id = a.id) p on true;

-- ---------------------------------------------------------------------------------------------
-- RLS e privilégios: leitura por loja (permissão "visualizar" em Financeiro); escrita só por RPC
-- ---------------------------------------------------------------------------------------------
alter table public.finance_accounts enable row level security;
alter table public.finance_payments enable row level security;

create policy finance_accounts_select on public.finance_accounts for select to authenticated
  using (private.has_permission(store_id, 'finance', 'view'));
create policy finance_payments_select on public.finance_payments for select to authenticated
  using (private.has_permission(store_id, 'finance', 'view'));

revoke all on public.finance_accounts, public.finance_payments, public.finance_accounts_v from public, anon, authenticated;
grant select on public.finance_accounts, public.finance_payments, public.finance_accounts_v to authenticated;

revoke execute on all functions in schema private from public, anon, authenticated;
grant execute on function
  private.is_general_admin(), private.can_see_store(uuid), private.has_permission(uuid, text, text),
  private.actor_role(uuid), private.active_uid(), private.today_sp(timestamptz)
  to authenticated;
grant execute on all functions in schema private to service_role;

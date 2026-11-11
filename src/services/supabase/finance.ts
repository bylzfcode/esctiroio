// Financeiro sobre Supabase: contas e liquidações por RPC (autorização e saldo no servidor) e comprovantes no
// Storage PRIVADO. Nada aqui decide autorização: o servidor deriva a identidade do JWT.
import type { SupabaseClient } from '@supabase/supabase-js';
import { EXT, validateReceiptFile, displayName } from '@/lib/receipt';
import { ServiceError } from '../errors';
import {
  ReceiptUploadError,
  type FinanceAccount,
  type FinanceAccountDetail,
  type FinanceBucket,
  type FinanceFilters,
  type FinanceHistoryEntry,
  type FinancePayment,
  type FinanceService,
  type FinanceSummary,
  type PaymentMethod,
} from '../types';
import { NETWORK_DOWN } from './mappers';

export const RECEIPTS_BUCKET = 'receipts';

// ---- linhas do banco (snake_case) ----
interface AccountRow {
  id: string; store_id: string; store_name: string; kind: FinanceAccount['kind']; description: string; category: string; counterparty: string;
  amount_cents: number; currency: 'BRL'; competence_date: string; due_date: string; notes: string; status: 'open' | 'canceled';
  situation: FinanceAccount['situation']; is_overdue: boolean; settled_cents: number; balance_cents: number; payments_count: number;
  receipts_pending: number; created_by_name: string | null; created_at: string;
  canceled_at?: string | null; canceled_by_name?: string | null; cancel_reason?: string | null; updated_at?: string;
}
interface PaymentRow {
  id: string; amount_cents: number; paid_on: string; method: PaymentMethod; notes: string; created_by_name: string; created_at: string;
  reversed_at: string | null; reversed_by_name: string | null; reversal_reason: string | null;
  receipt_path: string | null; receipt_name: string | null; receipt_mime: string | null; receipt_size: number | null;
  receipt_attached_at: string | null; receipt_attached_by_name: string | null;
  receipt_sent_at: string | null; receipt_sent_by_name: string | null; receipt_sent_note: string | null;
}
interface BucketRow { count: number; amount_cents: number; settled_cents: number; open_cents: number; overdue_cents: number; overdue_count: number }

export const toAccount = (r: AccountRow): FinanceAccount => ({
  id: r.id, storeId: r.store_id, storeName: r.store_name, kind: r.kind, description: r.description, category: r.category, counterparty: r.counterparty,
  amountCents: Number(r.amount_cents), currency: r.currency, competenceDate: r.competence_date, dueDate: r.due_date, notes: r.notes, status: r.status,
  situation: r.situation, isOverdue: r.is_overdue, settledCents: Number(r.settled_cents), balanceCents: Number(r.balance_cents),
  paymentsCount: r.payments_count, receiptsPending: r.receipts_pending, createdByName: r.created_by_name, createdAt: r.created_at,
});

export const toPayment = (r: PaymentRow): FinancePayment => ({
  id: r.id, amountCents: Number(r.amount_cents), paidOn: r.paid_on, method: r.method, notes: r.notes, createdByName: r.created_by_name, createdAt: r.created_at,
  reversedAt: r.reversed_at, reversedByName: r.reversed_by_name, reversalReason: r.reversal_reason,
  receipt: r.receipt_path
    ? { path: r.receipt_path, name: r.receipt_name ?? 'comprovante', mime: r.receipt_mime ?? '', size: Number(r.receipt_size ?? 0), attachedAt: r.receipt_attached_at ?? '', attachedByName: r.receipt_attached_by_name }
    : null,
  receiptSent: r.receipt_sent_at ? { at: r.receipt_sent_at, byName: r.receipt_sent_by_name, note: r.receipt_sent_note } : null,
});

const toBucket = (b: BucketRow): FinanceBucket => ({
  count: Number(b.count), amountCents: Number(b.amount_cents), settledCents: Number(b.settled_cents),
  openCents: Number(b.open_cents), overdueCents: Number(b.overdue_cents), overdueCount: Number(b.overdue_count),
});

/** Parâmetros dos filtros, na ordem das funções finance_list / finance_summary. */
export function filterArgs(storeId: string | null, f: FinanceFilters): Record<string, unknown> {
  return {
    p_store_id: storeId,
    p_kind: f.kind ?? null,
    p_status: f.status ?? null,
    p_competence_from: f.competenceFrom || null,
    p_competence_to: f.competenceTo || null,
    p_due_from: f.dueFrom || null,
    p_due_to: f.dueTo || null,
    p_search: f.search?.trim() || null,
    p_overdue: f.overdueOnly ?? false,
    p_receipt_pending: f.receiptPending ?? false,
  };
}

interface Deps {
  rpc: <T>(fn: string, args?: Record<string, unknown>) => Promise<T>;
  mapThrown: (e: unknown) => ServiceError;
  notify: (e: ServiceError) => ServiceError;
}

/** Erro do Storage (RLS, tamanho, tipo, rede) em português. */
function storageMessage(e: { message?: string; statusCode?: string | number; status?: number }): string {
  const code = String(e.statusCode ?? e.status ?? '');
  const msg = e.message ?? '';
  if (code === '403' || /row-level security|unauthorized|not allowed/i.test(msg)) return 'Você não tem permissão para anexar comprovante a este pagamento (ou ele já tem um).';
  if (code === '413' || /too large|exceeded the maximum/i.test(msg)) return 'O arquivo deve ter no máximo 5 MB.';
  if (code === '415' || /mime type|not supported|not allowed/i.test(msg)) return 'Tipo de arquivo não permitido. Use imagem (JPG, PNG, WebP) ou PDF.';
  if (/failed to fetch|network|load failed/i.test(msg)) return NETWORK_DOWN;
  return 'Não foi possível enviar o arquivo. Tente novamente.';
}

export function createFinanceService(client: SupabaseClient, { rpc, mapThrown, notify }: Deps): FinanceService {
  return {
    async list(storeId, filters, page) {
      const r = await rpc<{ rows: AccountRow[]; total: number }>('finance_list', { ...filterArgs(storeId, filters), p_limit: page.limit, p_offset: page.offset });
      return { rows: r.rows.map(toAccount), total: Number(r.total) };
    },

    async summary(storeId, filters) {
      const r = await rpc<{
        today: string; payable: BucketRow; receivable: BucketRow; canceled_count: number; receipts_pending_count: number;
        by_store: { store_id: string; store_name: string; payable: BucketRow; receivable: BucketRow }[] | null;
      }>('finance_summary', filterArgs(storeId, filters));
      const out: FinanceSummary = {
        today: r.today,
        payable: toBucket(r.payable),
        receivable: toBucket(r.receivable),
        canceledCount: Number(r.canceled_count),
        receiptsPendingCount: Number(r.receipts_pending_count),
        byStore: r.by_store ? r.by_store.map((s) => ({ storeId: s.store_id, storeName: s.store_name, payable: toBucket(s.payable), receivable: toBucket(s.receivable) })) : null,
      };
      return out;
    },

    async get(accountId): Promise<FinanceAccountDetail> {
      const r = await rpc<{ account: AccountRow; payments: PaymentRow[] }>('finance_get_account', { p_account_id: accountId });
      return {
        account: { ...toAccount(r.account), canceledAt: r.account.canceled_at ?? null, canceledByName: r.account.canceled_by_name ?? null, cancelReason: r.account.cancel_reason ?? null, updatedAt: r.account.updated_at ?? '' },
        payments: r.payments.map(toPayment),
      };
    },

    async history(accountId): Promise<FinanceHistoryEntry[]> {
      const rows = await rpc<{ id: string; at: string; actor_name: string; action: string; summary: string }[]>('finance_account_history', { p_account_id: accountId });
      return rows.map((h) => ({ id: h.id, at: h.at, actorName: h.actor_name, action: h.action, summary: h.summary }));
    },

    createAccount: (storeId, i) =>
      rpc<string>('create_finance_account', {
        p_store_id: storeId, p_kind: i.kind, p_description: i.description, p_category: i.category, p_counterparty: i.counterparty,
        p_amount_cents: i.amountCents, p_competence_date: i.competenceDate, p_due_date: i.dueDate, p_notes: i.notes, p_idempotency_key: i.idempotencyKey ?? null,
      }),

    async updateAccount(accountId, i) {
      await rpc('update_finance_account', {
        p_account_id: accountId, p_description: i.description, p_category: i.category, p_counterparty: i.counterparty,
        p_amount_cents: i.amountCents, p_competence_date: i.competenceDate, p_due_date: i.dueDate, p_notes: i.notes,
      });
    },

    async cancelAccount(accountId, reason) {
      await rpc('cancel_finance_account', { p_account_id: accountId, p_reason: reason });
    },

    confirmPayment: (accountId, i) =>
      rpc<string>('confirm_finance_payment', {
        p_account_id: accountId, p_amount_cents: i.amountCents, p_paid_on: i.paidOn, p_method: i.method, p_notes: i.notes, p_idempotency_key: i.idempotencyKey,
      }),

    async reversePayment(paymentId, reason) {
      await rpc('reverse_finance_payment', { p_payment_id: paymentId, p_reason: reason });
    },

    async attachReceipt(payment, file) {
      const check = await validateReceiptFile(file);
      if (check.error || !check.type) throw new ReceiptUploadError(check.error ?? 'Arquivo inválido.', 'upload');
      const path = `${payment.storeId}/${payment.accountId}/${payment.id}/${crypto.randomUUID()}.${EXT[check.type]}`;
      try {
        const up = await client.storage.from(RECEIPTS_BUCKET).upload(path, file, { contentType: check.type, upsert: false, cacheControl: '3600' });
        if (up.error) {
          const err = up.error as { message?: string; statusCode?: string; status?: number };
          if (String(err.statusCode ?? err.status) === '401' || /jwt (expired|invalid)/i.test(err.message ?? '')) notify(new ServiceError('unauthorized', 'Sua sessão expirou. Entre novamente.'));
          throw new ReceiptUploadError(storageMessage(err), 'upload');
        }
      } catch (e) {
        if (e instanceof ReceiptUploadError) throw e;
        throw new ReceiptUploadError(storageMessage({ message: e instanceof Error ? e.message : String(e) }), 'upload');
      }
      try {
        await rpc('attach_payment_receipt', { p_payment_id: payment.id, p_file_path: path, p_file_name: displayName(file.name) });
      } catch (e) {
        throw new ReceiptUploadError(e instanceof ServiceError ? e.message : mapThrown(e).message, 'attach');
      }
    },

    async receiptUrl(path, opts) {
      const { data, error } = await client.storage.from(RECEIPTS_BUCKET).createSignedUrl(path, 60, opts?.download ? { download: opts.download } : undefined);
      if (error || !data) throw new ServiceError('forbidden', 'Não foi possível abrir o comprovante. Você pode não ter permissão para vê-lo.');
      return data.signedUrl;
    },

    async confirmReceiptSent(paymentId, note) {
      await rpc('confirm_receipt_sent', { p_payment_id: paymentId, p_note: note?.trim() || null });
    },
  };
}

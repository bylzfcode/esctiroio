import { formatDateBR } from '@/lib/dates';
import type { FinanceAccount, FinanceFilters, FinanceKind, FinanceSituation, PaymentMethod } from '@/services/types';
import { Badge } from '../ui/Badge';

export const KIND_LABEL: Record<FinanceKind, string> = { payable: 'A pagar', receivable: 'A receber' };
export const SETTLE_VERB: Record<FinanceKind, { action: string; noun: string; past: string }> = {
  payable: { action: 'Confirmar pagamento', noun: 'Pagamento', past: 'pago' },
  receivable: { action: 'Confirmar recebimento', noun: 'Recebimento', past: 'recebido' },
};
export const SITUATION_LABEL: Record<FinanceSituation, string> = { pending: 'Pendente', partial: 'Parcial', paid: 'Quitada', canceled: 'Cancelada' };
export const METHOD_LABEL: Record<PaymentMethod, string> = {
  pix: 'Pix', dinheiro: 'Dinheiro', transferencia: 'Transferência', boleto: 'Boleto', cartao_debito: 'Cartão de débito',
  cartao_credito: 'Cartão de crédito', cheque: 'Cheque', outro: 'Outro',
};
export const METHODS = Object.keys(METHOD_LABEL) as PaymentMethod[];

const TONE = { pending: 'neutral', partial: 'warn', paid: 'success', canceled: 'neutral' } as const;

export function SituationBadges({ account }: { account: Pick<FinanceAccount, 'situation' | 'isOverdue' | 'kind' | 'receiptsPending'> }) {
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <Badge tone={TONE[account.situation]}>{SITUATION_LABEL[account.situation]}</Badge>
      {account.isOverdue && <Badge tone="danger">Em atraso</Badge>}
      {account.receiptsPending > 0 && <Badge tone="brand">Comprovante: envio pendente</Badge>}
    </span>
  );
}

/** Texto que explica quais filtros o resumo e a lista estão aplicando. */
export function describeFilters(f: FinanceFilters, scopeLabel: string): string {
  const parts = [scopeLabel];
  if (f.kind) parts.push(`tipo: ${KIND_LABEL[f.kind].toLowerCase()}`);
  if (f.status) parts.push(`situação: ${f.status === 'open' ? 'em aberto (pendente e parcial)' : SITUATION_LABEL[f.status].toLowerCase()}`);
  const range = (a?: string, b?: string) => (a && b ? `de ${formatDateBR(a)} a ${formatDateBR(b)}` : a ? `a partir de ${formatDateBR(a)}` : b ? `até ${formatDateBR(b)}` : '');
  if (f.dueFrom || f.dueTo) parts.push(`vencimento ${range(f.dueFrom, f.dueTo)}`);
  if (f.competenceFrom || f.competenceTo) parts.push(`competência ${range(f.competenceFrom, f.competenceTo)}`);
  if (f.search?.trim()) parts.push(`busca “${f.search.trim()}”`);
  if (f.overdueOnly) parts.push('somente em atraso');
  if (f.receiptPending) parts.push('comprovante com envio pendente');
  return parts.join(' · ');
}

export function hasActiveFilters(f: FinanceFilters): boolean {
  return !!(f.kind || f.status || f.dueFrom || f.dueTo || f.competenceFrom || f.competenceTo || f.search?.trim() || f.overdueOnly || f.receiptPending);
}

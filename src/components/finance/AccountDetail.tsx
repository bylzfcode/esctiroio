import { ArrowLeft, Ban, Download, ExternalLink, FileCheck2, Paperclip, Pencil, Undo2, Wallet } from 'lucide-react';
import { useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { can } from '@/domain/access';
import { formatBRL } from '@/lib/money';
import { formatDateBR, todaySP } from '@/lib/dates';
import { formatDateTime } from '@/lib/format';
import { RECEIPT_ACCEPT } from '@/lib/receipt';
import { useSession } from '@/context/SessionContext';
import { useToast } from '@/context/ToastContext';
import { useAsync } from '@/hooks/useAsync';
import { ReceiptUploadError, errorMessage, services } from '@/services';
import type { FinanceAccountDetail, FinancePayment } from '@/services/types';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { Card, CardHeader } from '../ui/Card';
import { PageHeader } from '../ui/PageHeader';
import { ListSkeleton } from '../ui/Skeleton';
import { EmptyState, ErrorState, Notice } from '../ui/StateViews';
import { AccountFormModal } from './AccountFormModal';
import { KIND_LABEL, METHOD_LABEL, SETTLE_VERB, SituationBadges } from './common';
import { PaymentModal } from './PaymentModal';
import { ReasonDialog } from './ReasonDialog';

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-mute">{label}</dt>
      <dd className="mt-0.5 break-words text-sm text-ink">{children}</dd>
    </div>
  );
}

export function AccountDetail() {
  const { accountId = '' } = useParams();
  const finance = services.finance!;
  const { access, dataVersion } = useSession();
  const toast = useToast();
  const detail = useAsync(() => finance.get(accountId), [accountId, dataVersion]);
  const history = useAsync(() => finance.history(accountId), [accountId, dataVersion]);
  const reloadAll = () => {
    detail.reload();
    history.reload();
  };

  const [paying, setPaying] = useState(false);
  const [editing, setEditing] = useState(false);
  const [canceling, setCanceling] = useState(false);
  const [reversing, setReversing] = useState<FinancePayment | null>(null);
  const [sending, setSending] = useState<FinancePayment | null>(null);
  const [busy, setBusy] = useState(false);
  const [dialogError, setDialogError] = useState<string | null>(null);
  const [uploadingFor, setUploadingFor] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const attachTarget = useRef<FinancePayment | null>(null);

  if (detail.error) return <Card><ErrorState message={detail.error} onRetry={detail.reload} /></Card>;
  if (!detail.data) return <ListSkeleton rows={4} />;

  const { account, payments } = detail.data;
  const verb = SETTLE_VERB[account.kind];
  const open = account.status === 'open';
  const perm = (a: Parameters<typeof can>[2]) => can(access, 'finance', a);
  const canSettle = perm('settle') && open && account.balanceCents > 0;
  const today = todaySP();

  const run = async (fn: () => Promise<void>, ok: string, close: () => void) => {
    setBusy(true);
    setDialogError(null);
    try {
      await fn();
      toast.success(ok);
      close();
      reloadAll();
    } catch (err) {
      setDialogError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const openReceipt = async (p: FinancePayment, download: boolean) => {
    try {
      const url = await finance.receiptUrl(p.receipt!.path, download ? { download: p.receipt!.name } : undefined);
      window.open(url, '_blank', 'noopener,noreferrer');
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  const onPickFile = async (file: File | undefined) => {
    const target = attachTarget.current;
    if (fileInput.current) fileInput.current.value = '';
    if (!file || !target) return;
    setUploadingFor(target.id);
    try {
      await finance.attachReceipt({ id: target.id, storeId: account.storeId, accountId: account.id }, file);
      toast.success('Comprovante anexado. O envio ainda precisa ser confirmado.');
      reloadAll();
    } catch (err) {
      toast.error(err instanceof ReceiptUploadError ? err.message : errorMessage(err));
    } finally {
      setUploadingFor(null);
    }
  };

  return (
    <>
      <Link to="/financeiro" className="mb-3 inline-flex items-center gap-1.5 text-[13px] font-medium text-brand-ink hover:underline"><ArrowLeft className="h-4 w-4" aria-hidden /> Voltar para as contas</Link>
      <PageHeader
        title={account.description}
        description={`${KIND_LABEL[account.kind]} · ${account.storeName}`}
        actions={
          <>
            {canSettle && <Button variant="primary" icon={<Wallet className="h-4 w-4" aria-hidden />} onClick={() => setPaying(true)}>{verb.action}</Button>}
            {perm('edit') && open && <Button icon={<Pencil className="h-4 w-4" aria-hidden />} onClick={() => setEditing(true)}>Editar</Button>}
            {perm('delete') && open && (
              <Button variant="ghost" icon={<Ban className="h-4 w-4" aria-hidden />} onClick={() => { setDialogError(null); setCanceling(true); }} disabled={account.settledCents > 0} title={account.settledCents > 0 ? 'Estorne as liquidações para poder cancelar a conta.' : undefined}>Cancelar conta</Button>
            )}
          </>
        }
      />

      <div className="space-y-5">
        <Card>
          <div className="space-y-4 p-4 sm:p-5">
            <SituationBadges account={account} />
            {account.status === 'canceled' && <Notice>Conta cancelada por {account.canceledByName ?? '—'} em {account.canceledAt ? formatDateTime(account.canceledAt) : '—'}. Motivo: {account.cancelReason}</Notice>}
            <dl className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3 lg:grid-cols-4">
              <Fact label="Valor da conta">{formatBRL(account.amountCents)}</Fact>
              <Fact label={account.kind === 'payable' ? 'Já pago' : 'Já recebido'}>{formatBRL(account.settledCents)}</Fact>
              <Fact label="Saldo pendente"><strong className={account.isOverdue ? 'text-danger' : ''}>{formatBRL(account.status === 'canceled' ? 0 : account.balanceCents)}</strong></Fact>
              <Fact label="Moeda">BRL</Fact>
              <Fact label="Vencimento"><span className={account.isOverdue ? 'font-medium text-danger' : ''}>{formatDateBR(account.dueDate)}</span>{account.isOverdue && <span className="text-xs text-danger"> · em atraso em {formatDateBR(today)}</span>}</Fact>
              <Fact label="Competência">{formatDateBR(account.competenceDate)}</Fact>
              <Fact label={account.kind === 'payable' ? 'Fornecedor / credor' : 'Cliente / devedor'}>{account.counterparty || '—'}</Fact>
              <Fact label="Categoria">{account.category || '—'}</Fact>
              <Fact label="Criada por">{account.createdByName ?? '—'} em {formatDateTime(account.createdAt)}</Fact>
            </dl>
            {account.notes && <div><p className="text-xs text-mute">Observações</p><p className="whitespace-pre-wrap text-sm text-ink">{account.notes}</p></div>}
          </div>
        </Card>

        <Card>
          <CardHeader title={account.kind === 'payable' ? 'Pagamentos' : 'Recebimentos'} description="Liquidações confirmadas. Nada é apagado: erros são corrigidos por estorno." />
          {payments.length === 0 ? (
            <EmptyState icon={Wallet} title={account.kind === 'payable' ? 'Nenhum pagamento registrado' : 'Nenhum recebimento registrado'} action={canSettle && <Button variant="primary" onClick={() => setPaying(true)}>{verb.action}</Button>}>
              O saldo pendente é o valor total da conta.
            </EmptyState>
          ) : (
            <ul className="divide-y divide-line">
              {payments.map((p) => {
                const reversed = !!p.reversedAt;
                return (
                  <li key={p.id} className="space-y-2 px-4 py-3.5 sm:px-5">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className={reversed ? 'text-mute line-through decoration-1' : ''}>
                        <p className="text-sm font-semibold text-ink">{formatBRL(p.amountCents)} <span className="text-xs font-normal text-mute">· {METHOD_LABEL[p.method]} · {formatDateBR(p.paidOn)}</span></p>
                        <p className="text-xs text-mute">Registrado por {p.createdByName} em {formatDateTime(p.createdAt)}{p.notes ? ` · ${p.notes}` : ''}</p>
                      </div>
                      {reversed ? <Badge tone="warn">Estornado</Badge> : perm('reverse') && <Button size="sm" variant="ghost" icon={<Undo2 className="h-3.5 w-3.5" aria-hidden />} onClick={() => { setDialogError(null); setReversing(p); }}>Estornar</Button>}
                    </div>
                    {reversed && <p className="text-xs text-warn">Estornado por {p.reversedByName} em {formatDateTime(p.reversedAt!)}. Motivo: {p.reversalReason}</p>}

                    {/* Comprovante e envio: dois controles independentes */}
                    <div className="flex flex-wrap items-center gap-2 rounded-lg bg-subtle px-3 py-2 text-[13px]">
                      {p.receipt ? (
                        <>
                          <Paperclip className="h-4 w-4 text-mute" aria-hidden />
                          <span className="min-w-0 truncate text-ink">{p.receipt.name}</span>
                          <Button size="sm" icon={<ExternalLink className="h-3.5 w-3.5" aria-hidden />} onClick={() => void openReceipt(p, false)} aria-label={`Ver comprovante ${p.receipt.name}`}>Ver</Button>
                          <Button size="sm" icon={<Download className="h-3.5 w-3.5" aria-hidden />} onClick={() => void openReceipt(p, true)} aria-label={`Baixar comprovante ${p.receipt.name}`}>Baixar</Button>
                        </>
                      ) : reversed ? <span className="text-mute">Sem comprovante.</span> : (
                        <>
                          <span className="text-mute">Sem comprovante anexado.</span>
                          {perm('settle') && <Button size="sm" icon={<Paperclip className="h-3.5 w-3.5" aria-hidden />} loading={uploadingFor === p.id} onClick={() => { attachTarget.current = p; fileInput.current?.click(); }}>Anexar comprovante</Button>}
                        </>
                      )}
                      {p.receipt && !reversed && (
                        <span className="ml-auto flex flex-wrap items-center gap-2">
                          {p.receiptSent ? (
                            <Badge tone="success"><FileCheck2 className="h-3 w-3" aria-hidden /> Envio confirmado por {p.receiptSent.byName ?? '—'} em {formatDateTime(p.receiptSent.at)}</Badge>
                          ) : (
                            <>
                              <Badge tone="brand">Envio pendente</Badge>
                              {perm('confirm_send') && <Button size="sm" onClick={() => { setDialogError(null); setSending(p); }}>Confirmar envio do comprovante</Button>}
                            </>
                          )}
                        </span>
                      )}
                    </div>
                    {p.receiptSent?.note && <p className="text-xs text-mute">Nota do envio: {p.receiptSent.note}</p>}
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        <Card>
          <CardHeader title="Histórico" description="Criação, edições, liquidações, estornos, comprovantes e confirmações de envio." />
          {history.error ? <ErrorState message={history.error} onRetry={history.reload} /> : !history.data ? <ListSkeleton rows={3} /> : (
            <ol className="divide-y divide-line">
              {history.data.map((h) => (
                <li key={h.id} className="px-4 py-3 sm:px-5">
                  <p className="text-sm text-ink">{h.summary}</p>
                  <p className="mt-0.5 text-xs text-mute">por {h.actorName} · <time dateTime={h.at}>{formatDateTime(h.at)}</time></p>
                </li>
              ))}
            </ol>
          )}
        </Card>
      </div>

      <input ref={fileInput} type="file" accept={RECEIPT_ACCEPT} className="sr-only" aria-label="Selecionar comprovante" onChange={(e) => void onPickFile(e.target.files?.[0])} />

      <PaymentModal open={paying} account={account as FinanceAccountDetail['account']} onClose={() => setPaying(false)} onSaved={reloadAll} />
      <AccountFormModal open={editing} storeId={account.storeId} storeName={account.storeName} account={account} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); reloadAll(); }} />
      <ReasonDialog open={canceling} title="Cancelar conta?" description="A conta deixa de contar nos valores em aberto e não aceita mais liquidações. Ela continua registrada, com o motivo, no histórico." confirmLabel="Cancelar conta" busy={busy} error={dialogError} onCancel={() => setCanceling(false)} onConfirm={(r) => run(() => finance.cancelAccount(account.id, r), 'Conta cancelada.', () => setCanceling(false))} />
      <ReasonDialog open={!!reversing} title="Estornar liquidação?" description={reversing ? `O ${verb.noun.toLowerCase()} de ${formatBRL(reversing.amountCents)} continua registrado, marcado como estornado, e o saldo da conta volta a considerar esse valor em aberto.` : ''} confirmLabel="Estornar" busy={busy} error={dialogError} onCancel={() => setReversing(null)} onConfirm={(r) => run(() => finance.reversePayment(reversing!.id, r), 'Liquidação estornada.', () => setReversing(null))} />
      <ReasonDialog open={!!sending} title="Confirmar envio do comprovante?" description="Isto apenas REGISTRA que o comprovante foi enviado por você (por exemplo, por e-mail ou aplicativo de mensagens). O sistema não envia mensagens." label="Observação (opcional)" optional confirmLabel="Confirmar envio" busy={busy} error={dialogError} onCancel={() => setSending(null)} onConfirm={(note) => run(() => finance.confirmReceiptSent(sending!.id, note), 'Envio do comprovante confirmado.', () => setSending(null))} />
    </>
  );
}

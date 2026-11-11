import { AlertTriangle, ChevronLeft, ChevronRight, FileCheck2, Plus, Search, Wallet } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { can } from '@/domain/access';
import { formatBRL } from '@/lib/money';
import { addDaysISO, daysUntil, formatDateBR, monthRange, todaySP } from '@/lib/dates';
import { useSession } from '@/context/SessionContext';
import { useAsync } from '@/hooks/useAsync';
import { services } from '@/services';
import type { FinanceAccount, FinanceBucket, FinanceFilters, FinanceSummary } from '@/services/types';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { Card, CardHeader } from '../ui/Card';
import { PageHeader } from '../ui/PageHeader';
import { CardsSkeleton, ListSkeleton } from '../ui/Skeleton';
import { EmptyState, ErrorState, Notice } from '../ui/StateViews';
import { AccountFormModal } from './AccountFormModal';
import { KIND_LABEL, SITUATION_LABEL, SituationBadges, describeFilters, hasActiveFilters } from './common';

const PAGE = 20;

function useDebounced<T>(value: T, ms = 350): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

function Money({ cents, tone }: { cents: number; tone?: 'danger' }) {
  return <span className={tone === 'danger' && cents > 0 ? 'text-danger' : ''}>{formatBRL(cents)}</span>;
}

function BucketCard({ title, bucket, hint }: { title: string; bucket: FinanceBucket; hint: string }) {
  return (
    <Card className="p-4">
      <p className="text-[13px] font-medium text-ink">{title}</p>
      <dl className="mt-2 space-y-1.5 text-[13px]">
        <div className="flex justify-between gap-3"><dt className="text-mute">Em aberto</dt><dd className="text-lg font-semibold text-ink"><Money cents={bucket.openCents} /></dd></div>
        <div className="flex justify-between gap-3"><dt className="text-mute">Vencidos</dt><dd className="font-medium"><Money cents={bucket.overdueCents} tone="danger" /> <span className="text-xs text-mute">({bucket.overdueCount})</span></dd></div>
        <div className="flex justify-between gap-3"><dt className="text-mute">Total das contas</dt><dd><Money cents={bucket.amountCents} /> <span className="text-xs text-mute">({bucket.count})</span></dd></div>
        <div className="flex justify-between gap-3"><dt className="text-mute">{hint}</dt><dd><Money cents={bucket.settledCents} /></dd></div>
      </dl>
    </Card>
  );
}

export function FinanceHome() {
  const { scope, activeStore, access, dataVersion } = useSession();
  const navigate = useNavigate();
  const finance = services.finance!;
  const consolidated = scope.kind === 'consolidated' || !activeStore;
  const storeId = consolidated ? null : activeStore!.id;
  const scopeLabel = consolidated ? 'Todas as lojas' : activeStore!.name;

  const [filters, setFilters] = useState<FinanceFilters>({});
  const [searchText, setSearchText] = useState('');
  const search = useDebounced(searchText);
  const [page, setPage] = useState(0);
  const [creating, setCreating] = useState(false);
  const [showMore, setShowMore] = useState(false);

  const effective = useMemo<FinanceFilters>(() => ({ ...filters, search }), [filters, search]);
  const key = JSON.stringify(effective);
  useEffect(() => setPage(0), [key]);

  const set = (patch: Partial<FinanceFilters>) => setFilters((f) => ({ ...f, ...patch }));
  const today = todaySP();
  const preset = (from?: string, to?: string) => set({ dueFrom: from, dueTo: to });

  const list = useAsync(() => finance.list(storeId, effective, { limit: PAGE, offset: page * PAGE }), [storeId, key, page, dataVersion]);
  const sum = useAsync<FinanceSummary>(() => finance.summary(storeId, effective), [storeId, key, dataVersion]);
  // Alertas olham a loja INTEIRA, sem os filtros da tela.
  const alerts = useAsync<FinanceSummary>(() => finance.summary(storeId, {}), [storeId, dataVersion]);

  const canCreate = !consolidated && can(access, 'finance', 'create');
  const filtered = hasActiveFilters(effective);
  const total = list.data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE));
  const overdueCount = (alerts.data?.payable.overdueCount ?? 0) + (alerts.data?.receivable.overdueCount ?? 0);
  const overdueSum = (alerts.data?.payable.overdueCents ?? 0) + (alerts.data?.receivable.overdueCents ?? 0);
  const pendingReceipts = alerts.data?.receiptsPendingCount ?? 0;

  return (
    <>
      <PageHeader
        title="Financeiro"
        description={consolidated ? 'Visão consolidada de todas as lojas. Cada conta pertence a uma única loja e é contada uma vez.' : `Contas a pagar e a receber da ${activeStore!.name}.`}
        actions={canCreate && <Button variant="primary" icon={<Plus className="h-4 w-4" aria-hidden />} onClick={() => setCreating(true)}>Nova conta</Button>}
      />

      {/* Alertas separados: pagamento pendente × comprovante com envio pendente */}
      <section aria-label="Alertas" className="mb-4 grid gap-3 sm:grid-cols-2">
        <Card className={`flex items-start gap-3 p-4 ${overdueCount > 0 ? 'border-danger/40' : ''}`}>
          <AlertTriangle className={`mt-0.5 h-5 w-5 shrink-0 ${overdueCount > 0 ? 'text-danger' : 'text-mute'}`} aria-hidden />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-ink">Pagamentos e recebimentos pendentes</p>
            {alerts.loading && !alerts.data ? <p className="text-[13px] text-mute">Carregando…</p> : alerts.error ? <p className="text-[13px] text-danger">Não foi possível calcular.</p> : overdueCount > 0 ? (
              <p className="text-[13px] text-mute"><strong className="text-danger">{overdueCount}</strong> {overdueCount === 1 ? 'conta vencida' : 'contas vencidas'} com saldo em aberto, somando <strong className="text-ink">{formatBRL(overdueSum)}</strong>.</p>
            ) : <p className="text-[13px] text-mute">Nenhuma conta vencida com saldo em aberto.</p>}
          </div>
          {overdueCount > 0 && <Button size="sm" onClick={() => setFilters({ overdueOnly: true })}>Ver</Button>}
        </Card>
        <Card className={`flex items-start gap-3 p-4 ${pendingReceipts > 0 ? 'border-brand/40' : ''}`}>
          <FileCheck2 className={`mt-0.5 h-5 w-5 shrink-0 ${pendingReceipts > 0 ? 'text-brand-ink' : 'text-mute'}`} aria-hidden />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-ink">Comprovantes com envio pendente</p>
            {alerts.loading && !alerts.data ? <p className="text-[13px] text-mute">Carregando…</p> : alerts.error ? <p className="text-[13px] text-danger">Não foi possível calcular.</p> : pendingReceipts > 0 ? (
              <p className="text-[13px] text-mute"><strong className="text-ink">{pendingReceipts}</strong> {pendingReceipts === 1 ? 'comprovante anexado' : 'comprovantes anexados'} aguardando a confirmação de envio (feita manualmente).</p>
            ) : <p className="text-[13px] text-mute">Nenhum comprovante aguardando confirmação de envio.</p>}
          </div>
          {pendingReceipts > 0 && <Button size="sm" onClick={() => setFilters({ receiptPending: true })}>Ver</Button>}
        </Card>
      </section>

      {/* Filtros */}
      <Card className="mb-4">
        <div className="space-y-3 p-3 sm:p-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
            <div className="relative lg:w-72">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-mute" aria-hidden />
              <input type="search" className="input pl-9" placeholder="Buscar descrição ou contraparte" aria-label="Buscar contas" value={searchText} onChange={(e) => setSearchText(e.target.value)} />
            </div>
            <select className="input lg:w-40" aria-label="Filtrar por tipo" value={filters.kind ?? ''} onChange={(e) => set({ kind: (e.target.value || undefined) as FinanceFilters['kind'] })}>
              <option value="">Todos os tipos</option>
              <option value="payable">{KIND_LABEL.payable}</option>
              <option value="receivable">{KIND_LABEL.receivable}</option>
            </select>
            <select className="input lg:w-48" aria-label="Filtrar por situação" value={filters.status ?? ''} onChange={(e) => set({ status: (e.target.value || undefined) as FinanceFilters['status'] })}>
              <option value="">Todas as situações</option>
              <option value="open">Em aberto (pendente e parcial)</option>
              {(['pending', 'partial', 'paid', 'canceled'] as const).map((s) => <option key={s} value={s}>{SITUATION_LABEL[s]}</option>)}
            </select>
            <label className="flex items-center gap-2 text-[13px] text-ink"><input type="checkbox" className="h-4 w-4 accent-[rgb(var(--c-brand))]" checked={!!filters.overdueOnly} onChange={(e) => set({ overdueOnly: e.target.checked || undefined })} /> Somente em atraso</label>
            <button type="button" className="text-[13px] font-medium text-brand-ink hover:underline lg:ml-auto" aria-expanded={showMore} onClick={() => setShowMore((v) => !v)}>{showMore ? 'Menos filtros' : 'Período e mais filtros'}</button>
          </div>
          {showMore && (
            <div className="space-y-3 border-t border-line pt-3">
              <div className="flex flex-wrap items-center gap-2 text-[13px]">
                <span className="text-mute">Vencimento:</span>
                <Button size="sm" onClick={() => { const r = monthRange(today); preset(r.from, r.to); }}>Este mês</Button>
                <Button size="sm" onClick={() => preset(today, addDaysISO(today, 30))}>Próximos 30 dias</Button>
                <Button size="sm" onClick={() => preset(undefined, addDaysISO(today, -1))}>Já vencidos</Button>
                <Button size="sm" variant="ghost" onClick={() => preset(undefined, undefined)}>Qualquer data</Button>
              </div>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                {([['Vencimento de', 'dueFrom'], ['Vencimento até', 'dueTo'], ['Competência de', 'competenceFrom'], ['Competência até', 'competenceTo']] as const).map(([label, k]) => (
                  <label key={k} className="block text-[13px] font-medium text-ink">{label}
                    <input type="date" className="input mt-1" value={filters[k] ?? ''} onChange={(e) => set({ [k]: e.target.value || undefined })} />
                  </label>
                ))}
              </div>
              <label className="flex items-center gap-2 text-[13px] text-ink"><input type="checkbox" className="h-4 w-4 accent-[rgb(var(--c-brand))]" checked={!!filters.receiptPending} onChange={(e) => set({ receiptPending: e.target.checked || undefined })} /> Somente com comprovante de envio pendente</label>
            </div>
          )}
          {filtered && (
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line pt-3 text-[13px]">
              <span className="text-mute">Filtros ativos: {describeFilters(effective, scopeLabel)}</span>
              <Button size="sm" variant="ghost" onClick={() => { setFilters({}); setSearchText(''); }}>Limpar filtros</Button>
            </div>
          )}
        </div>
      </Card>

      {/* Resumo do que está filtrado */}
      <section aria-label="Resumo" className="mb-4">
        <p className="mb-2 text-xs text-mute">
          <strong className="font-medium text-ink">Resumo</strong> das contas que atendem aos filtros: {describeFilters(effective, scopeLabel)}. Os valores consideram o vencimento/competência das contas, não a data dos pagamentos. Atraso calculado em {formatDateBR(sum.data?.today ?? today)} (São Paulo).
        </p>
        {sum.error ? <Card><ErrorState message={sum.error} onRetry={sum.reload} /></Card> : sum.loading && !sum.data ? <CardsSkeleton count={2} /> : sum.data && (
          <>
            <div className="grid gap-3 sm:grid-cols-2">
              <BucketCard title="A pagar" bucket={sum.data.payable} hint="Já pago" />
              <BucketCard title="A receber" bucket={sum.data.receivable} hint="Já recebido" />
            </div>
            {sum.data.byStore && sum.data.byStore.length > 0 && (
              <Card className="mt-3 overflow-x-auto">
                <CardHeader title="Por loja" description="O total é a soma das lojas; cada conta aparece uma única vez." />
                <table className="w-full min-w-[34rem] text-[13px]">
                  <thead><tr className="text-left text-xs text-mute"><th className="px-4 py-2 font-medium">Loja</th><th className="px-2 py-2 text-right font-medium">A pagar em aberto</th><th className="px-2 py-2 text-right font-medium">Vencido a pagar</th><th className="px-2 py-2 text-right font-medium">A receber em aberto</th><th className="px-4 py-2 text-right font-medium">Vencido a receber</th></tr></thead>
                  <tbody className="divide-y divide-line">
                    {sum.data.byStore.map((s) => (
                      <tr key={s.storeId}><td className="px-4 py-2 text-ink">{s.storeName}</td><td className="px-2 py-2 text-right"><Money cents={s.payable.openCents} /></td><td className="px-2 py-2 text-right"><Money cents={s.payable.overdueCents} tone="danger" /></td><td className="px-2 py-2 text-right"><Money cents={s.receivable.openCents} /></td><td className="px-4 py-2 text-right"><Money cents={s.receivable.overdueCents} tone="danger" /></td></tr>
                    ))}
                    <tr className="font-semibold text-ink"><td className="px-4 py-2">Total</td><td className="px-2 py-2 text-right">{formatBRL(sum.data.payable.openCents)}</td><td className="px-2 py-2 text-right">{formatBRL(sum.data.payable.overdueCents)}</td><td className="px-2 py-2 text-right">{formatBRL(sum.data.receivable.openCents)}</td><td className="px-4 py-2 text-right">{formatBRL(sum.data.receivable.overdueCents)}</td></tr>
                  </tbody>
                </table>
              </Card>
            )}
            {sum.data.canceledCount > 0 && <p className="mt-2 text-xs text-mute">{sum.data.canceledCount} {sum.data.canceledCount === 1 ? 'conta cancelada' : 'contas canceladas'} neste filtro (fora dos valores acima).</p>}
          </>
        )}
      </section>

      {/* Lista */}
      <Card>
        <CardHeader title="Contas" description={list.data ? `${total} ${total === 1 ? 'conta' : 'contas'}` : undefined} />
        {list.error ? <ErrorState message={list.error} onRetry={list.reload} /> : list.loading && !list.data ? <ListSkeleton rows={5} /> : (list.data?.rows.length ?? 0) === 0 ? (
          filtered ? (
            <EmptyState icon={Search} title="Nenhuma conta encontrada" action={<Button onClick={() => { setFilters({}); setSearchText(''); }}>Limpar filtros</Button>}>Nenhuma conta corresponde aos filtros escolhidos.</EmptyState>
          ) : (
            <EmptyState icon={Wallet} title="Nenhuma conta cadastrada" action={canCreate && <Button variant="primary" onClick={() => setCreating(true)}>Criar a primeira conta</Button>}>
              {consolidated ? 'As lojas ainda não têm contas.' : 'Cadastre contas a pagar e a receber para acompanhar vencimentos e liquidações.'}
            </EmptyState>
          )
        ) : (
          <ul className="divide-y divide-line">
            {list.data!.rows.map((a) => <AccountRow key={a.id} a={a} today={today} showStore={consolidated} />)}
          </ul>
        )}
        {total > PAGE && (
          <div className="flex items-center justify-between gap-3 border-t border-line px-4 py-3 text-xs text-mute sm:px-5">
            <span>Página {page + 1} de {pages}</span>
            <span className="flex gap-2">
              <Button size="sm" disabled={page === 0} icon={<ChevronLeft className="h-4 w-4" aria-hidden />} onClick={() => setPage((p) => p - 1)}>Anterior</Button>
              <Button size="sm" disabled={page + 1 >= pages} onClick={() => setPage((p) => p + 1)}>Próxima<ChevronRight className="h-4 w-4" aria-hidden /></Button>
            </span>
          </div>
        )}
      </Card>

      {activeStore && (
        <AccountFormModal open={creating} storeId={activeStore.id} storeName={activeStore.name} onClose={() => setCreating(false)} onSaved={(id) => { setCreating(false); navigate(`/financeiro/${id}`); }} />
      )}
      {consolidated && <Notice className="mt-4">Para criar contas, selecione uma loja no cabeçalho. Na visão consolidada os valores são somente leitura.</Notice>}
    </>
  );
}

function AccountRow({ a, today, showStore }: { a: FinanceAccount; today: string; showStore: boolean }) {
  const days = daysUntil(today, a.dueDate);
  const dueText = a.situation === 'paid' || a.situation === 'canceled' ? formatDateBR(a.dueDate) : days < 0 ? `${formatDateBR(a.dueDate)} (${-days} ${-days === 1 ? 'dia' : 'dias'} de atraso)` : days === 0 ? `${formatDateBR(a.dueDate)} (hoje)` : formatDateBR(a.dueDate);
  return (
    <li>
      <Link to={`/financeiro/${a.id}`} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3.5 hover:bg-subtle sm:px-5">
        <div className="min-w-[14rem] flex-1">
          <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-ink"><span className="truncate">{a.description}</span> <Badge tone={a.kind === 'payable' ? 'neutral' : 'brand'}>{KIND_LABEL[a.kind]}</Badge></p>
          <p className="mt-0.5 truncate text-xs text-mute">{[showStore ? a.storeName : '', a.counterparty, a.category].filter(Boolean).join(' · ') || '—'}</p>
          <p className="mt-1.5"><SituationBadges account={a} /></p>
        </div>
        <div className="text-xs text-mute sm:w-44"><span className="block">Vencimento</span><span className={`text-[13px] ${a.isOverdue ? 'font-medium text-danger' : 'text-ink'}`}>{dueText}</span></div>
        <div className="text-right sm:w-36">
          <p className="text-[13px] font-semibold text-ink">{formatBRL(a.amountCents)}</p>
          {a.situation !== 'canceled' && <p className="text-xs text-mute">Saldo {formatBRL(a.balanceCents)}</p>}
        </div>
      </Link>
    </li>
  );
}

import { ArrowRight, Info } from 'lucide-react';
import { Link } from 'react-router-dom';
import { can } from '@/domain/access';
import { ROLE_LABEL } from '@/domain/modules';
import type { Store } from '@/domain/types';
import { MODULE_BY_ID } from '@/domain/modules';
import { NAV_ITEMS } from '@/app/navigation';
import { Card, CardHeader } from '@/components/ui/Card';
import { PageHeader } from '@/components/ui/PageHeader';
import { PermissionSummary } from '@/components/ui/PermissionSummary';
import { CardsSkeleton, ListSkeleton } from '@/components/ui/Skeleton';
import { ErrorState, Notice } from '@/components/ui/StateViews';
import { useSession } from '@/context/SessionContext';
import { useAsync } from '@/hooks/useAsync';
import { formatDateTime, plural } from '@/lib/format';
import { services } from '@/services';

function Stat({ label, value, hint }: { label: string; value: string | number; hint?: string }) {
  return (
    <Card className="p-4">
      <p className="text-[13px] text-mute">{label}</p>
      <p className="mt-1 text-2xl font-semibold text-ink">{value}</p>
      {hint && <p className="mt-1 text-xs leading-snug text-mute">{hint}</p>}
    </Card>
  );
}

export default function OverviewPage() {
  const { scope, activeStore } = useSession();
  return scope.kind === 'consolidated' || !activeStore ? <Consolidated /> : <StoreOverview store={activeStore} />;
}

function Consolidated() {
  const { actor, dataVersion } = useSession();
  const { data, loading, error, reload } = useAsync(() => services.overview.consolidatedSummary(actor!), [actor?.personId, dataVersion]);

  return (
    <>
      <PageHeader
        title="Visão consolidada"
        description="Resumo de acessos de todas as lojas. Esta visão é exclusiva do administrador geral."
      />
      {error ? (
        <Card>
          <ErrorState message={error} onRetry={reload} />
        </Card>
      ) : loading && !data ? (
        <CardsSkeleton count={4} />
      ) : data ? (
        <div className="space-y-6">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Stat label="Lojas" value={data.stores.length} />
            <Stat label="Pessoas com vínculo ativo" value={data.peopleWithAccess} />
            <Stat label="Vínculos ativos" value={data.activeLinks} hint="Uma pessoa pode ter vários vínculos." />
            <Stat label="Vínculos inativos" value={data.inactiveLinks} hint="Preservados para consulta e reativação." />
          </div>

          <Card>
            <CardHeader title="Lojas" description="Responsáveis e equipe de cada loja." />
            <ul className="divide-y divide-line">
              {data.stores.map(({ store, team, lastActivityAt }) => (
                <li key={store.id} className="flex flex-wrap items-start gap-x-6 gap-y-2 px-4 py-3.5 sm:px-5">
                  <div className="min-w-[10rem] flex-1">
                    <p className="text-sm font-medium text-ink">{store.name}</p>
                    <p className="text-xs text-mute">Código {store.code}</p>
                  </div>
                  <div className="min-w-[12rem] flex-[2]">
                    <p className="text-xs text-mute">{team.responsibles.length === 1 ? 'Responsável' : 'Responsáveis'}</p>
                    <p className="text-sm text-ink">{team.responsibles.join(', ') || 'Nenhum responsável ativo'}</p>
                  </div>
                  <div className="min-w-[8rem] flex-1">
                    <p className="text-xs text-mute">Equipe</p>
                    <p className="text-sm text-ink">
                      {plural(team.activeEmployees, 'funcionário', 'funcionários')}
                      {team.inactiveLinks > 0 && <span className="text-mute"> · {plural(team.inactiveLinks, 'inativo', 'inativos')}</span>}
                    </p>
                  </div>
                  <div className="min-w-[8rem] flex-1">
                    <p className="text-xs text-mute">Última atividade</p>
                    <p className="text-sm text-ink">{lastActivityAt ? formatDateTime(lastActivityAt) : 'Sem registros'}</p>
                  </div>
                </li>
              ))}
            </ul>
          </Card>
          <FutureNote />
        </div>
      ) : null}
    </>
  );
}

function StoreOverview({ store }: { store: Store }) {
  const { actor, access, dataVersion } = useSession();
  const { data, loading, error, reload } = useAsync(
    () => services.overview.storeSummary(actor!, store.id),
    [store.id, actor?.personId, dataVersion],
  );
  const shortcuts = NAV_ITEMS.filter((n) => n.module !== 'overview' && can(access, n.module, 'view'));

  return (
    <>
      <PageHeader title={store.name} description={`Código ${store.code} · visão geral da loja`} />
      <div className="space-y-6">
        {error ? (
          <Card>
            <ErrorState message={error} onRetry={reload} />
          </Card>
        ) : loading && !data ? (
          <CardsSkeleton count={3} />
        ) : data?.team ? (
          <div className="grid gap-4 sm:grid-cols-3">
            <Stat
              label={data.team.responsibles.length === 1 ? 'Responsável' : 'Responsáveis'}
              value={data.team.responsibles.length}
              hint={data.team.responsibles.join(', ') || undefined}
            />
            <Stat label="Funcionários ativos" value={data.team.activeEmployees} />
            <Stat label="Vínculos inativos" value={data.team.inactiveLinks} hint="Preservados no histórico." />
          </div>
        ) : null}

        <div className="grid gap-6 lg:grid-cols-5">
          <Card className="lg:col-span-3">
            <CardHeader title="Atalhos" description="Módulos liberados para você nesta loja." />
            {shortcuts.length === 0 ? (
              <p className="px-5 py-6 text-sm text-mute">Você tem acesso apenas à visão geral nesta loja.</p>
            ) : (
              <ul className="divide-y divide-line">
                {shortcuts.map(({ module, path, label, icon: Icon }) => (
                  <li key={module}>
                    <Link to={path} className="flex items-center gap-3 px-4 py-3 hover:bg-subtle sm:px-5">
                      <span className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-subtle text-mute">
                        <Icon className="h-5 w-5" aria-hidden />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-medium text-ink">{label}</span>
                        <span className="block truncate text-xs text-mute">{MODULE_BY_ID[module].description}</span>
                      </span>
                      <ArrowRight className="h-4 w-4 text-mute" aria-hidden />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card className="lg:col-span-2">
            <CardHeader
              title="Seu acesso nesta loja"
              description={`${access.role ? ROLE_LABEL[access.role] : ''}${access.membership?.jobTitle ? ` · ${access.membership.jobTitle}` : ''}`}
            />
            <div className="px-4 pb-2 sm:px-5">
              {loading && !data ? <ListSkeleton rows={3} /> : <PermissionSummary permissions={access.permissions} />}
            </div>
          </Card>
        </div>
        <FutureNote />
      </div>
    </>
  );
}

function FutureNote() {
  return (
    <Notice className="flex items-start gap-2">
      <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
      <span>
        Indicadores financeiros e de calendário não aparecem aqui porque esses módulos ainda não existem. Esta etapa mostra
        apenas informações de acesso e equipe.
      </span>
    </Notice>
  );
}

import { History, KeyRound, Search, ShieldCheck, ShieldOff, UserCheck, UserPen, UserPlus, UserX, Crown } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { ActivityType } from '@/domain/types';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { PageHeader } from '@/components/ui/PageHeader';
import { ListSkeleton } from '@/components/ui/Skeleton';
import { EmptyState, ErrorState } from '@/components/ui/StateViews';
import { useSession } from '@/context/SessionContext';
import { useAsync } from '@/hooks/useAsync';
import { formatDateTime } from '@/lib/format';
import { services } from '@/services';

const TYPES: Record<ActivityType, { label: string; icon: LucideIcon }> = {
  conta_criada: { label: 'Conta criada', icon: UserPlus },
  conta_editada: { label: 'Conta editada', icon: UserPen },
  conta_desativada: { label: 'Conta desativada', icon: ShieldOff },
  conta_reativada: { label: 'Conta reativada', icon: UserCheck },
  admin_concedido: { label: 'Administrador geral concedido', icon: Crown },
  admin_removido: { label: 'Administrador geral removido', icon: Crown },
  vinculo_criado: { label: 'Vínculo criado', icon: ShieldCheck },
  vinculo_editado: { label: 'Vínculo editado', icon: UserPen },
  permissoes_alteradas: { label: 'Permissões alteradas', icon: KeyRound },
  vinculo_desativado: { label: 'Vínculo desativado', icon: UserX },
  vinculo_reativado: { label: 'Vínculo reativado', icon: UserCheck },
};

const PAGE = 15;

export default function ActivityPage() {
  const { actor, scope, activeStore, stores, dataVersion } = useSession();
  const consolidated = scope.kind === 'consolidated' || !activeStore;
  const { data, loading, error, reload } = useAsync(
    () => services.activity.list(actor!, { storeId: consolidated ? null : activeStore!.id }),
    [consolidated, activeStore?.id, actor?.personId, dataVersion],
  );

  const [type, setType] = useState<ActivityType | ''>('');
  const [storeId, setStoreId] = useState('');
  const [query, setQuery] = useState('');
  const [shown, setShown] = useState(PAGE);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (data ?? []).filter(
      (a) =>
        (!type || a.type === type) &&
        (!storeId || a.storeId === storeId) &&
        (!q || [a.summary, a.actorName, a.targetPersonName].some((t) => t.toLowerCase().includes(q))),
    );
  }, [data, type, storeId, query]);

  const hasFilters = !!(type || storeId || query);
  const clear = () => {
    setType('');
    setStoreId('');
    setQuery('');
  };

  return (
    <>
      <PageHeader
        title="Histórico de atividades"
        description={
          consolidated
            ? 'Alterações de acesso registradas em todas as lojas.'
            : `Alterações de acesso registradas na ${activeStore?.name}. Nesta demonstração os registros ficam apenas neste navegador.`
        }
      />
      <Card>
        <div className="flex flex-col gap-3 border-b border-line p-3 sm:flex-row sm:flex-wrap sm:items-center sm:p-4">
          <div className="relative sm:w-64">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-mute" aria-hidden />
            <input
              type="search"
              className="input pl-9"
              placeholder="Buscar no histórico"
              aria-label="Buscar no histórico"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setShown(PAGE);
              }}
            />
          </div>
          <select
            className="input sm:w-52"
            aria-label="Filtrar por tipo"
            value={type}
            onChange={(e) => {
              setType(e.target.value as ActivityType | '');
              setShown(PAGE);
            }}
          >
            <option value="">Todos os tipos</option>
            {Object.entries(TYPES).map(([id, t]) => (
              <option key={id} value={id}>
                {t.label}
              </option>
            ))}
          </select>
          {consolidated && (
            <select
              className="input sm:w-44"
              aria-label="Filtrar por loja"
              value={storeId}
              onChange={(e) => {
                setStoreId(e.target.value);
                setShown(PAGE);
              }}
            >
              <option value="">Todas as lojas</option>
              {stores.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          )}
          {hasFilters && (
            <Button variant="ghost" onClick={clear}>
              Limpar filtros
            </Button>
          )}
        </div>

        {error ? (
          <ErrorState message={error} onRetry={reload} />
        ) : loading && !data ? (
          <ListSkeleton rows={6} />
        ) : filtered.length === 0 ? (
          <EmptyState icon={History} title={hasFilters ? 'Nenhum registro encontrado' : 'Ainda não há atividades'} action={hasFilters && <Button onClick={clear}>Limpar filtros</Button>}>
            {hasFilters
              ? 'Nenhum registro corresponde aos filtros escolhidos.'
              : 'Cadastros, edições de permissões e desativações de vínculo aparecerão aqui.'}
          </EmptyState>
        ) : (
          <>
            <ul className="divide-y divide-line">
              {filtered.slice(0, shown).map((a) => {
                const { icon: Icon, label } = TYPES[a.type];
                return (
                  <li key={a.id} className="flex items-start gap-3 px-4 py-3.5 sm:px-5">
                    <span className="mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-subtle text-mute">
                      <Icon className="h-4 w-4" aria-hidden />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm text-ink">{a.summary}</p>
                      <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-mute">
                        <span>{label}</span>
                        <span aria-hidden>·</span>
                        <span>por {a.actorName}</span>
                        <span aria-hidden>·</span>
                        <time dateTime={a.at}>{formatDateTime(a.at)}</time>
                        {consolidated && <Badge>{a.storeName ?? 'Todas as lojas'}</Badge>}
                      </p>
                    </div>
                  </li>
                );
              })}
            </ul>
            <div className="flex items-center justify-between gap-3 border-t border-line px-4 py-3 text-xs text-mute sm:px-5">
              <span>
                Mostrando {Math.min(shown, filtered.length)} de {filtered.length}
              </span>
              {filtered.length > shown && (
                <Button size="sm" onClick={() => setShown((n) => n + PAGE)}>
                  Mostrar mais
                </Button>
              )}
            </div>
          </>
        )}
      </Card>
    </>
  );
}

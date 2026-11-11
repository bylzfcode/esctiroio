import { Lock, Pencil, Plus, Search, UserCheck, UserX, Users } from 'lucide-react';
import { useMemo, useState } from 'react';
import { canActOnMembership, canManageTeam } from '@/domain/access';
import { ROLE_LABEL } from '@/domain/modules';
import { countViewableModules } from '@/domain/permissions';
import { MODULES } from '@/domain/modules';
import type { Store } from '@/domain/types';
import { useSession } from '@/context/SessionContext';
import { useToast } from '@/context/ToastContext';
import { useAsync } from '@/hooks/useAsync';
import { formatDate } from '@/lib/format';
import { services } from '@/services';
import { errorMessage } from '@/services/errors';
import type { TeamMemberRow } from '@/services/types';
import { Avatar } from '../ui/Avatar';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { PageHeader } from '../ui/PageHeader';
import { ListSkeleton } from '../ui/Skeleton';
import { EmptyState, ErrorState, Notice } from '../ui/StateViews';
import { MemberFormModal } from './MemberFormModal';

type StatusFilter = 'ativos' | 'inativos' | 'todos';

export function StoreTeam({ store }: { store: Store }) {
  const { actor, access, person, dataVersion, refresh } = useSession();
  const toast = useToast();
  const { data, loading, error, reload } = useAsync(
    () => services.team.listStoreMembers(actor!, store.id),
    [store.id, actor?.personId, dataVersion],
  );

  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<StatusFilter>('ativos');
  const [form, setForm] = useState<{ open: boolean; member: TeamMemberRow | null }>({ open: false, member: null });
  const [confirm, setConfirm] = useState<TeamMemberRow | null>(null);
  const [busy, setBusy] = useState(false);

  const isAdmin = access.role === 'admin_geral';
  const canCreate = canManageTeam(access, 'create');
  const canEdit = canManageTeam(access, 'edit');
  const canDelete = canManageTeam(access, 'delete');
  const readOnly = !canCreate && !canEdit && !canDelete;

  const rows = data ?? [];
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((r) => {
      if (status === 'ativos' && !r.membership.active) return false;
      if (status === 'inativos' && r.membership.active) return false;
      if (!q) return true;
      return [r.person.name, r.person.email, r.membership.jobTitle].some((t) => t.toLowerCase().includes(q));
    });
  }, [rows, query, status]);

  const counts = {
    ativos: rows.filter((r) => r.membership.active).length,
    inativos: rows.filter((r) => !r.membership.active).length,
    todos: rows.length,
  };

  const changeActive = async (row: TeamMemberRow, active: boolean) => {
    if (!actor) return;
    setBusy(true);
    try {
      await services.team.setMemberActive(actor, row.membership.id, active);
      toast.success(
        active
          ? `Vínculo de ${row.person.name} com a ${store.name} reativado.`
          : `Vínculo de ${row.person.name} com a ${store.name} desativado. A conta e os outros vínculos foram mantidos.`,
      );
      setConfirm(null);
      await refresh();
    } catch (err) {
      toast.error(errorMessage(err));
      setConfirm(null);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageHeader
        title="Equipe e permissões"
        description={`Pessoas vinculadas à ${store.name}. Cada pessoa tem uma conta única; o perfil e as permissões abaixo valem só para esta loja.`}
        actions={
          canCreate && (
            <Button variant="primary" icon={<Plus className="h-4 w-4" aria-hidden />} onClick={() => setForm({ open: true, member: null })}>
              {isAdmin ? 'Nova pessoa' : 'Novo funcionário'}
            </Button>
          )
        }
      />

      {readOnly && (
        <Notice className="mb-4">Você pode consultar a equipe, mas não tem permissão para cadastrar, editar ou desativar vínculos.</Notice>
      )}

      <Card>
        <div className="flex flex-col gap-3 border-b border-line p-3 sm:flex-row sm:items-center sm:justify-between sm:p-4">
          <div className="relative sm:w-72">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-mute" aria-hidden />
            <input
              type="search"
              className="input pl-9"
              placeholder="Buscar por nome, e-mail ou cargo"
              aria-label="Buscar pessoas"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          <div role="group" aria-label="Filtrar por situação" className="inline-flex rounded-lg bg-subtle p-0.5">
            {([['ativos', 'Ativos'], ['inativos', 'Inativos'], ['todos', 'Todos']] as const).map(([s, text]) => (
              <button
                key={s}
                type="button"
                aria-pressed={status === s}
                onClick={() => setStatus(s)}
                className={`rounded-md px-3 py-1.5 text-[13px] font-medium ${
                  status === s ? 'bg-surface text-ink shadow-card' : 'text-mute hover:text-ink'
                }`}
              >
                {text} <span className="text-mute">({counts[s]})</span>
              </button>
            ))}
          </div>
        </div>

        {error ? (
          <ErrorState message={error} onRetry={reload} />
        ) : loading && !data ? (
          <ListSkeleton rows={5} />
        ) : filtered.length === 0 ? (
          rows.length === 0 ? (
            <EmptyState
              icon={Users}
              title="Nenhuma pessoa vinculada a esta loja"
              action={canCreate && <Button variant="primary" onClick={() => setForm({ open: true, member: null })}>Cadastrar a primeira pessoa</Button>}
            >
              Cadastre funcionários para liberar o acesso aos módulos da loja.
            </EmptyState>
          ) : (
            <EmptyState
              icon={Search}
              title="Nenhum resultado"
              action={<Button onClick={() => { setQuery(''); setStatus('todos'); }}>Limpar filtros</Button>}
            >
              Nenhuma pessoa corresponde à busca ou ao filtro de situação escolhido.
            </EmptyState>
          )
        ) : (
          <ul className="divide-y divide-line">
            {filtered.map((row) => {
              const { membership: m, person: p } = row;
              const isSelf = p.id === person?.id;
              const mayAct = canActOnMembership(access, person?.id ?? '', m);
              const modules = countViewableModules(m.permissions);
              return (
                <li key={m.id} className={`flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3.5 sm:px-5 ${m.active ? '' : 'bg-subtle/50'}`}>
                  <div className="flex min-w-[14rem] flex-1 items-center gap-3">
                    <Avatar name={p.name} />
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-ink">
                        {p.name}
                        {isSelf && <span className="ml-1.5 text-xs font-normal text-mute">(você)</span>}
                      </p>
                      <p className="truncate text-xs text-mute">
                        {p.email}
                        {m.jobTitle && ` · ${m.jobTitle}`}
                      </p>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-1.5">
                    <Badge tone={m.role === 'responsavel' ? 'brand' : 'neutral'}>{ROLE_LABEL[m.role]}</Badge>
                    <Badge tone={m.active ? 'success' : 'warn'}>{m.active ? 'Ativo' : 'Inativo'}</Badge>
                    <span className="text-xs text-mute">
                      {modules} de {MODULES.length} módulos
                    </span>
                    {isAdmin && row.activeStoreCount !== undefined && row.activeStoreCount > 1 && (
                      <span className="text-xs text-mute">· {row.activeStoreCount} lojas ativas</span>
                    )}
                    {!m.active && m.deactivatedAt && <span className="text-xs text-mute">· desde {formatDate(m.deactivatedAt)}</span>}
                  </div>

                  <div className="flex items-center gap-1.5">
                    {!mayAct ? (
                      (canEdit || canDelete) && (
                        <span className="inline-flex items-center gap-1 text-xs text-mute">
                          <Lock className="h-3.5 w-3.5" aria-hidden />
                          {isSelf ? 'Seu vínculo' : 'Gerido pela administração geral'}
                        </span>
                      )
                    ) : m.active ? (
                      <>
                        {canEdit && (
                          <Button size="sm" icon={<Pencil className="h-3.5 w-3.5" aria-hidden />} onClick={() => setForm({ open: true, member: row })} aria-label={`Editar ${p.name}`}>
                            Editar
                          </Button>
                        )}
                        {canDelete && (
                          <Button size="sm" variant="ghost" icon={<UserX className="h-3.5 w-3.5" aria-hidden />} onClick={() => setConfirm(row)} aria-label={`Desativar vínculo de ${p.name}`}>
                            Desativar
                          </Button>
                        )}
                      </>
                    ) : (
                      canEdit && (
                        <Button size="sm" icon={<UserCheck className="h-3.5 w-3.5" aria-hidden />} onClick={() => changeActive(row, true)} loading={busy} aria-label={`Reativar vínculo de ${p.name}`}>
                          Reativar
                        </Button>
                      )
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      <MemberFormModal
        open={form.open}
        member={form.member}
        storeId={store.id}
        storeName={store.name}
        onClose={() => setForm({ open: false, member: null })}
        onSaved={async () => {
          setForm({ open: false, member: null });
          await refresh();
        }}
      />

      <ConfirmDialog
        open={!!confirm}
        danger
        busy={busy}
        title="Desativar vínculo?"
        confirmLabel="Desativar vínculo"
        onCancel={() => setConfirm(null)}
        onConfirm={() => confirm && changeActive(confirm, false)}
      >
        <p>
          <strong className="text-ink">{confirm?.person.name}</strong> perderá o acesso à <strong className="text-ink">{store.name}</strong>.
        </p>
        <ul className="list-disc space-y-1 pl-5">
          <li>A conta da pessoa e os vínculos com outras lojas continuam ativos.</li>
          <li>O histórico de atividades é preservado.</li>
          <li>O vínculo pode ser reativado depois, mantendo as permissões atuais.</li>
        </ul>
      </ConfirmDialog>
    </>
  );
}

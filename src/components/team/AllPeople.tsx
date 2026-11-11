import { Crown, Search, ShieldOff, UserCheck, Users } from 'lucide-react';
import { useMemo, useState } from 'react';
import { ROLE_LABEL } from '@/domain/modules';
import { useSession } from '@/context/SessionContext';
import { useToast } from '@/context/ToastContext';
import { useAsync } from '@/hooks/useAsync';
import { services } from '@/services';
import { errorMessage } from '@/services/errors';
import type { PersonOverview } from '@/services/types';
import { Avatar } from '../ui/Avatar';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { PageHeader } from '../ui/PageHeader';
import { ListSkeleton } from '../ui/Skeleton';
import { EmptyState, ErrorState, Notice } from '../ui/StateViews';

type AccountAction = { kind: 'grant' | 'revoke' | 'deactivate' | 'reactivate'; row: PersonOverview };

const COPY: Record<AccountAction['kind'], { title: string; confirm: string; danger: boolean }> = {
  grant: { title: 'Conceder administrador geral?', confirm: 'Conceder', danger: false },
  revoke: { title: 'Remover administrador geral?', confirm: 'Remover papel', danger: true },
  deactivate: { title: 'Desativar conta?', confirm: 'Desativar conta', danger: true },
  reactivate: { title: 'Reativar conta?', confirm: 'Reativar conta', danger: false },
};

/** Visão consolidada (administrador geral): contas e todos os seus vínculos, com gestão de contas. */
export function AllPeople() {
  const { actor, dataVersion, refresh, person: me } = useSession();
  const toast = useToast();
  const { data, loading, error, reload } = useAsync(() => services.team.listAllPeople(actor!), [actor?.personId, dataVersion]);
  const [query, setQuery] = useState('');
  const [action, setAction] = useState<AccountAction | null>(null);
  const [busy, setBusy] = useState(false);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (data ?? []).filter((p) => !q || p.person.name.toLowerCase().includes(q) || p.person.email.toLowerCase().includes(q));
  }, [data, query]);

  const confirm = async () => {
    if (!action || !actor) return;
    setBusy(true);
    const { kind, row } = action;
    try {
      if (kind === 'grant' || kind === 'revoke') await services.team.setGeneralAdmin(actor, row.person.id, kind === 'grant');
      else await services.team.setAccountActive(actor, row.person.id, kind === 'reactivate');
      toast.success(
        {
          grant: `${row.person.name} agora é administrador geral.`,
          revoke: `Papel de administrador geral removido de ${row.person.name}.`,
          deactivate: `Conta de ${row.person.name} desativada. O acesso a todas as lojas foi encerrado.`,
          reactivate: `Conta de ${row.person.name} reativada.`,
        }[kind],
      );
      setAction(null);
      await refresh();
    } catch (err) {
      // Ex.: o servidor recusa remover/desativar o último administrador geral ativo.
      toast.error(errorMessage(err));
      setAction(null);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageHeader
        title="Equipe e permissões"
        description="Todas as contas e os seus vínculos com as lojas. Para cadastrar ou editar vínculos, selecione uma loja no cabeçalho."
      />
      <Notice className="mb-4">
        A conta é única por pessoa. Cada vínculo abaixo tem perfil e permissões próprios; um vínculo inativo não afeta os demais.
        Somente o administrador geral concede ou remove os papéis de administrador geral e de responsável.
      </Notice>
      <Card>
        <div className="border-b border-line p-3 sm:p-4">
          <div className="relative sm:w-72">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-mute" aria-hidden />
            <input type="search" className="input pl-9" placeholder="Buscar por nome ou e-mail" aria-label="Buscar pessoas" value={query} onChange={(e) => setQuery(e.target.value)} />
          </div>
        </div>
        {error ? (
          <ErrorState message={error} onRetry={reload} />
        ) : loading && !data ? (
          <ListSkeleton rows={6} />
        ) : filtered.length === 0 ? (
          <EmptyState icon={Users} title="Nenhuma pessoa encontrada">Ajuste a busca para ver outras contas.</EmptyState>
        ) : (
          <ul className="divide-y divide-line">
            {filtered.map((row) => {
              const { person, links } = row;
              const inactive = person.active === false;
              return (
                <li key={person.id} className={`flex flex-wrap items-start gap-x-4 gap-y-2 px-4 py-3.5 sm:px-5 ${inactive ? 'bg-subtle/50' : ''}`}>
                  <div className="flex min-w-[14rem] flex-1 items-center gap-3">
                    <Avatar name={person.name} />
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-ink">
                        {person.name}
                        {person.id === me?.id && <span className="ml-1.5 text-xs font-normal text-mute">(você)</span>}
                      </p>
                      <p className="truncate text-xs text-mute">{person.email}</p>
                    </div>
                  </div>
                  <div className="flex max-w-xl flex-1 flex-wrap items-center gap-1.5">
                    {inactive && <Badge tone="warn">Conta desativada</Badge>}
                    {person.isGeneralAdmin ? (
                      <Badge tone="brand">Administrador geral · todas as lojas</Badge>
                    ) : links.length === 0 ? (
                      <span className="text-xs text-mute">Sem vínculos</span>
                    ) : (
                      links.map(({ membership: m, storeName }) => (
                        <Badge key={m.id} tone={m.active ? (m.role === 'responsavel' ? 'brand' : 'neutral') : 'warn'}>
                          {storeName} · {ROLE_LABEL[m.role]}
                          {!m.active && ' (inativo)'}
                        </Badge>
                      ))
                    )}
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    {person.isGeneralAdmin ? (
                      <Button size="sm" variant="ghost" icon={<Crown className="h-3.5 w-3.5" aria-hidden />} onClick={() => setAction({ kind: 'revoke', row })} aria-label={`Remover administrador geral de ${person.name}`}>
                        Remover administrador
                      </Button>
                    ) : (
                      !inactive && (
                        <Button size="sm" variant="ghost" icon={<Crown className="h-3.5 w-3.5" aria-hidden />} onClick={() => setAction({ kind: 'grant', row })} aria-label={`Tornar ${person.name} administrador geral`}>
                          Tornar administrador
                        </Button>
                      )
                    )}
                    {inactive ? (
                      <Button size="sm" icon={<UserCheck className="h-3.5 w-3.5" aria-hidden />} onClick={() => setAction({ kind: 'reactivate', row })} aria-label={`Reativar conta de ${person.name}`}>
                        Reativar conta
                      </Button>
                    ) : (
                      <Button size="sm" variant="ghost" icon={<ShieldOff className="h-3.5 w-3.5" aria-hidden />} onClick={() => setAction({ kind: 'deactivate', row })} aria-label={`Desativar conta de ${person.name}`}>
                        Desativar conta
                      </Button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      <ConfirmDialog
        open={!!action}
        title={action ? COPY[action.kind].title : ''}
        confirmLabel={action ? COPY[action.kind].confirm : ''}
        danger={action ? COPY[action.kind].danger : false}
        busy={busy}
        onCancel={() => setAction(null)}
        onConfirm={confirm}
      >
        {action?.kind === 'grant' && (
          <p>
            <strong className="text-ink">{action.row.person.name}</strong> passará a acessar todas as lojas e a visão consolidada, e poderá gerenciar
            responsáveis e outros administradores.
          </p>
        )}
        {action?.kind === 'revoke' && (
          <>
            <p>
              <strong className="text-ink">{action.row.person.name}</strong> deixará de acessar todas as lojas automaticamente. Vínculos por loja, se
              existirem, continuam valendo.
            </p>
            <p>O sistema impede remover o último administrador geral ativo.</p>
          </>
        )}
        {action?.kind === 'deactivate' && (
          <>
            <p>
              <strong className="text-ink">{action.row.person.name}</strong> perde <strong className="text-ink">imediatamente</strong> o acesso a todas as lojas.
            </p>
            <p>Os vínculos e o histórico são preservados, e a conta pode ser reativada depois. O último administrador geral ativo não pode ser desativado.</p>
          </>
        )}
        {action?.kind === 'reactivate' && (
          <p>
            A conta de <strong className="text-ink">{action.row.person.name}</strong> volta a funcionar, com os vínculos que estavam ativos.
          </p>
        )}
      </ConfirmDialog>
    </>
  );
}

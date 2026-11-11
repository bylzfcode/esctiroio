import { Search, Users } from 'lucide-react';
import { useMemo, useState } from 'react';
import { ROLE_LABEL } from '@/domain/modules';
import { useSession } from '@/context/SessionContext';
import { useAsync } from '@/hooks/useAsync';
import { services } from '@/services';
import { Avatar } from '../ui/Avatar';
import { Badge } from '../ui/Badge';
import { Card } from '../ui/Card';
import { PageHeader } from '../ui/PageHeader';
import { ListSkeleton } from '../ui/Skeleton';
import { EmptyState, ErrorState, Notice } from '../ui/StateViews';

/** Visão consolidada (administrador geral): contas e todos os seus vínculos. Somente leitura. */
export function AllPeople() {
  const { actor, dataVersion } = useSession();
  const { data, loading, error, reload } = useAsync(() => services.team.listAllPeople(actor!), [actor?.personId, dataVersion]);
  const [query, setQuery] = useState('');

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (data ?? []).filter((p) => !q || p.person.name.toLowerCase().includes(q) || p.person.email.toLowerCase().includes(q));
  }, [data, query]);

  return (
    <>
      <PageHeader
        title="Equipe e permissões"
        description="Todas as contas e os seus vínculos com as lojas. Para cadastrar ou editar, selecione uma loja no cabeçalho."
      />
      <Notice className="mb-4">
        A conta é única por pessoa. Cada vínculo abaixo tem perfil e permissões próprios; um vínculo inativo não afeta os demais.
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
            {filtered.map(({ person, links }) => (
              <li key={person.id} className="flex flex-wrap items-start gap-x-4 gap-y-2 px-4 py-3.5 sm:px-5">
                <div className="flex min-w-[14rem] flex-1 items-center gap-3">
                  <Avatar name={person.name} />
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-ink">{person.name}</p>
                    <p className="truncate text-xs text-mute">{person.email}</p>
                  </div>
                </div>
                <div className="flex max-w-xl flex-1 flex-wrap items-center gap-1.5">
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
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}

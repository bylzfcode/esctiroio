import { Check } from 'lucide-react';
import { useAsync } from '@/hooks/useAsync';
import { services } from '@/services';
import type { DemoProfile } from '@/services/types';
import { Avatar } from '../ui/Avatar';
import { Badge } from '../ui/Badge';
import { Notice } from '../ui/StateViews';
import { ErrorState } from '../ui/StateViews';
import { ListSkeleton } from '../ui/Skeleton';

const GROUPS: { kind: DemoProfile['kind']; title: string }[] = [
  { kind: 'admin', title: 'Administrador geral' },
  { kind: 'responsavel', title: 'Responsáveis' },
  { kind: 'funcionario', title: 'Funcionários' },
  { kind: 'sem_acesso', title: 'Pessoa sem vínculo ativo' },
];

export function DemoProfileList({ currentId, onSelect }: { currentId?: string | null; onSelect: (personId: string) => void }) {
  const { data, loading, error, reload } = useAsync(() => services.demo!.listProfiles(), []);

  return (
    <div className="space-y-4">
      <Notice tone="warn">
        <strong className="font-semibold">Seletor de demonstração.</strong> Escolher um perfil <u>não é login</u>: não há
        senha nem servidor. Serve apenas para conhecer como o sistema se comporta para cada tipo de acesso. Todos os
        nomes e e-mails são fictícios.
      </Notice>

      {error ? (
        <ErrorState message={error} onRetry={reload} />
      ) : loading && !data ? (
        <ListSkeleton rows={5} />
      ) : (
        GROUPS.map(({ kind, title }) => {
          const profiles = (data ?? []).filter((p) => p.kind === kind);
          if (!profiles.length) return null;
          return (
            <section key={kind} aria-labelledby={`grp-${kind}`}>
              <h3 id={`grp-${kind}`} className="mb-2 text-xs font-semibold text-mute">
                {title}
              </h3>
              <ul className="grid gap-2 sm:grid-cols-2">
                {profiles.map((p) => {
                  const current = p.person.id === currentId;
                  return (
                    <li key={p.person.id}>
                      <button
                        type="button"
                        onClick={() => onSelect(p.person.id)}
                        aria-current={current || undefined}
                        className={`flex h-full w-full items-start gap-3 rounded-xl border p-3 text-left transition-colors hover:bg-subtle ${
                          current ? 'border-brand bg-brand-soft/50' : 'border-line bg-surface'
                        }`}
                      >
                        <Avatar name={p.person.name} />
                        <span className="min-w-0 flex-1">
                          <span className="flex items-center gap-2">
                            <span className="truncate text-sm font-semibold text-ink">{p.person.name}</span>
                            {current && (
                              <Badge tone="brand">
                                <Check className="h-3 w-3" aria-hidden /> Atual
                              </Badge>
                            )}
                          </span>
                          <span className="mt-0.5 block text-xs leading-snug text-mute">{p.summary}</span>
                          {p.hint && <span className="mt-1.5 block text-xs leading-snug text-ink/80">{p.hint}</span>}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </section>
          );
        })
      )}
    </div>
  );
}

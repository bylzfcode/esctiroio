import type { LucideIcon } from 'lucide-react';
import { Hourglass } from 'lucide-react';
import { ACTION_LABEL } from '@/domain/modules';
import type { ModuleId } from '@/domain/types';
import { useSession } from '@/context/SessionContext';
import { Badge } from './Badge';
import { Card } from './Card';
import { PageHeader } from './PageHeader';
import { EmptyState } from './StateViews';

/** Módulos ainda não implementados: explicam o que virá, sem simular dados ou telas prontas. */
export function ComingSoon({
  module,
  title,
  icon,
  planned,
}: {
  module: ModuleId;
  title: string;
  icon: LucideIcon;
  planned: string[];
}) {
  const { access, activeStore } = useSession();
  const actions = access.permissions[module] ?? [];
  return (
    <>
      <PageHeader title={title} description={activeStore ? activeStore.name : 'Visão consolidada de todas as lojas'} />
      <Card>
        <EmptyState icon={icon} title={`${title} será implementado nas próximas etapas`}>
          Esta primeira etapa cobre apenas a estrutura, a navegação e os acessos. Nenhum dado de {title.toLowerCase()} é
          exibido ou simulado aqui.
        </EmptyState>
        <div className="grid gap-6 border-t border-line p-5 sm:grid-cols-2">
          <div>
            <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold text-ink">
              <Hourglass className="h-4 w-4 text-mute" aria-hidden /> O que está previsto
            </h3>
            <ul className="list-disc space-y-1 pl-5 text-[13px] leading-relaxed text-mute">
              {planned.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
            <p className="mt-2 text-xs text-mute">Escopo indicativo, sujeito a definição na próxima etapa.</p>
          </div>
          <div>
            <h3 className="mb-2 text-sm font-semibold text-ink">Suas permissões neste módulo</h3>
            <div className="flex flex-wrap gap-1.5">
              {actions.map((a) => (
                <Badge key={a} tone={a === 'view' ? 'brand' : 'neutral'}>
                  {ACTION_LABEL[a]}
                </Badge>
              ))}
            </div>
            <p className="mt-2 text-xs leading-relaxed text-mute">
              As permissões já podem ser configuradas em Equipe e permissões, mas ainda não há ações para executar.
            </p>
          </div>
        </div>
      </Card>
    </>
  );
}

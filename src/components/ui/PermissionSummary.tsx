import { ACTION_LABEL, MODULES } from '@/domain/modules';
import type { PermissionSet } from '@/domain/types';
import { Badge } from './Badge';

/** Lista somente leitura: o que a pessoa pode fazer em cada módulo. */
export function PermissionSummary({ permissions, onlyModules }: { permissions: PermissionSet; onlyModules?: string[] }) {
  const modules = MODULES.filter((m) => !onlyModules || onlyModules.includes(m.id));
  return (
    <ul className="divide-y divide-line">
      {modules.map((m) => {
        const actions = permissions[m.id] ?? [];
        return (
          <li key={m.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1.5 py-2.5">
            <span className="text-sm text-ink">{m.label}</span>
            <span className="flex flex-wrap gap-1.5">
              {actions.length ? (
                actions.map((a) => (
                  <Badge key={a} tone={a === 'view' ? 'brand' : 'neutral'}>
                    {ACTION_LABEL[a]}
                  </Badge>
                ))
              ) : (
                <span className="text-xs text-mute">Sem acesso</span>
              )}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

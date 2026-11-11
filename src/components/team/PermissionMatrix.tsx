import { Lock } from 'lucide-react';
import { ACTIONS, MODULES } from '@/domain/modules';
import { hasPermission, roleCeiling, setAction } from '@/domain/permissions';
import type { ActionId, ModuleId, PermissionSet, StoreRole } from '@/domain/types';

interface Props {
  value: PermissionSet;
  onChange: (next: PermissionSet) => void;
  role: StoreRole;
  /** Permissões de quem está concedendo: ninguém concede além do que possui. */
  actorPermissions: PermissionSet;
  disabled?: boolean;
}

type CellState =
  | { kind: 'na' } // a ação não existe no módulo
  | { kind: 'ceiling' } // reservada a responsáveis
  | { kind: 'actor' } // quem concede não possui
  | { kind: 'needs-view' } // "visualizar" desmarcado
  | { kind: 'ok' };

export function PermissionMatrix({ value, onChange, role, actorPermissions, disabled }: Props) {
  const ceiling = roleCeiling(role);

  const cellState = (module: ModuleId, action: ActionId, applicable: boolean): CellState => {
    if (!applicable) return { kind: 'na' };
    if (!hasPermission(ceiling, module, action)) return { kind: 'ceiling' };
    if (!hasPermission(actorPermissions, module, action)) return { kind: 'actor' };
    if (action !== 'view' && !hasPermission(value, module, 'view')) return { kind: 'needs-view' };
    return { kind: 'ok' };
  };

  return (
    <div>
      <div className="overflow-x-auto rounded-lg border border-line">
        <table className="w-full min-w-[34rem] border-collapse text-sm">
          <caption className="sr-only">Permissões por módulo e ação</caption>
          <thead>
            <tr className="bg-subtle text-left text-xs text-mute">
              <th scope="col" className="px-3 py-2 font-medium">
                Módulo
              </th>
              {ACTIONS.map((a) => (
                <th key={a.id} scope="col" className="px-2 py-2 text-center font-medium">
                  {a.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {MODULES.map((m) => (
              <tr key={m.id}>
                <th scope="row" className="px-3 py-2.5 text-left font-medium text-ink">
                  {m.label}
                </th>
                {ACTIONS.map((a) => {
                  const state = cellState(m.id, a.id, m.actions.includes(a.id));
                  const checked = hasPermission(value, m.id, a.id);
                  return (
                    <td key={a.id} className="px-2 py-2 text-center">
                      {state.kind === 'na' ? (
                        <span className="text-mute/60" aria-label="Não se aplica">
                          —
                        </span>
                      ) : (
                        <label
                          className="inline-flex items-center justify-center p-1"
                          title={cellTitle(state)}
                        >
                          <input
                            type="checkbox"
                            className="h-4 w-4 rounded border-line accent-[rgb(var(--c-brand))] disabled:cursor-not-allowed"
                            checked={checked}
                            disabled={disabled || state.kind !== 'ok'}
                            aria-label={`${m.label}: ${a.label}`}
                            onChange={(e) => onChange(setAction(value, m.id, a.id, e.target.checked))}
                          />
                          {state.kind === 'actor' && <Lock className="ml-0.5 h-3 w-3 text-mute" aria-hidden />}
                        </label>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ul className="mt-2 space-y-0.5 text-xs leading-relaxed text-mute">
        <li>Sem “Visualizar”, as demais ações do módulo ficam bloqueadas.</li>
        <li>
          <Lock className="mr-1 inline h-3 w-3" aria-hidden />
          Cadeado: você não pode conceder uma permissão que não possui.
        </li>
        {role === 'funcionario' && <li>Funcionários só podem consultar Equipe e permissões; a gestão é de responsáveis.</li>}
      </ul>
    </div>
  );
}

function cellTitle(state: CellState): string | undefined {
  switch (state.kind) {
    case 'ceiling':
      return 'Reservado a responsáveis';
    case 'actor':
      return 'Você não pode conceder esta permissão';
    case 'needs-view':
      return 'Marque “Visualizar” primeiro';
    default:
      return undefined;
  }
}

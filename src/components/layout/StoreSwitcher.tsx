import { Check, ChevronsUpDown, Layers, Store as StoreIcon } from 'lucide-react';
import { useCallback, useRef, useState } from 'react';
import { ROLE_LABEL } from '@/domain/modules';
import { useSession } from '@/context/SessionContext';
import { PopoverPanel, usePopoverDismiss } from '../ui/Popover';

export function StoreSwitcher() {
  const { person, stores, memberships, scope, activeStore, setScope } = useSession();
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setOpen(false), []);
  usePopoverDismiss(open, close, root);

  if (!person) return null;
  const isAdmin = person.isGeneralAdmin;
  const label = scope.kind === 'consolidated' ? 'Visão consolidada' : (activeStore?.name ?? 'Selecione uma loja');
  const roleIn = (storeId: string) => {
    const m = memberships.find((x) => x.storeId === storeId);
    return m ? ROLE_LABEL[m.role] : null;
  };

  const choose = (next: typeof scope) => {
    setScope(next);
    setOpen(false);
  };

  return (
    <div ref={root} className="relative min-w-0">
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="flex max-w-full items-center gap-2.5 rounded-lg border border-line bg-surface px-2.5 py-1.5 text-left hover:bg-subtle"
      >
        <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-brand-soft text-brand-ink">
          {scope.kind === 'consolidated' ? <Layers className="h-4 w-4" aria-hidden /> : <StoreIcon className="h-4 w-4" aria-hidden />}
        </span>
        <span className="min-w-0">
          <span className="block text-[11px] leading-tight text-mute">Loja ativa</span>
          <span className="block truncate text-sm font-semibold leading-tight text-ink">{label}</span>
        </span>
        <ChevronsUpDown className="h-4 w-4 shrink-0 text-mute" aria-hidden />
      </button>

      {open && (
        <PopoverPanel className="w-72 max-w-[calc(100vw-2rem)]">
          <div role="listbox" aria-label="Lojas autorizadas">
            <p className="px-2.5 pb-1 pt-1.5 text-xs font-medium text-mute">
              {isAdmin ? 'Todas as lojas' : 'Suas lojas autorizadas'}
            </p>
            {isAdmin && (
              <>
                <Option
                  selected={scope.kind === 'consolidated'}
                  title="Visão consolidada"
                  subtitle="Todas as lojas · exclusiva do administrador geral"
                  onClick={() => choose({ kind: 'consolidated' })}
                />
                <div className="my-1 border-t border-line" />
              </>
            )}
            {stores.map((s) => (
              <Option
                key={s.id}
                selected={scope.kind === 'store' && scope.storeId === s.id}
                title={s.name}
                subtitle={`Código ${s.code}${roleIn(s.id) ? ` · ${roleIn(s.id)}` : ''}`}
                onClick={() => choose({ kind: 'store', storeId: s.id })}
              />
            ))}
          </div>
          {!isAdmin && (
            <p className="border-t border-line px-2.5 pb-1.5 pt-2 text-xs leading-relaxed text-mute">
              Aparecem somente as lojas em que o seu vínculo está ativo.
            </p>
          )}
        </PopoverPanel>
      )}
    </div>
  );
}

function Option({ selected, title, subtitle, onClick }: { selected: boolean; title: string; subtitle: string; onClick: () => void }) {
  return (
    <button
      type="button"
      role="option"
      aria-selected={selected}
      onClick={onClick}
      className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left hover:bg-subtle ${selected ? 'bg-brand-soft/60' : ''}`}
    >
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-ink">{title}</span>
        <span className="block truncate text-xs text-mute">{subtitle}</span>
      </span>
      {selected && <Check className="h-4 w-4 shrink-0 text-brand-ink" aria-hidden />}
    </button>
  );
}

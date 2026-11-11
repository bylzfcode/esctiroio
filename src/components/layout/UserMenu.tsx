import { ChevronDown, LogOut, Repeat } from 'lucide-react';
import { useCallback, useRef, useState } from 'react';
import { ROLE_LABEL } from '@/domain/modules';
import { useAuth } from '@/context/AuthContext';
import { useSession } from '@/context/SessionContext';
import { services } from '@/services';
import { Avatar } from '../ui/Avatar';
import { PopoverPanel, usePopoverDismiss } from '../ui/Popover';

export function UserMenu({ onSwitchProfile }: { onSwitchProfile: () => void }) {
  const { person, access, activeStore } = useSession();
  const auth = useAuth();
  const demo = !!services.demo;
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setOpen(false), []);
  usePopoverDismiss(open, close, root);
  if (!person) return null;

  const roleText = access.role ? ROLE_LABEL[access.role] : 'Sem vínculo ativo';
  return (
    <div ref={root} className="relative">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2 rounded-lg p-1 hover:bg-subtle sm:pr-2"
        aria-label={`Usuário conectado: ${person.name}`}
      >
        <Avatar name={person.name} />
        <span className="hidden text-left sm:block">
          <span className="block text-[13px] font-medium leading-tight text-ink">{person.name}</span>
          <span className="block text-xs leading-tight text-mute">{roleText}</span>
        </span>
        <ChevronDown className="hidden h-4 w-4 text-mute sm:block" aria-hidden />
      </button>
      {open && (
        <PopoverPanel align="right" className="w-72 max-w-[calc(100vw-2rem)]">
          <div role="menu">
            <div className="px-2.5 pb-2 pt-1.5">
              <p className="text-sm font-semibold text-ink">{person.name}</p>
              <p className="truncate text-xs text-mute">{person.email}</p>
              <p className="mt-2 text-xs text-mute">
                {access.role === 'admin_geral'
                  ? activeStore
                    ? `Administrador geral · ${activeStore.name}`
                    : 'Administrador geral · todas as lojas'
                  : access.role
                    ? `${roleText}${access.membership?.jobTitle ? ` (${access.membership.jobTitle})` : ''}${activeStore ? ` · ${activeStore.name}` : ''}`
                    : roleText}
              </p>
            </div>
            <div className="border-t border-line pt-1">
              {demo ? (
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setOpen(false);
                    onSwitchProfile();
                  }}
                  className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm text-ink hover:bg-subtle"
                >
                  <Repeat className="h-4 w-4 text-mute" aria-hidden />
                  Trocar perfil de demonstração
                </button>
              ) : (
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setOpen(false);
                    void auth.signOut();
                  }}
                  className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm text-ink hover:bg-subtle"
                >
                  <LogOut className="h-4 w-4 text-mute" aria-hidden />
                  Sair
                </button>
              )}
            </div>
          </div>
        </PopoverPanel>
      )}
    </div>
  );
}

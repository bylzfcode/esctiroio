import { PanelLeftClose, PanelLeftOpen, X } from 'lucide-react';
import { useEffect } from 'react';
import { NavLink } from 'react-router-dom';
import { can } from '@/domain/access';
import { APP_NAME, NAV_ITEMS } from '@/app/navigation';
import { useSession } from '@/context/SessionContext';

function Brand({ expanded }: { expanded: boolean }) {
  return (
    <div className={`flex h-14 items-center gap-2.5 border-b border-line ${expanded ? 'px-4' : 'justify-center'}`}>
      <img src="/favicon.svg" alt="" className="h-8 w-8 shrink-0 rounded-lg" />
      {expanded && <span className="truncate text-[15px] font-semibold text-ink">{APP_NAME}</span>}
    </div>
  );
}

function NavList({ expanded, onNavigate }: { expanded: boolean; onNavigate?: () => void }) {
  const { access } = useSession();
  // Só aparecem os módulos liberados no contexto (loja) ativo.
  const items = NAV_ITEMS.filter((i) => can(access, i.module, 'view'));
  return (
    <nav aria-label="Principal" className="flex-1 space-y-1 overflow-y-auto p-2">
      {items.map(({ module, path, label, icon: Icon }) => (
        <NavLink
          key={module}
          to={path}
          end={path === '/'}
          onClick={onNavigate}
          title={expanded ? undefined : label}
          aria-label={expanded ? undefined : label}
          className={({ isActive }) =>
            `group relative flex items-center gap-3 rounded-lg py-2.5 text-sm font-medium transition-colors ${
              expanded ? 'px-3' : 'justify-center px-0'
            } ${isActive ? 'bg-brand-soft text-brand-ink' : 'text-mute hover:bg-subtle hover:text-ink'}`
          }
        >
          <Icon className="h-5 w-5 shrink-0" aria-hidden />
          {expanded && <span className="truncate">{label}</span>}
        </NavLink>
      ))}
    </nav>
  );
}

/** Menu lateral fixo no computador: compacto (só ícones) por padrão, expansível. */
export function DesktopSidebar({ expanded, onToggle }: { expanded: boolean; onToggle: () => void }) {
  return (
    <aside
      className={`sticky top-0 hidden h-screen shrink-0 flex-col border-r border-line bg-surface transition-[width] md:flex ${
        expanded ? 'w-60' : 'w-16'
      }`}
    >
      <Brand expanded={expanded} />
      <NavList expanded={expanded} />
      <div className="border-t border-line p-2">
        <button
          type="button"
          onClick={onToggle}
          aria-label={expanded ? 'Recolher menu' : 'Expandir menu'}
          title={expanded ? 'Recolher menu' : 'Expandir menu'}
          className={`flex w-full items-center gap-3 rounded-lg py-2.5 text-sm text-mute hover:bg-subtle hover:text-ink ${
            expanded ? 'px-3' : 'justify-center'
          }`}
        >
          {expanded ? <PanelLeftClose className="h-5 w-5" aria-hidden /> : <PanelLeftOpen className="h-5 w-5" aria-hidden />}
          {expanded && 'Recolher menu'}
        </button>
      </div>
    </aside>
  );
}

/** No celular o menu abre como gaveta sobre o conteúdo. */
export function MobileDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 md:hidden">
      <div className="absolute inset-0 bg-slate-950/50" onClick={onClose} aria-hidden />
      <aside className="relative flex h-full w-72 max-w-[85vw] flex-col bg-surface shadow-pop" aria-label="Menu">
        <div className="flex h-14 items-center justify-between border-b border-line px-4">
          <span className="flex items-center gap-2.5">
            <img src="/favicon.svg" alt="" className="h-8 w-8 rounded-lg" />
            <span className="text-[15px] font-semibold text-ink">{APP_NAME}</span>
          </span>
          <button type="button" onClick={onClose} aria-label="Fechar menu" className="rounded-md p-1.5 text-mute hover:bg-subtle">
            <X className="h-5 w-5" aria-hidden />
          </button>
        </div>
        <NavList expanded onNavigate={onClose} />
      </aside>
    </div>
  );
}

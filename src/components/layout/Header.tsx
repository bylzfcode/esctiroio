import { Menu, Moon, Sun } from 'lucide-react';
import { useTheme } from '@/context/ThemeContext';
import { StoreSwitcher } from './StoreSwitcher';
import { UserMenu } from './UserMenu';

export function Header({ onOpenMenu, onSwitchProfile }: { onOpenMenu: () => void; onSwitchProfile: () => void }) {
  const { theme, toggle } = useTheme();
  return (
    <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b border-line bg-surface/95 px-3 backdrop-blur sm:gap-3 sm:px-5">
      <button
        type="button"
        onClick={onOpenMenu}
        aria-label="Abrir menu"
        className="rounded-md p-2 text-mute hover:bg-subtle hover:text-ink md:hidden"
      >
        <Menu className="h-5 w-5" aria-hidden />
      </button>
      <div className="min-w-0 flex-1 sm:flex-none">
        <StoreSwitcher />
      </div>
      <div className="ml-auto flex items-center gap-1 sm:gap-2">
        <button
          type="button"
          onClick={toggle}
          aria-label={theme === 'dark' ? 'Usar tema claro' : 'Usar tema escuro'}
          title={theme === 'dark' ? 'Usar tema claro' : 'Usar tema escuro'}
          className="rounded-lg p-2 text-mute hover:bg-subtle hover:text-ink"
        >
          {theme === 'dark' ? <Sun className="h-5 w-5" aria-hidden /> : <Moon className="h-5 w-5" aria-hidden />}
        </button>
        <UserMenu onSwitchProfile={onSwitchProfile} />
      </div>
    </header>
  );
}

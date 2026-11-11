import { useCallback, useState, type ReactNode } from 'react';
import { readString, writeString } from '@/lib/storage';
import { useSession } from '@/context/SessionContext';
import { DemoBanner } from './DemoBanner';
import { DemoProfileModal } from './DemoProfileModal';
import { Header } from './Header';
import { DesktopSidebar, MobileDrawer } from './Sidebar';

const KEY = 'esctiroio.menu.expandido';

export function AppShell({ children }: { children: ReactNode }) {
  const { person, scope, selectProfile } = useSession();
  const [expanded, setExpanded] = useState(() => readString(KEY) === '1');
  const [drawer, setDrawer] = useState(false);
  const [profileModal, setProfileModal] = useState(false);

  const toggle = useCallback(() => {
    setExpanded((e) => {
      writeString(KEY, e ? '0' : '1');
      return !e;
    });
  }, []);
  const closeDrawer = useCallback(() => setDrawer(false), []);

  // Muda a chave ao trocar de pessoa ou de loja: a página remonta e descarta dados/filtros da loja anterior.
  const contextKey = `${person?.id ?? ''}:${scope.kind === 'store' ? scope.storeId : 'consolidado'}`;

  return (
    <div className="flex min-h-screen">
      <a
        href="#conteudo"
        className="sr-only z-[70] rounded-md bg-surface px-3 py-2 text-sm font-medium focus:not-sr-only focus:fixed focus:left-3 focus:top-3"
      >
        Ir para o conteúdo
      </a>
      <DesktopSidebar expanded={expanded} onToggle={toggle} />
      <MobileDrawer open={drawer} onClose={closeDrawer} />
      <div className="flex min-w-0 flex-1 flex-col">
        <Header onOpenMenu={() => setDrawer(true)} onSwitchProfile={() => setProfileModal(true)} />
        <DemoBanner onSwitchProfile={() => setProfileModal(true)} />
        <main id="conteudo" key={contextKey} tabIndex={-1} className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 focus:outline-none sm:px-6 sm:py-8">
          {children}
        </main>
      </div>
      <DemoProfileModal
        open={profileModal}
        currentId={person?.id ?? null}
        onClose={() => setProfileModal(false)}
        onSelect={(id) => {
          setProfileModal(false);
          selectProfile(id);
        }}
      />
    </div>
  );
}

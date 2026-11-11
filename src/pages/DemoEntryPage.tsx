import { APP_NAME } from '@/app/navigation';
import { DemoProfileList } from '@/components/layout/DemoProfileList';
import { useSession } from '@/context/SessionContext';

/** Tela inicial: ainda não existe login. A pessoa escolhe um perfil fictício. */
export default function DemoEntryPage() {
  const { selectProfile } = useSession();
  return (
    <div className="min-h-screen bg-page">
      <div className="mx-auto max-w-4xl px-4 py-10 sm:px-6 sm:py-14">
        <div className="mb-8 flex items-center gap-3">
          <img src="/favicon.svg" alt="" className="h-10 w-10 rounded-xl" />
          <div>
            <h1 className="text-xl font-semibold text-ink">{APP_NAME}</h1>
            <p className="text-sm text-mute">Modo demonstração · dados fictícios, sem backend</p>
          </div>
        </div>
        <h2 className="mb-1 text-lg font-semibold text-ink">Escolha um perfil para explorar</h2>
        <p className="mb-6 max-w-2xl text-sm text-mute">
          Cada perfil enxerga lojas, menus e ações diferentes. Troque de perfil a qualquer momento pelo menu do usuário.
        </p>
        <DemoProfileList onSelect={selectProfile} />
      </div>
    </div>
  );
}

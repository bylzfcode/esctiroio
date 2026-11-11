import { Navigate, Route, Routes } from 'react-router-dom';
import { allowedModules } from '@/domain/access';
import { ShieldOff } from 'lucide-react';
import { NAV_BY_MODULE } from '@/app/navigation';
import { AppShell } from '@/components/layout/AppShell';
import { RequireModule } from '@/components/layout/RequireModule';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { EmptyState, ErrorState } from '@/components/ui/StateViews';
import { Skeleton } from '@/components/ui/Skeleton';
import { useSession } from '@/context/SessionContext';
import ActivityPage from '@/pages/ActivityPage';
import CalendarPage from '@/pages/CalendarPage';
import DemoEntryPage from '@/pages/DemoEntryPage';
import FinancePage from '@/pages/FinancePage';
import OverviewPage from '@/pages/OverviewPage';
import SettingsPage from '@/pages/SettingsPage';
import TeamPage from '@/pages/TeamPage';
import type { ReactNode } from 'react';

export default function App() {
  const { status, error, retry, leaveDemo, stores, person, access } = useSession();

  if (status === 'sem_perfil') return <DemoEntryPage />;

  if (status === 'carregando' || (status === 'pronta' && !person)) {
    return (
      <div className="flex min-h-screen items-center justify-center p-6" role="status" aria-label="Carregando">
        <div className="w-full max-w-sm space-y-3">
          <Skeleton className="h-6 w-1/2" />
          <Skeleton className="h-24 w-full" />
          <span className="sr-only">Carregando sessão de demonstração…</span>
        </div>
      </div>
    );
  }

  if (status === 'erro') {
    return (
      <div className="flex min-h-screen items-center justify-center p-6">
        <Card className="w-full max-w-md">
          <ErrorState message={error ?? 'Falha ao iniciar a demonstração.'} onRetry={retry} />
          <div className="border-t border-line p-3 text-center">
            <Button variant="ghost" onClick={leaveDemo}>
              Escolher outro perfil
            </Button>
          </div>
        </Card>
      </div>
    );
  }

  // Pessoa sem nenhuma loja autorizada (ex.: todos os vínculos desativados).
  if (!person?.isGeneralAdmin && stores.length === 0) {
    return (
      <div className="flex min-h-screen items-center justify-center p-6">
        <Card className="w-full max-w-md">
          <EmptyState
            icon={ShieldOff}
            title="Sem acesso a nenhuma loja"
            action={<Button variant="primary" onClick={leaveDemo}>Escolher outro perfil</Button>}
          >
            Todos os vínculos de {person?.name} estão desativados. A conta continua existindo e o histórico foi preservado,
            mas é preciso que um responsável reative um vínculo para acessar uma loja.
          </EmptyState>
        </Card>
      </div>
    );
  }

  const modules = allowedModules(access);
  const guard = (module: Parameters<typeof RequireModule>[0]['module'], el: ReactNode) => (
    <RequireModule module={module}>{el}</RequireModule>
  );

  return (
    <AppShell>
      {modules.length === 0 ? (
        <Card>
          <EmptyState icon={ShieldOff} title="Nenhum módulo liberado nesta loja">
            O seu vínculo com esta loja está ativo, mas ainda não tem módulos liberados. Peça a um responsável para ajustar as
            suas permissões, ou troque de loja no cabeçalho.
          </EmptyState>
        </Card>
      ) : (
        <Routes>
          <Route path={NAV_BY_MODULE.overview.path} element={guard('overview', <OverviewPage />)} />
          <Route path={NAV_BY_MODULE.finance.path} element={guard('finance', <FinancePage />)} />
          <Route path={NAV_BY_MODULE.team.path} element={guard('team', <TeamPage />)} />
          <Route path={NAV_BY_MODULE.calendar.path} element={guard('calendar', <CalendarPage />)} />
          <Route path={NAV_BY_MODULE.activity.path} element={guard('activity', <ActivityPage />)} />
          <Route path={NAV_BY_MODULE.settings.path} element={guard('settings', <SettingsPage />)} />
          <Route path="*" element={<Navigate to={NAV_BY_MODULE[modules[0]!].path} replace />} />
        </Routes>
      )}
    </AppShell>
  );
}

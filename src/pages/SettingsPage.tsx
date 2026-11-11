import { Moon, RotateCcw, Sun } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { ROLE_LABEL } from '@/domain/modules';
import { Button } from '@/components/ui/Button';
import { Card, CardHeader } from '@/components/ui/Card';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { PageHeader } from '@/components/ui/PageHeader';
import { Switch } from '@/components/ui/Switch';
import { useSession } from '@/context/SessionContext';
import { useTheme, type Theme } from '@/context/ThemeContext';
import { useToast } from '@/context/ToastContext';
import { services } from '@/services';
import { errorMessage } from '@/services/errors';

function Row({ label, children, description }: { label: string; description?: string; children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3.5 sm:px-5">
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-ink">{label}</p>
        {description && <p className="mt-0.5 text-[13px] leading-snug text-mute">{description}</p>}
      </div>
      {children}
    </div>
  );
}

export default function SettingsPage() {
  const { theme, setTheme } = useTheme();
  const { person, access, activeStore, leaveDemo, refresh } = useSession();
  const toast = useToast();
  const demo = services.demo; // existe somente no modo demonstração
  const [failure, setFailure] = useState(demo?.isSimulatingFailure() ?? false);
  const [confirmReset, setConfirmReset] = useState(false);
  const [resetting, setResetting] = useState(false);

  const reset = async () => {
    setResetting(true);
    try {
      await demo?.resetData();
      setConfirmReset(false);
      toast.success('Dados de demonstração restaurados ao estado inicial.');
      await refresh();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setResetting(false);
    }
  };

  const themes: { id: Theme; label: string; icon: typeof Sun }[] = [
    { id: 'light', label: 'Claro', icon: Sun },
    { id: 'dark', label: 'Escuro', icon: Moon },
  ];

  return (
    <>
      <PageHeader title="Configurações" description={demo ? 'Preferências de aparência e ferramentas da demonstração.' : 'Preferências de aparência e da sua sessão.'} />
      <div className="space-y-6">
        <Card>
          <CardHeader title="Aparência" />
          <Row label="Tema" description="O tema claro é o padrão. A escolha fica salva neste navegador.">
            <div role="radiogroup" aria-label="Tema" className="inline-flex rounded-lg bg-subtle p-0.5">
              {themes.map(({ id, label, icon: Icon }) => (
                <button
                  key={id}
                  type="button"
                  role="radio"
                  aria-checked={theme === id}
                  onClick={() => setTheme(id)}
                  className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[13px] font-medium ${
                    theme === id ? 'bg-surface text-ink shadow-card' : 'text-mute hover:text-ink'
                  }`}
                >
                  <Icon className="h-4 w-4" aria-hidden />
                  {label}
                </button>
              ))}
            </div>
          </Row>
        </Card>

        <Card>
          <CardHeader title="Contexto atual" description={demo ? 'Quem você é e onde está, nesta demonstração.' : 'Sua conta e a loja em que você está.'} />
          <div className="divide-y divide-line">
            <Row label="Pessoa">
              <span className="text-sm text-mute">{person?.name}</span>
            </Row>
            <Row label="Perfil no contexto ativo">
              <span className="text-sm text-mute">{access.role ? ROLE_LABEL[access.role] : '—'}</span>
            </Row>
            <Row label="Loja ativa">
              <span className="text-sm text-mute">{activeStore ? `${activeStore.name} (código ${activeStore.code})` : 'Visão consolidada'}</span>
            </Row>
            {demo ? (
              <Row label="Trocar perfil" description="Volta à tela de escolha de perfil fictício. Não encerra nenhuma sessão real.">
                <Button onClick={leaveDemo}>Escolher outro perfil</Button>
              </Row>
            ) : (
              <Row label="Encerrar sessão" description="Sai da sua conta neste navegador.">
                <Button onClick={leaveDemo}>Sair</Button>
              </Row>
            )}
          </div>
        </Card>

        {demo && (
        <Card>
          <CardHeader title="Ferramentas da demonstração" description="Existem apenas nesta etapa e não fazem parte do sistema final." />
          <div className="divide-y divide-line">
            <Row
              label="Simular falha de carregamento"
              description="As listagens passam a falhar para você ver a mensagem de erro e o botão “Tentar novamente”."
            >
              <Switch
                label="Simular falha de carregamento"
                checked={failure}
                onChange={(v) => {
                  demo?.setSimulateFailure(v);
                  setFailure(v);
                  toast.info(v ? 'Falhas simuladas ativadas. Abra outra página para ver o erro.' : 'Falhas simuladas desativadas.');
                }}
              />
            </Row>
            <Row label="Restaurar dados de demonstração" description="Apaga cadastros, edições e histórico feitos neste navegador e volta aos dados fictícios iniciais.">
              <Button icon={<RotateCcw className="h-4 w-4" aria-hidden />} onClick={() => setConfirmReset(true)}>
                Restaurar
              </Button>
            </Row>
          </div>
        </Card>
        )}
      </div>

      <ConfirmDialog
        open={confirmReset}
        title="Restaurar dados de demonstração?"
        confirmLabel="Restaurar"
        danger
        busy={resetting}
        onCancel={() => setConfirmReset(false)}
        onConfirm={reset}
      >
        <p>Todos os cadastros, edições de permissões, desativações e registros de histórico feitos neste navegador serão apagados.</p>
      </ConfirmDialog>
    </>
  );
}

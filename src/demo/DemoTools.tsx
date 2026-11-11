import { RotateCcw } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Card, CardHeader } from '@/components/ui/Card';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { SettingsRow as Row } from '@/components/ui/SettingsRow';
import { Switch } from '@/components/ui/Switch';
import { useSession } from '@/context/SessionContext';
import { useToast } from '@/context/ToastContext';
import { services } from '@/services';
import { errorMessage } from '@/services/errors';

/** Ferramentas que só existem na demonstração: trocar de perfil, simular falha, restaurar dados. */
export function DemoTools() {
  const { leaveDemo, refresh } = useSession();
  const toast = useToast();
  const demo = services.demo;
  const [failure, setFailure] = useState(demo?.isSimulatingFailure() ?? false);
  const [confirmReset, setConfirmReset] = useState(false);
  const [resetting, setResetting] = useState(false);
  if (!demo) return null;

  const reset = async () => {
    setResetting(true);
    try {
      await demo.resetData();
      setConfirmReset(false);
      toast.success('Dados de demonstração restaurados ao estado inicial.');
      await refresh();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setResetting(false);
    }
  };

  return (
    <>
      <Card>
        <CardHeader title="Ferramentas da demonstração" description="Existem apenas neste modo e não fazem parte do sistema final." />
        <div className="divide-y divide-line">
          <Row label="Trocar perfil" description="Volta à tela de escolha de perfil fictício. Não encerra nenhuma sessão real.">
            <Button onClick={leaveDemo}>Escolher outro perfil</Button>
          </Row>
          <Row
            label="Simular falha de carregamento"
            description="As listagens passam a falhar para você ver a mensagem de erro e o botão “Tentar novamente”."
          >
            <Switch
              label="Simular falha de carregamento"
              checked={failure}
              onChange={(v) => {
                demo.setSimulateFailure(v);
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

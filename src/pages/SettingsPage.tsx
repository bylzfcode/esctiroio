import { Moon, Sun } from 'lucide-react';
import { Suspense } from 'react';
import { ROLE_LABEL } from '@/domain/modules';
import { Button } from '@/components/ui/Button';
import { Card, CardHeader } from '@/components/ui/Card';
import { PageHeader } from '@/components/ui/PageHeader';
import { SettingsRow as Row } from '@/components/ui/SettingsRow';
import { useSession } from '@/context/SessionContext';
import { useTheme, type Theme } from '@/context/ThemeContext';
import { DemoTools } from '@/demo/lazy';

export default function SettingsPage() {
  const { theme, setTheme } = useTheme();
  const { person, access, activeStore, leaveDemo } = useSession();

  const themes: { id: Theme; label: string; icon: typeof Sun }[] = [
    { id: 'light', label: 'Claro', icon: Sun },
    { id: 'dark', label: 'Escuro', icon: Moon },
  ];

  return (
    <>
      <PageHeader title="Configurações" description={__DEMO_BUILD__ ? 'Preferências de aparência e ferramentas da demonstração.' : 'Preferências de aparência e da sua sessão.'} />
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
          <CardHeader title="Contexto atual" description={__DEMO_BUILD__ ? 'Quem você é e onde está, nesta demonstração.' : 'Sua conta e a loja em que você está.'} />
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
            {!__DEMO_BUILD__ && (
              <Row label="Encerrar sessão" description="Sai da sua conta neste navegador.">
                <Button onClick={leaveDemo}>Sair</Button>
              </Row>
            )}
          </div>
        </Card>

        {/* Ferramentas exclusivas da demonstração: o código só existe no build "demo". */}
        <Suspense fallback={null}>
          <DemoTools />
        </Suspense>
      </div>
    </>
  );
}

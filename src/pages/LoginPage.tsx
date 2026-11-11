import { useState, type FormEvent } from 'react';
import { APP_NAME } from '@/app/navigation';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { TextField } from '@/components/ui/Field';
import { Notice } from '@/components/ui/StateViews';
import { useAuth } from '@/context/AuthContext';
import { errorMessage } from '@/services/errors';

type View = 'entrar' | 'recuperar' | 'enviado';

/** Entrada com e-mail e senha. Não há cadastro: contas são criadas por convite. */
export default function LoginPage() {
  const { signIn, requestPasswordReset, notice, dismissNotice } = useAuth();
  const [view, setView] = useState<View>('entrar');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submitLogin = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!email.trim() || !password) {
      setError('Informe o e-mail e a senha.');
      return;
    }
    setBusy(true);
    try {
      await signIn(email, password);
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  };

  const submitReset = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!email.trim()) {
      setError('Informe o e-mail.');
      return;
    }
    setBusy(true);
    try {
      await requestPasswordReset(email);
      setView('enviado');
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-page px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex items-center gap-3">
          <img src="/favicon.svg" alt="" className="h-10 w-10 rounded-xl" />
          <div>
            <h1 className="text-lg font-semibold text-ink">{APP_NAME}</h1>
            <p className="text-sm text-mute">Acesso restrito à equipe</p>
          </div>
        </div>

        <Card className="p-5">
          {notice && (
            <Notice tone="warn" className="mb-4">
              <span className="flex items-start justify-between gap-3">
                <span>{notice}</span>
                <button type="button" onClick={dismissNotice} className="shrink-0 font-medium underline">
                  Fechar
                </button>
              </span>
            </Notice>
          )}

          {view === 'entrar' && (
            <form onSubmit={submitLogin} noValidate className="space-y-4">
              <h2 className="text-base font-semibold text-ink">Entrar</h2>
              {error && <Notice tone="danger">{error}</Notice>}
              <TextField label="E-mail" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} />
              <TextField label="Senha" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
              <Button type="submit" variant="primary" className="w-full" loading={busy}>
                Entrar
              </Button>
              <button type="button" onClick={() => { setError(null); setView('recuperar'); }} className="w-full text-center text-[13px] font-medium text-brand-ink hover:underline">
                Esqueci minha senha
              </button>
            </form>
          )}

          {view === 'recuperar' && (
            <form onSubmit={submitReset} noValidate className="space-y-4">
              <h2 className="text-base font-semibold text-ink">Recuperar senha</h2>
              <p className="text-[13px] text-mute">Informe o e-mail da sua conta. Se ele estiver cadastrado, enviaremos um link para criar uma nova senha.</p>
              {error && <Notice tone="danger">{error}</Notice>}
              <TextField label="E-mail" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} />
              <Button type="submit" variant="primary" className="w-full" loading={busy}>
                Enviar link
              </Button>
              <button type="button" onClick={() => { setError(null); setView('entrar'); }} className="w-full text-center text-[13px] font-medium text-brand-ink hover:underline">
                Voltar para entrar
              </button>
            </form>
          )}

          {view === 'enviado' && (
            <div className="space-y-4">
              <h2 className="text-base font-semibold text-ink">Verifique seu e-mail</h2>
              <p className="text-[13px] leading-relaxed text-mute">
                Se o endereço informado estiver cadastrado, você receberá em instantes um e-mail com o link para criar uma nova senha. O link expira em pouco tempo.
              </p>
              <Button className="w-full" onClick={() => setView('entrar')}>
                Voltar para entrar
              </Button>
            </div>
          )}
        </Card>

        <p className="mt-4 text-center text-xs leading-relaxed text-mute">
          Não há cadastro aberto. Se você ainda não tem acesso, peça a um responsável da sua loja para enviar um convite.
        </p>
      </div>
    </div>
  );
}

import { useState, type FormEvent } from 'react';
import { APP_NAME } from '@/app/navigation';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { TextField } from '@/components/ui/Field';
import { Notice } from '@/components/ui/StateViews';
import { useAuth } from '@/context/AuthContext';
import { errorMessage } from '@/services/errors';

/** Regra espelhada na configuração do Auth (mínimo 10, maiúscula, minúscula e número). */
export function passwordProblem(pw: string): string | null {
  if (pw.length < 10) return 'Use ao menos 10 caracteres.';
  if (!/[a-z]/.test(pw) || !/[A-Z]/.test(pw) || !/\d/.test(pw)) return 'Misture letras maiúsculas, minúsculas e números.';
  return null;
}

/** Exibida após aceitar um convite ou abrir o link de recuperação. */
export default function SetPasswordPage() {
  const { setPassword, signOut } = useAuth();
  const [pw, setPw] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const problem = passwordProblem(pw);
    if (problem) return setError(problem);
    if (pw !== confirm) return setError('As senhas não conferem.');
    setBusy(true);
    setError(null);
    try {
      await setPassword(pw);
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-page px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex items-center gap-3">
          <img src="/favicon.svg" alt="" className="h-10 w-10 rounded-xl" />
          <h1 className="text-lg font-semibold text-ink">{APP_NAME}</h1>
        </div>
        <Card className="p-5">
          <form onSubmit={submit} noValidate className="space-y-4">
            <div>
              <h2 className="text-base font-semibold text-ink">Defina sua senha</h2>
              <p className="mt-1 text-[13px] text-mute">Crie uma senha para entrar nas próximas vezes com o seu e-mail.</p>
            </div>
            {error && <Notice tone="danger">{error}</Notice>}
            <TextField label="Nova senha" type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} hint="Mínimo de 10 caracteres, com maiúsculas, minúsculas e números." />
            <TextField label="Repita a senha" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
            <Button type="submit" variant="primary" className="w-full" loading={busy}>
              Salvar senha e entrar
            </Button>
            <button type="button" onClick={() => void signOut()} className="w-full text-center text-[13px] font-medium text-brand-ink hover:underline">
              Cancelar e sair
            </button>
          </form>
        </Card>
      </div>
    </div>
  );
}

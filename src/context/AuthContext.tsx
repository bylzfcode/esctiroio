import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { services } from '@/services';
import { parseAuthRedirect } from '@/services/supabase/authRedirect';
import { useToast } from './ToastContext';

// Autenticação REAL (Supabase Auth). No modo demo `services.auth` não existe: status "disabled".

export type AuthStatus = 'loading' | 'signed_out' | 'signed_in' | 'needs_password' | 'disabled';

interface AuthValue {
  status: AuthStatus;
  userId: string | null;
  /** Aviso a exibir na tela de entrada (sessão expirada, link inválido...). */
  notice: string | null;
  dismissNotice: () => void;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  requestPasswordReset: (email: string) => Promise<void>;
  setPassword: (password: string) => Promise<void>;
}

const AuthContext = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const auth = services.auth;
  const toast = useToast();
  const [status, setStatus] = useState<AuthStatus>(auth ? 'loading' : 'disabled');
  const [userId, setUserId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // Convite e recuperação exigem definir uma senha antes de usar o app.
  const needsPassword = useRef(false);

  useEffect(() => {
    if (!auth) return;
    let cancelled = false;
    // Lido ANTES de qualquer limpeza do endereço: o cliente já processa o token do fragmento.
    const redirect = parseAuthRedirect(window.location.hash, window.location.search);
    if (redirect.type === 'invite' || redirect.type === 'recovery') needsPassword.current = true;
    if (redirect.error) setNotice(redirect.error);

    const unsubscribe = auth.subscribe((event) => {
      if (cancelled) return;
      if (event.type === 'password_recovery') {
        needsPassword.current = true;
        setStatus('needs_password');
      } else if (event.type === 'signed_in') {
        setUserId(event.userId);
        setStatus((s) => (s === 'needs_password' || needsPassword.current ? 'needs_password' : 'signed_in'));
      } else if (event.type === 'signed_out') {
        needsPassword.current = false;
        setUserId(null);
        setStatus('signed_out');
        if (event.reason === 'expired') setNotice('Sua sessão expirou. Entre novamente para continuar.');
      }
    });

    auth
      .getSession()
      .then((session) => {
        if (cancelled) return;
        if (session) {
          setUserId(session.userId);
          setStatus(needsPassword.current ? 'needs_password' : 'signed_in');
        } else {
          setStatus('signed_out');
        }
        if (window.location.hash || window.location.search.includes('error')) {
          window.history.replaceState(null, '', window.location.pathname);
        }
      })
      .catch(() => !cancelled && setStatus('signed_out'));

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [auth]);

  const signIn = useCallback(
    async (email: string, password: string) => {
      if (!auth) return;
      await auth.signIn(email, password);
      setNotice(null);
    },
    [auth],
  );

  const signOut = useCallback(async () => {
    if (!auth) return;
    await auth.signOut();
    setNotice(null);
  }, [auth]);

  const requestPasswordReset = useCallback(async (email: string) => void (await auth?.requestPasswordReset(email)), [auth]);

  const setPassword = useCallback(
    async (password: string) => {
      if (!auth) return;
      await auth.updatePassword(password);
      needsPassword.current = false;
      setStatus('signed_in');
      toast.success('Senha definida. Você já está conectado.');
    },
    [auth, toast],
  );

  const value = useMemo<AuthValue>(
    () => ({ status, userId, notice, dismissNotice: () => setNotice(null), signIn, signOut, requestPasswordReset, setPassword }),
    [status, userId, notice, signIn, signOut, requestPasswordReset, setPassword],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth fora do AuthProvider');
  return ctx;
}

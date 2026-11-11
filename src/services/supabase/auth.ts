import type { SupabaseClient } from '@supabase/supabase-js';
import { ServiceError } from '../errors';
import type { AuthEvent, AuthService, AuthSession } from '../types';
import { NETWORK_DOWN } from './mappers';

const NETWORK_RE = /failed to fetch|networkerror|load failed|network request failed|fetch failed/i;

interface AuthErr {
  message?: string;
  code?: string;
  status?: number;
}

/** Mensagens neutras: nunca dizem se o e-mail existe ou se foi a senha que falhou. */
function mapAuthError(e: AuthErr, fallback: string): ServiceError {
  const code = e.code ?? '';
  const msg = e.message ?? '';
  if (code === 'over_request_rate_limit' || code === 'over_email_send_rate_limit' || e.status === 429) {
    return new ServiceError('unavailable', 'Muitas tentativas. Aguarde alguns minutos e tente novamente.');
  }
  if (code === 'invalid_credentials' || /invalid login credentials/i.test(msg)) {
    return new ServiceError('unauthorized', 'E-mail ou senha incorretos.');
  }
  if (code === 'email_not_confirmed') {
    return new ServiceError('unauthorized', 'O convite ainda não foi aceito. Use o link enviado por e-mail ou recupere a senha.');
  }
  if (code === 'user_banned') return new ServiceError('forbidden', 'Esta conta está desativada. Procure o administrador.');
  if (code === 'same_password') return new ServiceError('validation', 'Escolha uma senha diferente da atual.');
  if (code === 'weak_password') {
    return new ServiceError('validation', 'Senha fraca. Use ao menos 10 caracteres, com letras maiúsculas, minúsculas e números.');
  }
  if (NETWORK_RE.test(msg)) return new ServiceError('unavailable', NETWORK_DOWN);
  return new ServiceError('unavailable', fallback);
}

export function createAuthService(client: SupabaseClient): AuthService {
  // Distingue sair por vontade própria de perder a sessão (expirou, foi revogada).
  let userInitiatedSignOut = false;

  return {
    async getSession(): Promise<AuthSession | null> {
      const { data, error } = await client.auth.getSession();
      if (error || !data.session) return null;
      return { userId: data.session.user.id, email: data.session.user.email ?? '' };
    },

    subscribe(listener) {
      const { data } = client.auth.onAuthStateChange((event, session) => {
        // Importante: não chamar métodos do client dentro deste callback (risco de deadlock).
        let mapped: AuthEvent | null = null;
        if (event === 'SIGNED_IN' && session) mapped = { type: 'signed_in', userId: session.user.id };
        else if (event === 'PASSWORD_RECOVERY') mapped = { type: 'password_recovery' };
        else if (event === 'SIGNED_OUT') {
          mapped = { type: 'signed_out', reason: userInitiatedSignOut ? 'user' : 'expired' };
          userInitiatedSignOut = false;
        }
        if (mapped) listener(mapped);
      });
      return () => data.subscription.unsubscribe();
    },

    async signIn(email, password) {
      const { error } = await client.auth.signInWithPassword({ email: email.trim(), password });
      if (error) throw mapAuthError(error, 'Não foi possível entrar. Tente novamente.');
    },

    async signOut() {
      userInitiatedSignOut = true;
      const { error } = await client.auth.signOut({ scope: 'local' });
      if (error) {
        userInitiatedSignOut = false;
        throw mapAuthError(error, 'Não foi possível sair. Tente novamente.');
      }
    },

    async requestPasswordReset(email) {
      const { error } = await client.auth.resetPasswordForEmail(email.trim(), { redirectTo: window.location.origin });
      // Só falhas de limite/rede são informadas; qualquer outra resposta é tratada como sucesso,
      // para nunca revelar se o e-mail está cadastrado.
      if (error && (error.status === 429 || NETWORK_RE.test(error.message))) {
        throw mapAuthError(error, 'Não foi possível enviar o e-mail agora. Tente novamente.');
      }
    },

    async updatePassword(newPassword) {
      const { error } = await client.auth.updateUser({ password: newPassword });
      if (error) throw mapAuthError(error, 'Não foi possível definir a senha. Tente novamente.');
    },
  };
}

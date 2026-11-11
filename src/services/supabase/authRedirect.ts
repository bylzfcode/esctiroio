// Interpretação do retorno dos links enviados por e-mail (convite, recuperação de senha).
// O Supabase devolve o token no fragmento (#access_token=...&type=invite) ou, em caso de falha,
// um erro (#error=access_denied&error_code=otp_expired...).

export type AuthRedirectType = 'invite' | 'recovery' | 'signup' | 'magiclink' | 'email_change';

export interface AuthRedirectInfo {
  type: AuthRedirectType | null;
  /** Mensagem pronta para exibir, quando o link falhou. */
  error: string | null;
}

const TYPES: AuthRedirectType[] = ['invite', 'recovery', 'signup', 'magiclink', 'email_change'];

export function parseAuthRedirect(hash: string, search = ''): AuthRedirectInfo {
  const params = new URLSearchParams(hash.replace(/^#/, ''));
  const query = new URLSearchParams(search.replace(/^\?/, ''));
  const get = (k: string) => params.get(k) ?? query.get(k);

  const rawType = get('type');
  const type = TYPES.find((t) => t === rawType) ?? null;

  let error: string | null = null;
  if (get('error') || get('error_code')) {
    error =
      get('error_code') === 'otp_expired'
        ? 'O link expirou ou já foi usado. Peça um novo convite ou use “Esqueci minha senha”.'
        : 'Não foi possível validar o link recebido por e-mail. Peça um novo convite ou use “Esqueci minha senha”.';
  }
  return { type, error };
}

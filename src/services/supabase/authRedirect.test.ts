import { describe, expect, it } from 'vitest';
import { parseAuthRedirect } from './authRedirect';

describe('parseAuthRedirect', () => {
  it('reconhece convite e recuperação pelo tipo no fragmento', () => {
    expect(parseAuthRedirect('#access_token=a&refresh_token=b&type=invite')).toEqual({ type: 'invite', error: null });
    expect(parseAuthRedirect('#access_token=a&type=recovery')).toEqual({ type: 'recovery', error: null });
  });

  it('link expirado ou já usado vira mensagem em português', () => {
    const r = parseAuthRedirect('#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired');
    expect(r.type).toBeNull();
    expect(r.error).toMatch(/expirou ou já foi usado/);
  });

  it('outros erros têm mensagem genérica; erro na query string também é lido', () => {
    expect(parseAuthRedirect('', '?error=server_error').error).toMatch(/Não foi possível validar o link/);
  });

  it('endereços comuns não são tratados como retorno de e-mail', () => {
    expect(parseAuthRedirect('')).toEqual({ type: null, error: null });
    expect(parseAuthRedirect('#/equipe')).toEqual({ type: null, error: null });
    expect(parseAuthRedirect('#type=hacker')).toEqual({ type: null, error: null });
  });
});

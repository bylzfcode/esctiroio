import { describe, expect, it } from 'vitest';
import { resolveConfig, validateAnonKey } from './env';

const b64 = (o: object) => btoa(JSON.stringify(o)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const jwt = (role: string) => `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ role, iss: 'supabase-demo' })}.assinatura`;
const live = { MODE: 'production', PROD: true, VITE_SUPABASE_URL: 'https://abc.supabase.co', VITE_SUPABASE_ANON_KEY: jwt('anon') };

describe('resolveConfig · backend real', () => {
  it('aceita URL https e chave pública (anon)', () => {
    expect(resolveConfig(live)).toEqual({ kind: 'live', supabaseUrl: 'https://abc.supabase.co', anonKey: jwt('anon') });
  });

  it('aceita chave publishable do novo formato', () => {
    expect(resolveConfig({ ...live, VITE_SUPABASE_ANON_KEY: 'sb_publishable_abc123' }).kind).toBe('live');
  });

  it('SEM configuração: orienta (invalid) e NUNCA cai no mock', () => {
    for (const env of [
      { MODE: 'production', PROD: true },
      { MODE: 'development', PROD: false },
      { MODE: 'development', PROD: false, VITE_SUPABASE_URL: '  ', VITE_SUPABASE_ANON_KEY: '' },
    ]) {
      const r = resolveConfig(env);
      expect(r.kind).toBe('invalid');
      expect(r).not.toMatchObject({ kind: 'demo' });
    }
  });

  it('rejeita chave service_role (JWT) e chave secreta nova: privilegiadas nunca vão ao navegador', () => {
    for (const key of [jwt('service_role'), 'sb_secret_abc123']) {
      const r = resolveConfig({ ...live, VITE_SUPABASE_ANON_KEY: key });
      expect(r.kind).toBe('invalid');
      expect(JSON.stringify(r)).toMatch(/nunca pode ir ao navegador/);
    }
    expect(validateAnonKey(jwt('authenticated'))).toMatch(/authenticated/);
    expect(validateAnonKey(jwt('anon'))).toBeNull();
  });

  it('exige https, exceto em localhost', () => {
    expect(resolveConfig({ ...live, VITE_SUPABASE_URL: 'http://abc.supabase.co' }).kind).toBe('invalid');
    expect(resolveConfig({ ...live, VITE_SUPABASE_URL: 'http://127.0.0.1:54321' }).kind).toBe('live');
    expect(resolveConfig({ ...live, VITE_SUPABASE_URL: 'http://localhost:54321' }).kind).toBe('live');
    expect(resolveConfig({ ...live, VITE_SUPABASE_URL: 'não é url' }).kind).toBe('invalid');
  });

  it('o modo demonstração NÃO é ativado por variável: só por --mode demo', () => {
    expect(resolveConfig({ ...live, MODE: 'development', PROD: false, VITE_APP_MODE: 'demo' } as never).kind).toBe('live');
    expect(resolveConfig({ MODE: 'production', PROD: true, VITE_APP_MODE: 'demo' } as never).kind).toBe('invalid');
  });
});

describe('resolveConfig · modo demonstração', () => {
  it('ativa somente com MODE=demo', () => {
    expect(resolveConfig({ MODE: 'demo', PROD: false })).toEqual({ kind: 'demo', ignoredSupabaseVars: false });
    expect(resolveConfig({ MODE: 'demo', PROD: true })).toEqual({ kind: 'demo', ignoredSupabaseVars: false });
  });

  it('em desenvolvimento ignora variáveis do Supabase (nunca as usa)', () => {
    expect(resolveConfig({ ...live, MODE: 'demo', PROD: false })).toEqual({ kind: 'demo', ignoredSupabaseVars: true });
  });

  it('em build de produção, demo + Supabase configurado é recusado (evita confundir demo com dados reais)', () => {
    const r = resolveConfig({ ...live, MODE: 'demo', PROD: true });
    expect(r.kind).toBe('invalid');
  });
});

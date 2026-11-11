// Resolução e validação da configuração de execução. Função PURA (testável): recebe as
// variáveis do Vite e decide o modo. Não existe fallback silencioso para o mock:
//  * modo "demo" só existe com `vite --mode demo` (scripts dev:demo / build:demo);
//  * em qualquer outro modo o backend real é obrigatório e a configuração é validada.

export interface RawEnv {
  MODE: string;
  PROD: boolean;
  VITE_SUPABASE_URL?: string;
  VITE_SUPABASE_ANON_KEY?: string;
}

export type AppConfig =
  | { kind: 'demo'; ignoredSupabaseVars: boolean }
  | { kind: 'live'; supabaseUrl: string; anonKey: string }
  | { kind: 'invalid'; problems: string[] };

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', 'host.docker.internal']);

/** Lê o payload de um JWT (sem validar assinatura): só para barrar chaves privilegiadas por engano. */
function jwtRole(token: string): string | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  try {
    const b64 = parts[1]!.replace(/-/g, '+').replace(/_/g, '/');
    const json = atob(b64.padEnd(Math.ceil(b64.length / 4) * 4, '='));
    const payload = JSON.parse(json) as { role?: unknown };
    return typeof payload.role === 'string' ? payload.role : null;
  } catch {
    return null;
  }
}

export function validateAnonKey(key: string): string | null {
  if (key.startsWith('sb_secret_')) {
    return 'A chave informada é uma chave SECRETA (sb_secret_...). Ela dá acesso total ao banco e nunca pode ir ao navegador. Use a chave pública (anon / publishable).';
  }
  const role = jwtRole(key);
  if (role === 'service_role') {
    return 'A chave informada é a service_role, que ignora todas as regras de segurança. Ela nunca pode ir ao navegador. Use a chave pública (anon / publishable).';
  }
  if (role !== null && role !== 'anon') {
    return `A chave informada tem o papel "${role}". Use a chave pública (anon / publishable).`;
  }
  return null;
}

export function resolveConfig(env: RawEnv): AppConfig {
  const url = env.VITE_SUPABASE_URL?.trim() ?? '';
  const key = env.VITE_SUPABASE_ANON_KEY?.trim() ?? '';

  if (env.MODE === 'demo') {
    // Em build de produção, demo + Supabase configurado é ambíguo: o seletor de perfis fictícios
    // poderia ser confundido com acesso real. Exigimos escolher um dos dois.
    if (env.PROD && (url || key)) {
      return {
        kind: 'invalid',
        problems: [
          'Este build está no modo demonstração, mas VITE_SUPABASE_URL/VITE_SUPABASE_ANON_KEY também estão definidas.',
          'Para publicar a demonstração, remova as variáveis do Supabase. Para usar o backend real, gere o build sem "--mode demo".',
        ],
      };
    }
    return { kind: 'demo', ignoredSupabaseVars: !!(url || key) };
  }

  const problems: string[] = [];
  if (!url) problems.push('VITE_SUPABASE_URL não está definida.');
  else {
    try {
      const u = new URL(url);
      const local = LOCAL_HOSTS.has(u.hostname);
      if (u.protocol !== 'https:' && !(u.protocol === 'http:' && local)) {
        problems.push('VITE_SUPABASE_URL deve usar https (http só é aceito para localhost).');
      }
    } catch {
      problems.push('VITE_SUPABASE_URL não é uma URL válida.');
    }
  }
  if (!key) problems.push('VITE_SUPABASE_ANON_KEY não está definida.');
  else {
    const problem = validateAnonKey(key);
    if (problem) problems.push(problem);
  }
  if (problems.length) return { kind: 'invalid', problems };
  return { kind: 'live', supabaseUrl: url, anonKey: key };
}

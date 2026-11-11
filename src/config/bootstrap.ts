import { setServices } from '@/services';
import { resolveConfig, type RawEnv } from './env';

/** Evento para a sessão revalidar permissões no servidor (ouvido por SessionContext). */
export const REVALIDATE_EVENT = 'esctiroio:revalidar-sessao';

export type Runtime = { kind: 'ready'; mode: 'demo' | 'live' } | { kind: 'invalid'; problems: string[] };

/**
 * Decide o modo, valida a configuração e registra as implementações de serviços.
 * Chamada uma única vez antes de renderizar a interface.
 */
export async function initRuntime(env: RawEnv = import.meta.env as unknown as RawEnv): Promise<Runtime> {
  const config = resolveConfig(env);

  if (config.kind === 'invalid') return { kind: 'invalid', problems: config.problems };

  if (config.kind === 'demo') {
    if (config.ignoredSupabaseVars) {
      console.warn('[demo] Variáveis do Supabase foram ignoradas: o modo demonstração nunca acessa o backend real.');
    }
    // Condição constante no build: a implementação fictícia e seus dados NÃO entram no bundle de produção.
    if (import.meta.env.MODE === 'demo') {
      const { createMockServices } = await import('@/services/mock/backend');
      setServices(createMockServices());
      return { kind: 'ready', mode: 'demo' };
    }
    return { kind: 'invalid', problems: ['Modo demonstração indisponível neste build.'] };
  }

  // Condição constante no build: o cliente Supabase NÃO entra no bundle demonstração,
  // que fica estruturalmente incapaz de alcançar o backend real.
  if (import.meta.env.MODE !== 'demo') {
    const [{ createSupabaseClient }, { createSupabaseServices }] = await Promise.all([
      import('@/services/supabase/client'),
      import('@/services/supabase/services'),
    ]);
    const client = createSupabaseClient(config.supabaseUrl, config.anonKey);
    setServices(
      createSupabaseServices(client, {
        // Sessão expirada/revogada detectada em qualquer chamada: encerra localmente.
        // O evento SIGNED_OUT (não iniciado pelo usuário) leva à tela de entrada com aviso.
        onUnauthorized: () => void client.auth.signOut({ scope: 'local' }),
        // "Proibido" pode significar permissões alteradas: a sessão revalida (só atualiza se algo mudou).
        onForbidden: () => window.dispatchEvent(new Event(REVALIDATE_EVENT)),
      }),
    );
    return { kind: 'ready', mode: 'live' };
  }
  return { kind: 'invalid', problems: ['Configuração inconsistente para este build.'] };
}

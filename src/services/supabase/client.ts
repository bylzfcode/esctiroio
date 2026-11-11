import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/**
 * Cliente do navegador. Usa SOMENTE a chave pública (anon/publishable): o que cada pessoa
 * pode ler ou fazer é decidido no banco (RLS + funções) a partir do JWT da sessão.
 * Chaves privilegiadas (service_role) nunca devem existir no código do navegador.
 */
export function createSupabaseClient(url: string, anonKey: string): SupabaseClient {
  return createClient(url, anonKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      // Processa o link de convite/recuperação (token no fragmento da URL).
      detectSessionInUrl: true,
      storageKey: 'esctiroio.auth',
    },
  });
}

// Registro das implementações de serviços.
//
// NÃO existe fallback silencioso: `services` só é preenchido por `setServices`, chamado uma vez
// por src/config/bootstrap.ts depois de validar a configuração:
//   * modo "demo" (vite --mode demo): implementação fictícia do navegador;
//   * modo normal: Supabase (Auth + PostgreSQL), exigindo URL e chave pública válidas.
// Se a configuração estiver incompleta, o app mostra uma orientação e nunca usa o mock.
import type { Services } from './types';

// eslint-disable-next-line import/no-mutable-exports
export let services: Services = new Proxy({} as Services, {
  get() {
    throw new Error('Serviços não inicializados: setServices() precisa rodar antes da interface.');
  },
});

export function setServices(next: Services): void {
  services = next;
}

export * from './errors';
export type * from './types';

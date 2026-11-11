// Ponto único de troca da implementação dos serviços.
// Hoje: dados fictícios no navegador. Amanhã: uma implementação que fala com o backend.
import { createMockServices } from './mock/backend';
import type { Services } from './types';

export const services: Services = createMockServices();

export * from './errors';
export type * from './types';

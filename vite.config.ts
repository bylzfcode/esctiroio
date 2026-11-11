import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => ({
  plugins: [react()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  // Constante de build substituída em CADA uso: verdadeira somente com `--mode demo`.
  // No build normal vira `false` e o código da demonstração (componentes, textos, dados) é eliminado.
  define: { __DEMO_BUILD__: JSON.stringify(mode === 'demo') },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'tests/**/*.test.ts', 'supabase/functions/**/*.test.ts'],
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
}));

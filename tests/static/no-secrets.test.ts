// Guarda estática: nenhuma chave privilegiada pode existir no código que vai ao navegador.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = join(__dirname, '..', '..');
const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });

describe('segredos fora do navegador', () => {
  const sources = walk(join(ROOT, 'src')).filter((f) => /\.(ts|tsx)$/.test(f) && !f.endsWith('.test.ts'));

  it('o código do app não referencia a chave de serviço', () => {
    const offenders = sources.filter((f) => /SERVICE_ROLE_KEY|service_role_key/i.test(readFileSync(f, 'utf8')));
    expect(offenders).toEqual([]);
  });

  it('"service_role" só é citado para REJEITAR a chave (env.ts) e em comentário de aviso (client.ts)', () => {
    const mentions = sources.filter((f) => /service_role/.test(readFileSync(f, 'utf8'))).map((f) => f.replace(ROOT + '/', ''));
    expect(mentions.sort()).toEqual(['src/config/env.ts', 'src/services/supabase/client.ts']);
    // Em client.ts a menção está em comentário: o cliente só recebe a chave pública vinda do env.
    const code = readFileSync(join(ROOT, 'src/services/supabase/client.ts'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    expect(code).not.toMatch(/service_role/i);
  });

  it('a chave de serviço só aparece na Edge Function (servidor)', () => {
    const fn = readFileSync(join(ROOT, 'supabase/functions/invite-member/index.ts'), 'utf8');
    expect(fn).toMatch(/SUPABASE_SERVICE_ROLE_KEY/);
    expect(readFileSync(join(ROOT, 'supabase/functions/_shared/invite-member.ts'), 'utf8')).not.toMatch(/SERVICE_ROLE/);
  });

  it('.env.example não define variáveis VITE_ privilegiadas nem traz valores secretos', () => {
    const env = readFileSync(join(ROOT, '.env.example'), 'utf8');
    const assignments = env.split('\n').filter((l) => /^[A-Z_]+=/.test(l));
    for (const a of assignments) {
      expect(a).not.toMatch(/^VITE_.*(SERVICE|SECRET|PRIVATE)/i);
      expect(a.split('=')[1]?.trim()).toBe(''); // valores vazios: nada de segredo versionado
    }
    expect(env).not.toMatch(/eyJ[A-Za-z0-9_-]{20,}/); // nenhum JWT embutido
    expect(env).not.toMatch(/sb_secret_/);
  });

  it('migrações não trazem dados de exemplo (seed fica fora, só em desenvolvimento)', () => {
    const dir = join(ROOT, 'supabase/migrations');
    for (const f of readdirSync(dir)) {
      const sql = readFileSync(join(dir, f), 'utf8');
      expect(sql, f).not.toMatch(/insert\s+into\s+public\.stores/i); // lojas de exemplo ficam só em supabase/seed.sql
      expect(sql, f).not.toMatch(/demo\.example|Loja Alfa/);
    }
  });
});

// Concorrência real do guardião do último administrador. Requer Postgres de verdade:
//   TEST_DATABASE_URL=postgres://... npm test
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import { U, seedScenario } from './support/fixtures';
import { openDb, type Db } from './support/harness';

let db: Db;
beforeAll(async () => {
  db = await openDb();
  await seedScenario(db);
}, 60_000);
afterAll(async () => db?.close());

describe.runIf(!!process.env.TEST_DATABASE_URL)('concorrência (Postgres real)', () => {
  it('dois administradores não conseguem se remover ao mesmo tempo', async () => {
    const open = async (user: string) => {
      const c = new pg.Client({ connectionString: db.url });
      await c.connect();
      await c.query('begin');
      await c.query("select set_config('request.jwt.claims', $1, false)", [JSON.stringify({ sub: user, role: 'authenticated' })]);
      await c.query('set role authenticated');
      return c;
    };
    const c1 = await open(U.ana);
    const c2 = await open(U.ada);
    try {
      await c1.query('select public.set_general_admin($1, false)', [U.ada]); // ana remove ada (ainda sem commit)
      const racing = c2.query('select public.set_general_admin($1, false)', [U.ana]).then(
        () => ({ ok: true as const }),
        (e: { code?: string }) => ({ ok: false as const, code: e.code }),
      );
      await new Promise((r) => setTimeout(r, 300)); // c2 precisa estar bloqueado esperando c1
      await c1.query('commit');
      const result = await racing;
      expect(result).toEqual({ ok: false, code: 'PT409' });
    } finally {
      await c1.end();
      await c2.end();
    }
    const [row] = await db.query('select count(*)::int as n from public.profiles where is_general_admin and active');
    expect(row!.n).toBe(1);
  });
});

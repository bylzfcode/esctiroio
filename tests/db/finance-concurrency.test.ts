// Concorrência REAL do financeiro (várias conexões simultâneas). Requer Postgres de verdade:
//   TEST_DATABASE_URL=postgres://... npm test
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FIN_FULL, S, U, seedScenario } from './support/fixtures';
import { openDb, type Db } from './support/harness';

let db: Db;
beforeAll(async () => {
  if (!process.env.TEST_DATABASE_URL) return;
  db = await openDb();
  await seedScenario(db);
  for (const [who, actions] of [[U.bruno, FIN_FULL], [U.julia, ['view', 'create', 'settle']]] as const) {
    const [m] = await db.query('select permissions from public.memberships where person_id = $1 and store_id = $2', [who, S.alfa]);
    await db.query('update public.memberships set permissions = $3::jsonb where person_id = $1 and store_id = $2', [who, S.alfa, JSON.stringify({ ...m!.permissions, finance: actions })]);
  }
}, 60_000);
afterAll(async () => db?.close());

/** Uma conexão própria, autenticada como a pessoa (como o PostgREST faz), com uma chamada e commit. */
async function asUser<T>(user: string, sql: string, params: unknown[]): Promise<{ ok: true; rows: T[] } | { ok: false; code?: string; message: string }> {
  const c = new pg.Client({ connectionString: db.url });
  await c.connect();
  try {
    await c.query('begin');
    await c.query("select set_config('request.jwt.claims', $1, false)", [JSON.stringify({ sub: user, role: 'authenticated' })]);
    await c.query('set role authenticated');
    const r = await c.query(sql, params);
    await c.query('commit');
    return { ok: true, rows: r.rows as T[] };
  } catch (e) {
    await c.query('rollback').catch(() => {});
    return { ok: false, code: (e as { code?: string }).code, message: String((e as Error).message) };
  } finally {
    await c.end();
  }
}
const newAccount = async (cents: number) =>
  ((await asUser<{ id: string }>(U.bruno, 'select public.create_finance_account($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) as id', [S.alfa, 'payable', 'Conta de concorrência', '', '', cents, '2026-03-01', '2026-03-10', '', randomUUID()])) as { rows: { id: string }[] }).rows[0]!.id;
const settle = (user: string, account: string, cents: number, k = randomUUID()) =>
  asUser<{ id: string }>(user, 'select public.confirm_finance_payment($1, $2, $3, $4, $5, $6) as id', [account, cents, '2026-03-05', 'pix', '', k]);
const state = async (account: string) => (await db.query('select settled_cents::int s, balance_cents::int b, situation from public.finance_accounts_v where id = $1', [account]))[0]!;
const payments = async (account: string) => (await db.query('select count(*)::int n from public.finance_payments where account_id = $1 and reversed_at is null', [account]))[0]!.n as number;

describe.runIf(!!process.env.TEST_DATABASE_URL)('financeiro sob concorrência (Postgres real)', () => {
  it('10 liquidações simultâneas de R$ 30,00 disputando R$ 100,00: exatamente 3 passam; o saldo nunca fica negativo', async () => {
    const a = await newAccount(10000);
    const r = await Promise.all(Array.from({ length: 10 }, () => settle(U.julia, a, 3000)));
    expect(r.filter((x) => x.ok)).toHaveLength(3);
    expect(r.filter((x) => !x.ok && x.code === 'PT422')).toHaveLength(7);
    expect(await state(a)).toMatchObject({ s: 9000, b: 1000, situation: 'partial' });
    expect(await payments(a)).toBe(3);
  });

  it('duas liquidações de R$ 60,00 sobre R$ 100,00: exatamente uma', async () => {
    for (let i = 0; i < 5; i++) {
      const a = await newAccount(10000);
      const [x, y] = await Promise.all([settle(U.bruno, a, 6000), settle(U.julia, a, 6000)]);
      expect([x.ok, y.ok].filter(Boolean)).toHaveLength(1);
      expect(await state(a)).toMatchObject({ s: 6000, b: 4000 });
    }
  });

  it('20 repetições simultâneas da MESMA requisição: um único pagamento e o mesmo id para todas', async () => {
    const a = await newAccount(10000);
    const k = randomUUID();
    const r = await Promise.all(Array.from({ length: 20 }, () => settle(U.julia, a, 4000, k)));
    expect(r.every((x) => x.ok)).toBe(true);
    expect(new Set(r.map((x) => (x as { rows: { id: string }[] }).rows[0]!.id)).size).toBe(1);
    expect(await payments(a)).toBe(1);
    expect(await state(a)).toMatchObject({ s: 4000, b: 6000 });
  });

  it('criação de conta repetida em paralelo com a mesma chave: uma única conta', async () => {
    const k = randomUUID();
    const r = await Promise.all(Array.from({ length: 10 }, () =>
      asUser<{ id: string }>(U.bruno, 'select public.create_finance_account($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) as id', [S.alfa, 'receivable', 'Conta idempotente', '', '', 5000, '2026-03-01', '2026-03-10', '', k])));
    expect(r.every((x) => x.ok)).toBe(true);
    expect(new Set(r.map((x) => (x as { rows: { id: string }[] }).rows[0]!.id)).size).toBe(1);
    expect((await db.query("select count(*)::int n from public.finance_accounts where description = 'Conta idempotente'"))[0]!.n).toBe(1);
  });

  it('estornos simultâneos do mesmo pagamento: um sucesso, os demais conflito', async () => {
    const a = await newAccount(10000);
    const p = ((await settle(U.bruno, a, 10000)) as { rows: { id: string }[] }).rows[0]!.id;
    const r = await Promise.all(Array.from({ length: 6 }, () => asUser(U.bruno, 'select public.reverse_finance_payment($1, $2)', [p, 'Estorno simultâneo'])));
    expect(r.filter((x) => x.ok)).toHaveLength(1);
    expect(r.filter((x) => !x.ok && x.code === 'PT409')).toHaveLength(5);
    expect(await state(a)).toMatchObject({ s: 0, b: 10000, situation: 'pending' });
  });

  it('estorno × nova liquidação, e cancelamento × liquidação: o saldo e o estado permanecem coerentes', async () => {
    for (let i = 0; i < 8; i++) {
      const a = await newAccount(10000);
      const p = ((await settle(U.bruno, a, 10000)) as { rows: { id: string }[] }).rows[0]!.id;
      await Promise.all([asUser(U.bruno, 'select public.reverse_finance_payment($1, $2)', [p, 'Estorno concorrente']), settle(U.julia, a, 4000)]);
      const s = await state(a);
      expect(s.s).toBeLessThanOrEqual(10000);
      expect(s.s + s.b).toBe(10000);
    }
    for (let i = 0; i < 8; i++) {
      const a = await newAccount(10000);
      await Promise.all([asUser(U.bruno, 'select public.cancel_finance_account($1, $2)', [a, 'Cancelamento concorrente']), settle(U.julia, a, 1000)]);
      const [row] = await db.query('select status, (select count(*)::int from public.finance_payments where account_id = a.id and reversed_at is null) as ativos from public.finance_accounts a where id = $1', [a]);
      // nunca existe conta cancelada com liquidação ativa
      expect(row!.status === 'canceled' && row!.ativos > 0).toBe(false);
    }
  });

  it('escritas DIRETAS no banco (sem passar pelas RPCs) também não ultrapassam o saldo', async () => {
    const a = await newAccount(10000);
    const direct = async () => {
      const c = new pg.Client({ connectionString: db.url });
      await c.connect();
      try {
        await c.query("insert into public.finance_payments (account_id, store_id, amount_cents, paid_on, method, idempotency_key, created_by, created_by_name) values ($1, $2, 6000, '2026-03-05', 'pix', $3, $4, 'Serviço')", [a, S.alfa, randomUUID(), U.bruno]);
        return 'ok';
      } catch (e) {
        return (e as { code?: string }).code;
      } finally {
        await c.end();
      }
    };
    const r = await Promise.all([direct(), direct(), direct()]);
    expect(r.filter((x) => x === 'ok')).toHaveLength(1);
    expect(r.filter((x) => x === 'PT422')).toHaveLength(2);
    expect(await state(a)).toMatchObject({ s: 6000, b: 4000 });
  });
});

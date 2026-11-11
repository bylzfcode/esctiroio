import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { openDb, type Db } from './support/harness';

let db: Db;
beforeAll(async () => {
  db = await openDb();
}, 60_000);
afterAll(async () => db?.close());

describe('migrações', () => {
  it('aplicam do zero e criam o esquema esperado', async () => {
    const tables = await db.query(
      "select table_name from information_schema.tables where table_schema = 'public' order by 1",
    );
    expect(tables.map((t) => t.table_name)).toEqual(['audit_log', 'invite_attempts', 'memberships', 'profiles', 'stores']);
  });

  it('habilitam RLS em todas as tabelas públicas', async () => {
    const rows = await db.query(
      "select relname, relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r'",
    );
    expect(rows).toHaveLength(5);
    expect(rows.every((r) => r.relrowsecurity === true)).toBe(true);
  });
});

// Harness de testes de banco. Aplica as migrações REAIS de supabase/migrations num Postgres:
//  * padrão: PGlite (Postgres em WASM; `npm test` não precisa de nada instalado);
//  * com TEST_DATABASE_URL: um Postgres de verdade (banco descartável criado e removido por arquivo).
// Identidades são simuladas como o PostgREST faz: `SET ROLE` + claims JWT em request.jwt.claims.
// ATENÇÃO: isto valida SQL/RLS/funções. Não valida GoTrue, PostgREST nem Edge Functions reais.

import { PGlite } from '@electric-sql/pglite';
import { randomUUID } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import pg from 'pg';

type Row = Record<string, any>;

export interface Db {
  kind: 'pglite' | 'pg';
  /** Apenas com Postgres real: URL do banco descartável (para abrir conexões concorrentes). */
  url?: string;
  exec(sql: string): Promise<void>;
  query(sql: string, params?: unknown[]): Promise<Row[]>;
  close(): Promise<void>;
}

const ROOT = join(__dirname, '..', '..', '..');
const lit = (s: string) => `'${s.replace(/'/g, "''")}'`;

export async function openDb(): Promise<Db> {
  const url = process.env.TEST_DATABASE_URL;
  const db = url ? await openPg(url) : await openPglite();
  await db.exec(readFileSync(join(__dirname, 'supabase-stub.sql'), 'utf8'));
  const dir = join(ROOT, 'supabase', 'migrations');
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) {
    try {
      await db.exec(readFileSync(join(dir, file), 'utf8'));
    } catch (e) {
      throw new Error(`Falha na migração ${file}: ${(e as Error).message}`);
    }
  }
  return db;
}

async function openPglite(): Promise<Db> {
  const d = new PGlite();
  await d.waitReady;
  return {
    kind: 'pglite',
    exec: async (sql) => void (await d.exec(sql)),
    query: async (sql, params) => (await d.query<Row>(sql, params as any[])).rows,
    close: () => d.close(),
  };
}

async function openPg(adminUrl: string): Promise<Db> {
  const name = `t_${randomUUID().replace(/-/g, '').slice(0, 12)}`;
  const admin = new pg.Client({ connectionString: adminUrl });
  await admin.connect();
  await admin.query(`create database ${name}`);
  const u = new URL(adminUrl);
  u.pathname = `/${name}`;
  const c = new pg.Client({ connectionString: u.toString() });
  await c.connect();
  return {
    kind: 'pg',
    url: u.toString(),
    exec: async (sql) => void (await c.query(sql)),
    query: async (sql, params) => (await c.query(sql, params as any[])).rows,
    close: async () => {
      await c.end();
      await admin.query(`drop database ${name} with (force)`);
      await admin.end();
    },
  };
}

export type Who = { user: string } | 'anon' | 'service' | 'owner';
export interface DbError {
  code?: string;
  message: string;
  hint?: string;
}

export interface Caller {
  /** Executa e devolve as linhas; lança se o banco rejeitar. */
  q(sql: string, params?: unknown[]): Promise<Row[]>;
  /** Executa esperando erro. Desfaz só esta instrução (savepoint). */
  err(sql: string, params?: unknown[]): Promise<DbError>;
  /** Chama uma RPC: select public.fn(args...) */
  rpc(fn: string, ...args: unknown[]): Promise<Row[]>;
  rpcErr(fn: string, ...args: unknown[]): Promise<DbError>;
}

async function enter(db: Db, who: Who) {
  await db.exec('reset role');
  if (who === 'owner') return;
  const role = who === 'anon' ? 'anon' : who === 'service' ? 'service_role' : 'authenticated';
  const claims = typeof who === 'object' ? { sub: who.user, role } : { role };
  await db.exec(`select set_config('request.jwt.claims', ${lit(JSON.stringify(claims))}, false); set role ${role}`);
}

export function as(db: Db, who: Who): Caller {
  const run = async (sql: string, params?: unknown[]) => {
    await enter(db, who);
    try {
      return await db.query(sql, params);
    } finally {
      await db.exec('reset role');
    }
  };
  const guarded = async (sql: string, params?: unknown[]): Promise<DbError> => {
    await enter(db, who);
    await db.exec('savepoint t_err');
    try {
      await db.query(sql, params);
    } catch (e: any) {
      await db.exec('rollback to savepoint t_err; reset role');
      return { code: e.code as string | undefined, message: String(e.message), hint: e.hint as string | undefined };
    }
    await db.exec('rollback to savepoint t_err; reset role');
    throw new Error(`Era esperado erro, mas a instrução foi aceita: ${sql}`);
  };
  const call = (fn: string, args: unknown[]): [string, unknown[]] => [
    `select public.${fn}(${args.map((_, i) => `$${i + 1}`).join(', ')}) as r`,
    args.map((a) => (a !== null && typeof a === 'object' ? JSON.stringify(a) : a)),
  ];
  return {
    q: run,
    err: guarded,
    rpc: (fn, ...args) => run(...call(fn, args)),
    rpcErr: (fn, ...args) => guarded(...call(fn, args)),
  };
}

/** Transação por teste: tudo é desfeito ao final (os fixtures ficam commitados no beforeAll). */
export const begin = (db: Db) => db.exec('begin');
export const rollback = (db: Db) => db.exec('reset role; rollback');

// As regras de permissão existem em dois lugares: TypeScript (interface/demo) e SQL (servidor).
// Este teste garante que continuam equivalentes.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ACTIONS, MODULES } from '@/domain/modules';
import { changesBeyondActor, normalizePermissions } from '@/domain/permissions';
import type { ActionId, PermissionSet, StoreRole } from '@/domain/types';
import { openDb, type Db } from './support/harness';

let db: Db;
beforeAll(async () => {
  db = await openDb();
}, 60_000);
afterAll(async () => db?.close());

// Gerador pseudoaleatório determinístico (testes reprodutíveis).
let seed = 20261111;
const rnd = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;
const ALL_ACTIONS: ActionId[] = ACTIONS.map((a) => a.id);

function randomPerms(): PermissionSet {
  const out: PermissionSet = {};
  for (const m of MODULES) {
    if (rnd() < 0.7) out[m.id] = ALL_ACTIONS.filter(() => rnd() < 0.55); // inclui ações inválidas e vazias
  }
  return out;
}

describe('paridade TypeScript x SQL', () => {
  it('normalize_permissions equivale a normalizePermissions', async () => {
    for (let i = 0; i < 250; i++) {
      const perms = randomPerms();
      const role: StoreRole = rnd() < 0.5 ? 'funcionario' : 'responsavel';
      const [row] = await db.query('select private.normalize_permissions($1::jsonb, $2) as r', [JSON.stringify(perms), role]);
      expect(row!.r, JSON.stringify({ perms, role })).toEqual(normalizePermissions(perms, role));
    }
  });

  it('permissions_beyond equivale a changesBeyondActor', async () => {
    for (let i = 0; i < 250; i++) {
      const actor = normalizePermissions(randomPerms(), 'responsavel');
      const before = normalizePermissions(randomPerms(), 'funcionario');
      const after = normalizePermissions(randomPerms(), 'funcionario');
      const [row] = await db.query('select private.permissions_beyond($1::jsonb, $2::jsonb, $3::jsonb) as r', [
        JSON.stringify(actor),
        JSON.stringify(before),
        JSON.stringify(after),
      ]);
      expect(row!.r, JSON.stringify({ actor, before, after })).toBe(changesBeyondActor(actor, before, after).length > 0);
    }
  });

  it('valid_permissions aceita tudo que normalize produz', async () => {
    for (let i = 0; i < 100; i++) {
      const role: StoreRole = rnd() < 0.5 ? 'funcionario' : 'responsavel';
      const [row] = await db.query('select private.valid_permissions(private.normalize_permissions($1::jsonb, $2), $2) as r', [
        JSON.stringify(randomPerms()),
        role,
      ]);
      expect(row!.r).toBe(true);
    }
  });
});

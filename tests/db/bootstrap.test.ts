// Criação do primeiro administrador geral: só funciona uma vez, só por quem administra o banco.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { as, begin, openDb, rollback, type Db } from './support/harness';

let db: Db;
beforeAll(async () => {
  db = await openDb(); // banco virgem: nenhum administrador existe
}, 60_000);
afterAll(async () => db?.close());
beforeEach(() => begin(db));
afterEach(() => rollback(db));

const ID = '00000000-0000-4000-8000-0000000000f1';
const createAuthUser = () =>
  db.query("insert into auth.users (id, email, raw_user_meta_data) values ($1, 'dono@demo.example', '{\"full_name\":\"Dono do Projeto\"}')", [ID]);
const owner = () => as(db, 'owner');

describe('bootstrap do primeiro administrador geral', () => {
  it('sem usuário no Auth, falha com orientação', async () => {
    const e = await owner().err("select private.bootstrap_first_general_admin('ninguem@demo.example')");
    expect(e.message).toMatch(/Crie-o antes em Authentication/);
  });

  it('conta recém-criada no Auth não tem acesso até o bootstrap', async () => {
    await createAuthUser();
    const [p] = await db.query('select active, is_general_admin from public.profiles where id = $1', [ID]);
    expect(p).toMatchObject({ active: false, is_general_admin: false });
    expect((await as(db, { user: ID }).rpcErr('list_all_people')).code).toBe('PT401');
  });

  it('nem a API nem o service_role conseguem executá-lo', async () => {
    await createAuthUser();
    for (const w of ['anon', 'service', { user: ID }] as const) {
      const e = await as(db, w).err("select private.bootstrap_first_general_admin('dono@demo.example')");
      expect(e.code).toBe('42501');
    }
  });

  it('define o administrador uma única vez e audita o evento', async () => {
    await createAuthUser();
    const [r] = await owner().q("select private.bootstrap_first_general_admin('Dono@Demo.Example') as msg");
    expect(r!.msg).toMatch(/dono@demo\.example/);
    const [p] = await db.query('select active, is_general_admin, activated_at from public.profiles where id = $1', [ID]);
    expect(p).toMatchObject({ active: true, is_general_admin: true });
    expect(p!.activated_at).not.toBeNull();
    // A partir daqui a pessoa usa a interface normalmente
    expect((await as(db, { user: ID }).rpc('consolidated_summary'))[0]!.r.stores).toEqual([]);
    const log = await db.query('select action, actor_name from public.audit_log order by seq');
    expect(log.map((l) => l.action)).toEqual(['conta_criada', 'admin_concedido']);
    expect(log.every((l) => l.actor_name === 'Sistema')).toBe(true);
    // Não pode ser repetido (nem para outra conta)
    await db.query("insert into auth.users (id, email) values ('00000000-0000-4000-8000-0000000000f2', 'outro@demo.example')");
    const again = await owner().err("select private.bootstrap_first_general_admin('outro@demo.example')");
    expect(again.message).toMatch(/Já existe um administrador geral/);
  });
});

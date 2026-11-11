// Políticas de acesso verificadas com IDENTIDADES DISTINTAS (anon, funcionário, responsável,
// administrador...), não com uma chave privilegiada. Cada teste roda numa transação desfeita ao final.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { EMAIL, FULL, S, U, as_user, seedScenario } from './support/fixtures';
import { as, begin, openDb, rollback, type Db } from './support/harness';

let db: Db;
beforeAll(async () => {
  db = await openDb();
  await seedScenario(db);
}, 60_000);
afterAll(async () => db?.close());
beforeEach(() => begin(db));
afterEach(() => rollback(db));

const who = {
  anon: () => as(db, 'anon'),
  service: () => as(db, 'service'),
  owner: () => as(db, 'owner'),
  u: (k: keyof typeof U) => as(db, as_user(k)),
};
const ids = (rows: { id?: string; store_id?: string }[], key: 'id' | 'store_id' = 'id') => rows.map((r) => r[key]).sort();
const membershipId = async (person: keyof typeof U, store: string) =>
  (await who.owner().q('select id from public.memberships where person_id = $1 and store_id = $2', [U[person], store]))[0]!.id as string;

const CALENDAR_ONLY = { overview: ['view'], calendar: ['view'] };

describe('isolamento e leitura', () => {
  it('anon não lê nenhuma tabela nem executa nenhuma função', async () => {
    for (const t of ['stores', 'profiles', 'memberships', 'audit_log']) {
      expect((await who.anon().err(`select * from public.${t}`)).code).toBe('42501');
    }
    expect((await who.anon().rpcErr('list_all_people')).code).toBe('42501');
    expect((await who.anon().rpcErr('store_summary', S.alfa)).code).toBe('42501');
    expect((await who.anon().rpcErr('precheck_member_invite', S.alfa, 'x@y.zz', 'funcionario', CALENDAR_ONLY)).code).toBe('42501');
  });

  it('cada pessoa vê somente as lojas em que tem vínculo ativo; admin vê todas', async () => {
    expect(ids(await who.u('lucas').q('select id from public.stores'))).toEqual([S.beta]);
    expect(ids(await who.u('igor').q('select id from public.stores'))).toEqual([S.alfa, S.beta].sort());
    expect(ids(await who.u('carla').q('select id from public.stores'))).toEqual([S.beta, S.gama].sort());
    expect(await who.u('ines').q('select id from public.stores')).toEqual([]);
    expect(await who.u('ana').q('select id from public.stores')).toHaveLength(3);
  });

  it('não expõe contas de outras lojas: cada um lê só a própria conta', async () => {
    expect(ids(await who.u('bruno').q('select id from public.profiles'))).toEqual([U.bruno]);
    expect(await who.u('bruno').q('select id from public.profiles where email = $1', [EMAIL('carla')])).toEqual([]);
    expect(await who.u('ana').q('select id from public.profiles')).toHaveLength(11);
  });

  it('vínculos: funcionário sem "visualizar equipe" vê só o próprio; com ela, só os da sua loja', async () => {
    expect((await who.u('lucas').q('select person_id from public.memberships')).map((r) => r.person_id)).toEqual([U.lucas]);
    // Igor tem team.view na Alfa (vê 4 vínculos) e nada além do próprio na Beta.
    const igor = await who.u('igor').q('select person_id, store_id from public.memberships');
    expect(igor.filter((r) => r.store_id === S.alfa)).toHaveLength(4);
    expect(igor.filter((r) => r.store_id === S.beta)).toHaveLength(1);
    expect(igor.some((r) => r.store_id === S.gama)).toBe(false);
  });

  it('RPCs de leitura respeitam loja e permissão', async () => {
    const alfa = await who.u('bruno').rpc('list_store_members', S.alfa);
    expect(alfa[0]!.r.map((x: any) => x.person.email).sort()).toEqual(
      [EMAIL('bruno'), EMAIL('helena'), EMAIL('igor'), EMAIL('julia')].sort(),
    );
    expect((await who.u('bruno').rpcErr('list_store_members', S.beta)).code).toBe('PT403');
    expect((await who.u('lucas').rpcErr('list_store_members', S.beta)).code).toBe('PT403'); // sem team.view
    expect((await who.u('bruno').rpcErr('list_all_people')).code).toBe('PT403');
    expect((await who.u('bruno').rpcErr('consolidated_summary')).code).toBe('PT403');
    expect((await who.u('bruno').rpcErr('store_summary', S.gama)).code).toBe('PT403');
    expect((await who.u('ana').rpc('consolidated_summary'))[0]!.r.stores).toHaveLength(3);
    // O resumo omite o que a pessoa não pode ver
    const s = (await who.u('lucas').rpc('store_summary', S.beta))[0]!.r;
    expect(s.team).toBeNull();
    expect(s.last_activity_at).toBeNull();
  });

  it('o schema private não é utilizável por usuários da API', async () => {
    expect((await who.u('bruno').err('select private.bootstrap_first_general_admin($1)', ['x@y.zz'])).code).toBe('42501');
    expect((await who.u('bruno').err("select private.fail('PT403', 'x')")).code).toBe('42501');
    expect((await who.anon().err('select private.is_general_admin()')).code).toBe('42501');
  });
});

describe('escrita direta é negada (somente RPC)', () => {
  it('authenticated não faz INSERT/UPDATE/DELETE em nenhuma tabela', async () => {
    const bruno = who.u('bruno');
    expect((await bruno.err("update public.memberships set role = 'responsavel' where person_id = $1", [U.igor])).code).toBe('42501');
    expect((await bruno.err('delete from public.memberships where person_id = $1', [U.igor])).code).toBe('42501');
    expect(
      (await bruno.err("insert into public.memberships (person_id, store_id, role, permissions) values ($1, $2, 'funcionario', $3)", [U.ines, S.alfa, JSON.stringify(CALENDAR_ONLY)])).code,
    ).toBe('42501');
    expect((await bruno.err('update public.profiles set is_general_admin = true where id = $1', [U.bruno])).code).toBe('42501');
    expect((await bruno.err("insert into public.stores (code, name) values ('Z99', 'Loja Z')")).code).toBe('42501');
    expect((await bruno.err("update public.stores set name = 'x' where id = $1", [S.alfa])).code).toBe('42501');
    expect((await bruno.err("insert into public.audit_log (actor_name, action, summary) values ('x','conta_criada','x')")).code).toBe('42501');
  });
});

describe('escalada de privilégios', () => {
  it('responsável não cria responsável nem administrador; cria funcionário', async () => {
    const e = await who.u('bruno').rpcErr('create_membership', S.alfa, U.ines, 'responsavel', '', FULL);
    expect(e.code).toBe('PT403');
    expect(e.message).toMatch(/administrador geral/);
    expect((await who.u('bruno').rpc('create_membership', S.alfa, U.ines, 'funcionario', 'Caixa', CALENDAR_ONLY))[0]!.r).toBeTruthy();
    // Administrador geral pode conceder o papel de responsável
    expect((await who.u('ana').rpc('create_membership', S.gama, U.ines, 'responsavel', '', FULL))[0]!.r).toBeTruthy();
  });

  it('administrador geral não pode ser vinculado como funcionário', async () => {
    const e = await who.u('ana').rpcErr('create_membership', S.alfa, U.ada, 'funcionario', '', CALENDAR_ONLY);
    expect(e.code).toBe('PT422');
  });

  it('ninguém concede permissões superiores às próprias (responsável restrito)', async () => {
    // O administrador restringe Helena: sem Financeiro e sem "excluir" em Calendário.
    await who.u('ana').rpc('update_membership', await membershipId('helena', S.alfa), 'Subgerente', 'responsavel', {
      overview: ['view'],
      team: ['view', 'create', 'edit', 'delete', 'export'],
      calendar: ['view', 'create', 'edit'],
    });
    const igorAlfa = await membershipId('igor', S.alfa);
    const helena = who.u('helena');
    const grant = { overview: ['view'], team: ['view'], calendar: ['view', 'create', 'edit', 'delete'] };
    expect((await helena.rpcErr('update_membership', igorAlfa, '', 'funcionario', grant)).code).toBe('PT403');
    expect(
      (await helena.rpcErr('update_membership', igorAlfa, '', 'funcionario', { overview: ['view'], team: ['view'], finance: ['view'], calendar: ['view'] })).code,
    ).toBe('PT403');
    expect((await helena.rpcErr('create_membership', S.alfa, U.ines, 'funcionario', '', { overview: ['view'], finance: ['view'] })).code).toBe('PT403');
    // Dentro do que ela possui, funciona
    await helena.rpc('update_membership', igorAlfa, '', 'funcionario', { overview: ['view'], team: ['view'], calendar: ['view', 'create', 'edit'] });
  });

  it('funcionário nunca recebe ações administrativas em Equipe (o servidor normaliza)', async () => {
    const id = (await who.u('bruno').rpc('create_membership', S.alfa, U.ines, 'funcionario', '', { overview: ['view'], team: ['view', 'create', 'delete'] }))[0]!.r;
    const [row] = await who.owner().q('select permissions from public.memberships where id = $1', [id]);
    expect(row!.permissions.team).toEqual(['view']);
  });

  it('responsável não altera outros responsáveis, nem o próprio vínculo, nem perfis', async () => {
    const bruno = who.u('bruno');
    const helena = await membershipId('helena', S.alfa);
    const own = await membershipId('bruno', S.alfa);
    const igor = await membershipId('igor', S.alfa);
    expect((await bruno.rpcErr('update_membership', helena, 'X', 'responsavel', FULL)).message).toMatch(/outros responsáveis/);
    expect((await bruno.rpcErr('set_membership_active', helena, false)).code).toBe('PT403');
    expect((await bruno.rpcErr('update_membership', own, 'X', 'responsavel', FULL)).message).toMatch(/próprio vínculo/);
    expect((await bruno.rpcErr('set_membership_active', own, false)).code).toBe('PT403');
    // promover funcionário e rebaixar responsável: exclusivo do administrador geral
    expect((await bruno.rpcErr('update_membership', igor, '', 'responsavel', FULL)).message).toMatch(/administrador geral/);
    await who.u('ana').rpc('update_membership', igor, '', 'responsavel', FULL);
    await who.u('ana').rpc('update_membership', helena, '', 'funcionario', CALENDAR_ONLY);
    const roles = await who.owner().q('select role from public.memberships where id = any($1::uuid[]) order by id', [[igor, helena]]);
    expect(roles.map((r) => r.role).sort()).toEqual(['funcionario', 'responsavel']);
  });

  it('só o administrador geral concede ou remove administrador geral e gerencia contas', async () => {
    for (const k of ['bruno', 'carla', 'igor'] as const) {
      expect((await who.u(k).rpcErr('set_general_admin', U.ines, true)).code).toBe('PT403');
      expect((await who.u(k).rpcErr('set_account_active', U.lucas, false)).code).toBe('PT403');
      // Renomear a conta (compartilhada entre lojas) junto com a edição do vínculo: só administrador geral
      if (k === 'bruno') {
        const e = await who.u('bruno').rpcErr('update_membership', await membershipId('igor', S.alfa), '', 'funcionario', CALENDAR_ONLY, 'Outro Nome');
        expect(e).toMatchObject({ code: 'PT403', message: expect.stringMatching(/dados da conta/) });
      }
    }
    await who.u('ana').rpc('set_general_admin', U.ines, true);
    expect((await who.owner().q('select is_general_admin from public.profiles where id = $1', [U.ines]))[0]!.is_general_admin).toBe(true);
    // Ines agora acessa todas as lojas
    expect(await who.u('ines').q('select id from public.stores')).toHaveLength(3);
  });

  it('administrador geral renomeia a conta na mesma transação da edição; a auditoria registra', async () => {
    const igor = await membershipId('igor', S.alfa);
    await who.u('ana').rpc('update_membership', igor, '', 'funcionario', CALENDAR_ONLY, 'Igor de Lima');
    expect((await who.owner().q('select full_name from public.profiles where id = $1', [U.igor]))[0]!.full_name).toBe('Igor de Lima');
    const log = await who.u('ana').q("select summary, store_id from public.audit_log where action = 'conta_editada' and target_person_id = $1", [U.igor]);
    expect(log[0]).toMatchObject({ summary: 'Nome da conta alterado de Igor para Igor de Lima.', store_id: null });
    // Falha na validação do vínculo desfaz também o nome (atomicidade)
    const e = await who.u('ana').rpcErr('update_membership', igor, '', 'funcionario', { calendar: ['create'] }, 'Nome Que Nao Vale');
    expect(e.code).toBe('PT422');
    expect((await who.owner().q('select full_name from public.profiles where id = $1', [U.igor]))[0]!.full_name).toBe('Igor de Lima');
  });

  it('perfil por loja: Carla gerencia na Beta e não na Gama', async () => {
    const carla = who.u('carla');
    expect((await carla.rpc('create_membership', S.beta, U.ines, 'funcionario', '', CALENDAR_ONLY))[0]!.r).toBeTruthy();
    expect((await carla.rpcErr('create_membership', S.gama, U.ines, 'funcionario', '', CALENDAR_ONLY)).code).toBe('PT403');
    expect((await carla.rpcErr('list_store_members', S.gama)).code).toBe('PT403');
  });

  it('funcionário com "visualizar equipe" lê a lista, mas não altera nada', async () => {
    for (const k of ['igor', 'fabio'] as const) {
      const store = k === 'igor' ? S.alfa : S.gama;
      expect((await who.u(k).rpc('list_store_members', store))[0]!.r.length).toBeGreaterThan(0);
      expect((await who.u(k).rpcErr('create_membership', store, U.ines, 'funcionario', '', CALENDAR_ONLY)).code).toBe('PT403');
    }
    const julia = await membershipId('julia', S.alfa);
    expect((await who.u('igor').rpcErr('set_membership_active', julia, false)).code).toBe('PT403');
    expect((await who.u('igor').rpcErr('update_membership', julia, '', 'funcionario', CALENDAR_ONLY)).code).toBe('PT403');
  });

  it('responsável de uma loja não gerencia vínculos de outra (por id de vínculo)', async () => {
    const lucas = await membershipId('lucas', S.beta);
    expect((await who.u('bruno').rpcErr('update_membership', lucas, '', 'funcionario', CALENDAR_ONLY)).code).toBe('PT403');
    expect((await who.u('bruno').rpcErr('set_membership_active', lucas, false)).code).toBe('PT403');
  });

  it('pessoa e loja de um vínculo são imutáveis, até para quem administra o banco', async () => {
    const id = await membershipId('igor', S.alfa);
    expect((await who.owner().err('update public.memberships set store_id = $2 where id = $1', [id, S.gama])).code).toBe('PT403');
    expect((await who.owner().err('update public.memberships set person_id = $2 where id = $1', [id, U.ines])).code).toBe('PT403');
  });

  it('o banco recusa permissões fora do formato válido', async () => {
    const bad = [
      { team: ['create'] }, // sem visualizar
      { finance: ['view', 'fly'] }, // ação inexistente
      { moon: ['view'] }, // módulo inexistente
      { overview: ['view', 'create'] }, // ação que não se aplica ao módulo
    ];
    for (const p of bad) {
      const e = await who.owner().err(
        "insert into public.memberships (person_id, store_id, role, permissions) values ($1, $2, 'funcionario', $3)",
        [U.ines, S.alfa, JSON.stringify(p)],
      );
      expect(e.code, JSON.stringify(p)).toBe('23514');
    }
    const e = await who.owner().err(
      "insert into public.memberships (person_id, store_id, role, permissions) values ($1, $2, 'funcionario', $3)",
      [U.ines, S.alfa, JSON.stringify({ team: ['view', 'edit'] })],
    );
    expect(e.code).toBe('23514'); // funcionário não recebe ação administrativa
  });
});

describe('vínculos desativados e contas inativas', () => {
  it('desativar o vínculo bloqueia imediatamente a loja, preservando histórico e demais vínculos', async () => {
    const igorAlfa = await membershipId('igor', S.alfa);
    expect((await who.u('igor').rpc('store_summary', S.alfa))[0]!.r.store.id).toBe(S.alfa);

    await who.u('bruno').rpc('set_membership_active', igorAlfa, false);

    const igor = who.u('igor');
    expect(ids(await igor.q('select id from public.stores'))).toEqual([S.beta]);
    expect((await igor.q('select store_id from public.memberships')).map((r) => r.store_id)).toEqual([S.beta]);
    expect((await igor.rpcErr('store_summary', S.alfa)).code).toBe('PT403');
    expect((await igor.rpcErr('list_store_members', S.alfa)).code).toBe('PT403');
    expect(await igor.q('select id from public.audit_log where store_id = $1', [S.alfa])).toEqual([]);
    // Demais vínculos e a conta continuam funcionando
    expect((await igor.rpc('store_summary', S.beta))[0]!.r.store.id).toBe(S.beta);
    expect(await igor.q('select id from public.profiles')).toHaveLength(1);
    // Histórico e vínculo preservados (com as permissões, para reativação)
    const [m] = await who.owner().q('select active, deactivated_at, permissions from public.memberships where id = $1', [igorAlfa]);
    expect(m!.active).toBe(false);
    expect(m!.deactivated_at).not.toBeNull();
    expect(m!.permissions.calendar).toEqual(['view', 'create']);
    const log = await who.u('ana').q("select action from public.audit_log where target_person_id = $1 and action = 'vinculo_desativado'", [U.igor]);
    expect(log).toHaveLength(1);
    // Reativar devolve o acesso
    await who.u('bruno').rpc('set_membership_active', igorAlfa, true);
    expect(ids(await igor.q('select id from public.stores'))).toEqual([S.alfa, S.beta].sort());
  });

  it('um vínculo desativado não pode ser editado até ser reativado', async () => {
    const id = await membershipId('julia', S.alfa);
    await who.u('bruno').rpc('set_membership_active', id, false);
    expect((await who.u('bruno').rpcErr('update_membership', id, '', 'funcionario', CALENDAR_ONLY)).code).toBe('PT409');
  });

  it('desativar o vínculo de um responsável tira dele o poder de gerenciar a loja', async () => {
    await who.u('ana').rpc('set_membership_active', await membershipId('bruno', S.alfa), false);
    expect((await who.u('bruno').rpcErr('create_membership', S.alfa, U.ines, 'funcionario', '', CALENDAR_ONLY)).code).toBe('PT403');
    expect(await who.u('bruno').q('select id from public.stores')).toEqual([]);
    // Helena, outra responsável da mesma loja, segue com acesso
    expect((await who.u('helena').rpc('list_store_members', S.alfa))[0]!.r).toHaveLength(4);
  });

  it('desativar a conta encerra todo o acesso; reativar restaura', async () => {
    await who.u('ana').rpc('set_account_active', U.carla, false);
    const carla = who.u('carla');
    expect(await carla.q('select id from public.stores')).toEqual([]);
    expect(await carla.q('select id from public.profiles')).toEqual([]);
    expect((await carla.rpcErr('list_store_members', S.beta)).code).toBe('PT401');
    expect((await carla.rpcErr('create_membership', S.beta, U.ines, 'funcionario', '', CALENDAR_ONLY)).code).toBe('PT401');
    await who.u('ana').rpc('set_account_active', U.carla, true);
    expect(await who.u('carla').q('select id from public.stores')).toHaveLength(2);
  });

  it('conta já inativa e conta sem vínculos não enxergam nada', async () => {
    for (const k of ['paulo', 'ines'] as const) {
      expect(await who.u(k).q('select id from public.stores')).toEqual([]);
      expect(await who.u(k).q('select id from public.memberships')).toEqual([]);
      expect(await who.u(k).q('select id from public.audit_log')).toEqual([]);
    }
    expect((await who.u('paulo').rpcErr('store_summary', S.alfa)).code).toBe('PT401');
  });

  it('loja desativada some para quem não é administrador', async () => {
    await who.owner().q('update public.stores set active = false where id = $1', [S.beta]);
    expect(ids(await who.u('lucas').q('select id from public.stores'))).toEqual([]);
    expect((await who.u('lucas').rpcErr('store_summary', S.beta)).code).toBe('PT403');
    expect(await who.u('ana').q('select id from public.stores')).toHaveLength(3);
  });
});

describe('último administrador geral', () => {
  it('não pode ser removido nem desativado; com outro ativo, pode', async () => {
    await who.u('ana').rpc('set_general_admin', U.ada, false); // ana continua
    const ana = who.u('ana');
    expect((await ana.rpcErr('set_general_admin', U.ana, false)).code).toBe('PT409');
    expect((await ana.rpcErr('set_account_active', U.ana, false)).code).toBe('PT409');
    expect((await who.owner().err('update public.profiles set active = false where id = $1', [U.ana])).code).toBe('PT409');
    expect((await who.owner().err('delete from public.profiles where id = $1', [U.ana])).message).toMatch(/último administrador/);
    // Volta a existir um segundo administrador: agora é possível
    await ana.rpc('set_general_admin', U.ada, true);
    await ana.rpc('set_general_admin', U.ana, false);
    expect((await who.owner().q('select count(*)::int as n from public.profiles where is_general_admin and active'))[0]!.n).toBe(1);
  });

  it('um administrador desativado não conta como "outro ativo"', async () => {
    await who.u('ana').rpc('set_account_active', U.ada, false);
    expect((await who.u('ana').rpcErr('set_general_admin', U.ana, false)).code).toBe('PT409');
  });
});

describe('contas, convites e identidade', () => {
  it('contas novas (inclusive por cadastro público) nascem inativas e sem nenhum acesso', async () => {
    const id = '00000000-0000-4000-8000-0000000000aa';
    await who.owner().q("insert into auth.users (id, email, raw_user_meta_data) values ($1, 'intruso@demo.example', '{\"full_name\":\"Intruso\"}')", [id]);
    const [p] = await who.owner().q('select active, is_general_admin, activated_at from public.profiles where id = $1', [id]);
    expect(p).toMatchObject({ active: false, is_general_admin: false, activated_at: null });
    const intruso = who.u('intruso' as never) && as(db, { user: id });
    expect(await intruso.q('select id from public.stores')).toEqual([]);
    expect(await intruso.q('select id from public.profiles')).toEqual([]);
    expect((await intruso.rpcErr('list_store_members', S.alfa)).code).toBe('PT401');
    expect((await intruso.rpcErr('create_membership', S.alfa, id, 'funcionario', '', CALENDAR_ONLY)).code).toBe('PT401');
  });

  it('activate_profile é exclusivo do service_role, ativa uma só vez e registra o ator do convite', async () => {
    const id = '00000000-0000-4000-8000-0000000000bb';
    await who.owner().q("insert into auth.users (id, email) values ($1, 'novo@demo.example')", [id]);
    for (const w of [who.anon(), who.u('bruno'), who.u('ana')]) {
      expect((await w.rpcErr('activate_profile', id, 'Pessoa Nova', U.bruno)).code).toBe('42501');
    }
    await who.service().rpc('activate_profile', id, 'Pessoa Nova', U.bruno);
    const [p] = await who.owner().q('select active, full_name from public.profiles where id = $1', [id]);
    expect(p).toMatchObject({ active: true, full_name: 'Pessoa Nova' });
    const [log] = await who.owner().q("select actor_id, actor_name, action, store_id from public.audit_log where action = 'conta_criada' and target_person_id = $1", [id]);
    expect(log).toMatchObject({ actor_id: U.bruno, actor_name: 'Bruno', store_id: null });
    // Segunda chamada não sobrescreve nada; e não reativa conta desativada pelo administrador
    await who.service().rpc('activate_profile', id, 'Outro Nome', U.bruno);
    await who.u('ana').rpc('set_account_active', id, false);
    await who.service().rpc('activate_profile', id, 'Outro Nome', U.bruno);
    expect((await who.owner().q('select active, full_name from public.profiles where id = $1', [id]))[0]).toMatchObject({ active: false, full_name: 'Pessoa Nova' });
  });

  it('só é possível vincular contas já ativadas', async () => {
    const id = '00000000-0000-4000-8000-0000000000cc';
    await who.owner().q("insert into auth.users (id, email) values ($1, 'pendente@demo.example')", [id]);
    expect((await who.u('bruno').rpcErr('create_membership', S.alfa, id, 'funcionario', '', CALENDAR_ONLY)).code).toBe('PT422');
    await who.service().rpc('activate_profile', id, 'Pessoa Pendente', U.bruno);
    expect((await who.u('bruno').rpc('create_membership', S.alfa, id, 'funcionario', '', CALENDAR_ONLY))[0]!.r).toBeTruthy();
  });

  it('conta existente é reaproveitada: uma identidade, vários vínculos independentes', async () => {
    await who.u('bruno').rpc('create_membership', S.alfa, U.ines, 'funcionario', 'Caixa', CALENDAR_ONLY);
    await who.u('carla').rpc('create_membership', S.beta, U.ines, 'funcionario', 'Apoio', { overview: ['view'], finance: ['view'] });
    expect((await who.owner().q('select id from public.profiles where email = $1', [EMAIL('ines')]))).toHaveLength(1);
    const ines = who.u('ines');
    expect(ids(await ines.q('select id from public.stores'))).toEqual([S.alfa, S.beta].sort());
    // O vínculo de uma loja não vaza para a outra: cada responsável vê só o seu
    const bruno = await who.u('bruno').rpc('list_store_members', S.alfa);
    expect(bruno[0]!.r.filter((x: any) => x.person.id === U.ines)).toHaveLength(1);
    expect((await who.u('bruno').q('select store_id from public.memberships where person_id = $1', [U.ines])).every((r) => r.store_id === S.alfa)).toBe(true);
    // Desativar em uma loja preserva a outra
    await who.u('bruno').rpc('set_membership_active', await membershipId('ines', S.alfa), false);
    expect(ids(await ines.q('select id from public.stores'))).toEqual([S.beta]);
  });

  it('não duplica vínculo com a mesma loja (ativo ou inativo)', async () => {
    const e = await who.u('bruno').rpcErr('create_membership', S.alfa, U.igor, 'funcionario', '', CALENDAR_ONLY);
    expect(e.code).toBe('PT409');
    await who.u('bruno').rpc('set_membership_active', await membershipId('igor', S.alfa), false);
    expect((await who.u('bruno').rpcErr('create_membership', S.alfa, U.igor, 'funcionario', '', CALENDAR_ONLY)).code).toBe('PT409');
  });

  it('precheck: exige autorização e não revela contas de outras lojas nem administradores', async () => {
    const bruno = who.u('bruno');
    // E-mail inexistente e e-mail de conta de outra loja têm o MESMO resultado (sucesso silencioso)
    await bruno.rpc('precheck_member_invite', S.alfa, 'desconhecido@demo.example', 'funcionario', CALENDAR_ONLY);
    await bruno.rpc('precheck_member_invite', S.alfa, EMAIL('lucas'), 'funcionario', CALENDAR_ONLY);
    // Administrador: mensagem genérica; já vinculado a ESTA loja: informação da própria loja
    const admin = await bruno.rpcErr('precheck_member_invite', S.alfa, EMAIL('ana'), 'funcionario', CALENDAR_ONLY);
    expect(admin).toMatchObject({ code: 'PT422', hint: 'email' });
    expect(admin.message).not.toMatch(/administrador/i);
    expect((await bruno.rpcErr('precheck_member_invite', S.alfa, EMAIL('igor'), 'funcionario', CALENDAR_ONLY)).code).toBe('PT409');
    expect((await bruno.rpcErr('precheck_member_invite', S.alfa, 'invalido', 'funcionario', CALENDAR_ONLY)).hint).toBe('email');
    // Sem permissão (funcionário, ou responsável de outra loja) nem sequer valida
    expect((await who.u('igor').rpcErr('precheck_member_invite', S.alfa, 'x@demo.example', 'funcionario', CALENDAR_ONLY)).code).toBe('PT403');
    expect((await who.u('carla').rpcErr('precheck_member_invite', S.alfa, 'x@demo.example', 'funcionario', CALENDAR_ONLY)).code).toBe('PT403');
    expect((await bruno.rpcErr('precheck_member_invite', S.alfa, 'x@demo.example', 'responsavel', FULL)).code).toBe('PT403');
  });

  it('erros de validação indicam o campo do formulário', async () => {
    const e = await who.u('bruno').rpcErr('create_membership', S.alfa, U.ines, 'funcionario', '', { calendar: ['create'] });
    expect(e).toMatchObject({ code: 'PT422', hint: 'permissions' });
    const e2 = await who.u('bruno').rpcErr('create_membership', S.alfa, U.ines, 'funcionario', 'x'.repeat(61), CALENDAR_ONLY);
    expect(e2).toMatchObject({ code: 'PT422', hint: 'jobTitle' });
  });
});

describe('freio contra abuso de convites', () => {
  it('responsável tem limite de 30 cadastros por hora; administrador geral não é limitado', async () => {
    const made: string[] = [];
    for (let i = 0; i < 31; i++) {
      const id = `00000000-0000-4000-8000-${String(900 + i).padStart(12, '0')}`;
      await who.owner().q('insert into auth.users (id, email) values ($1, $2)', [id, `massa${i}@demo.example`]);
      await who.owner().q('update public.profiles set active = true, activated_at = now() where id = $1', [id]);
      made.push(id);
    }
    const bruno = who.u('bruno');
    for (const id of made.slice(0, 30)) await bruno.rpc('create_membership', S.alfa, id, 'funcionario', '', CALENDAR_ONLY);
    const blocked = await bruno.rpcErr('create_membership', S.alfa, made[30]!, 'funcionario', '', CALENDAR_ONLY);
    expect(blocked).toMatchObject({ code: 'PT429', message: expect.stringMatching(/Limite de cadastros/) });
    // O pré-check também barra: nenhum convite é disparado depois do limite
    expect((await bruno.rpcErr('precheck_member_invite', S.alfa, 'novo@demo.example', 'funcionario', CALENDAR_ONLY)).code).toBe('PT429');
    // Outra pessoa e o administrador geral seguem livres
    expect((await who.u('helena').rpc('create_membership', S.alfa, made[30]!, 'funcionario', '', CALENDAR_ONLY))[0]!.r).toBeTruthy();
    expect((await who.u('ana').rpc('create_membership', S.beta, made[0]!, 'funcionario', '', CALENDAR_ONLY))[0]!.r).toBeTruthy();
  });
});

describe('auditoria', () => {
  it('registra ator, data, loja e alteração; leitura filtrada por loja e permissão', async () => {
    const bruno = who.u('bruno');
    const id = (await bruno.rpc('create_membership', S.alfa, U.ines, 'funcionario', 'Caixa', CALENDAR_ONLY))[0]!.r;
    await bruno.rpc('update_membership', id, 'Estoquista', 'funcionario', { overview: ['view'], calendar: ['view', 'edit'] });
    await bruno.rpc('set_membership_active', id, false);
    await who.u('carla').rpc('create_membership', S.beta, U.ines, 'funcionario', '', CALENDAR_ONLY);

    const alfa = await who.u('ana').q('select * from public.audit_log where store_id = $1 and actor_id = $2 order by seq', [S.alfa, U.bruno]);
    expect(alfa.map((r) => r.action)).toEqual(['vinculo_criado', 'vinculo_editado', 'permissoes_alteradas', 'vinculo_desativado']);
    expect(alfa[0]).toMatchObject({
      actor_id: U.bruno,
      actor_name: 'Bruno',
      store_name: 'Loja Alfa',
      target_person_id: U.ines,
      summary: 'Vínculo de Ines com a Loja Alfa criado como funcionário (Caixa).',
    });
    expect(alfa[1]!.summary).toBe('Cargo alterado para Estoquista.');
    expect(alfa[2]!.summary).toBe('Calendário: liberou editar.');
    expect(alfa[2]!.details.after.calendar).toEqual(['view', 'edit']);
    expect(alfa[3]!.summary).toBe('Vínculo de Ines com a Loja Alfa desativado.');
    expect(new Date(alfa[0]!.created_at).getTime()).toBeGreaterThan(0);

    // Júlia (activity.view na Alfa) vê só a Alfa; Bruno (responsável) também; Lucas (sem activity) nada
    const julia = await who.u('julia').q('select store_id from public.audit_log');
    expect(julia.length).toBeGreaterThan(0);
    expect(julia.every((r) => r.store_id === S.alfa)).toBe(true);
    expect((await bruno.q('select store_id from public.audit_log')).every((r) => r.store_id === S.alfa)).toBe(true);
    expect(await who.u('lucas').q('select id from public.audit_log')).toEqual([]);
    // Eventos globais (sem loja) só o administrador geral lê
    await who.u('ana').rpc('set_general_admin', U.ines, true);
    expect(await who.u('bruno').q("select id from public.audit_log where action = 'admin_concedido'")).toEqual([]);
    const adm = await who.u('ana').q("select summary, store_id from public.audit_log where action = 'admin_concedido' and target_person_id = $1", [U.ines]);
    expect(adm[0]).toMatchObject({ store_id: null, summary: 'Papel de administrador geral concedido a Ines.' });
  });

  it('é append-only: usuários não editam nem apagam; nem o serviço nem o dono do banco', async () => {
    await who.u('bruno').rpc('create_membership', S.alfa, U.ines, 'funcionario', '', CALENDAR_ONLY);
    for (const w of [who.u('bruno'), who.u('ana')]) {
      expect((await w.err("update public.audit_log set summary = 'x'")).code).toBe('42501');
      expect((await w.err('delete from public.audit_log')).code).toBe('42501');
      expect((await w.err('truncate public.audit_log')).code).toBe('42501');
    }
    for (const w of [who.service(), who.owner()]) {
      expect((await w.err("update public.audit_log set summary = 'x'")).code).toBe('PT403');
      expect((await w.err('delete from public.audit_log')).code).toBe('PT403');
      expect((await w.err('truncate public.audit_log')).code).toBe('PT403');
    }
  });

  it('alteração e auditoria são atômicas: se a auditoria falhar, nada é gravado', async () => {
    const before = (await who.owner().q('select count(*)::int n from public.memberships'))[0]!.n;
    await who.owner().q('alter table public.audit_log add constraint audit_boom check (false) not valid');
    const e = await who.u('bruno').rpcErr('create_membership', S.alfa, U.ines, 'funcionario', '', CALENDAR_ONLY);
    expect(e.code).toBe('23514');
    await who.owner().q('alter table public.audit_log drop constraint audit_boom');
    expect((await who.owner().q('select count(*)::int n from public.memberships'))[0]!.n).toBe(before);
  });
});

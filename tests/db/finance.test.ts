// Financeiro · contas e liquidações, com IDENTIDADES distintas (anon, funcionários com permissões diferentes,
// responsáveis de lojas diferentes, administrador). Cada teste roda numa transação desfeita ao final.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { FIN_FULL, S, U, as_user, seedScenario } from './support/fixtures';
import { applyMigrations, as, begin, openDb, rollback, type Db } from './support/harness';

let db: Db;
beforeAll(async () => {
  db = await openDb();
  await seedScenario(db);
}, 60_000);
afterAll(async () => db?.close());
beforeEach(async () => {
  await begin(db);
  // Permissões financeiras EXPLÍCITAS e diferentes (as antigas não incluem as ações novas).
  await grant('bruno', S.alfa, FIN_FULL);
  await grant('igor', S.alfa, ['view']); // só consulta
  await grant('julia', S.alfa, ['view', 'create', 'settle']); // cria e confirma; não estorna/envia/cancela/edita
  await grant('carla', S.beta, FIN_FULL); // responsável da Beta
});
afterEach(() => rollback(db));

const who = { anon: () => as(db, 'anon'), owner: () => as(db, 'owner'), service: () => as(db, 'service'), u: (k: keyof typeof U) => as(db, as_user(k)) };
let n = 0;
const key = () => `10000000-0000-4000-8000-${String(++n + Math.floor(Math.random() * 1e6)).padStart(12, '0')}`;

async function grant(person: keyof typeof U, store: string, actions: string[]) {
  const [m] = await who.owner().q('select permissions from public.memberships where person_id = $1 and store_id = $2', [U[person], store]);
  const permissions = { ...(m!.permissions as object), finance: actions };
  await who.owner().q('update public.memberships set permissions = $3::jsonb where person_id = $1 and store_id = $2', [U[person], store, JSON.stringify(permissions)]);
}

interface Acc { store: string; kind: string; desc: string; cat: string; cp: string; cents: number; comp: string; due: string; notes: string; key: string | null }
const acc = (o: Partial<Acc> = {}): Acc => ({ store: S.alfa, kind: 'payable', desc: 'Aluguel da loja', cat: 'Aluguel', cp: 'Imobiliária Exemplo', cents: 100000, comp: '2026-03-01', due: '2026-03-10', notes: '', key: null, ...o });
const createArgs = (a: Acc): unknown[] => [a.store, a.kind, a.desc, a.cat, a.cp, a.cents, a.comp, a.due, a.notes, a.key];
async function create(user: keyof typeof U, o: Partial<Acc> = {}) {
  return (await who.u(user).rpc('create_finance_account', ...createArgs(acc(o))))[0]!.r as string;
}
const payArgs = (account: string, cents: number, k = key(), o: { paidOn?: string; method?: string; notes?: string } = {}): unknown[] => [account, cents, o.paidOn ?? '2026-03-05', o.method ?? 'pix', o.notes ?? '', k];
const pay = async (user: keyof typeof U, account: string, cents: number, k = key(), o = {}) => (await who.u(user).rpc('confirm_finance_payment', ...payArgs(account, cents, k, o)))[0]!.r as string;
const payErr = (user: keyof typeof U, account: string, cents: number, k = key(), o = {}) => who.u(user).rpcErr('confirm_finance_payment', ...payArgs(account, cents, k, o));
const get = async (user: keyof typeof U, account: string) => (await who.u(user).rpc('finance_get_account', account))[0]!.r as { account: any; payments: any[] };
const today = async () => (await who.owner().q('select private.today_sp()::text as d'))[0]!.d as string;
const addDays = async (days: number) => (await who.owner().q('select (private.today_sp() + $1::int)::text as d', [days]))[0]!.d as string;

type F = Partial<{ kind: string; status: string; cf: string; ct: string; df: string; dt: string; q: string; overdue: boolean; receipt: boolean; limit: number; offset: number }>;
const listArgs = (store: string | null, f: F = {}): unknown[] => [store, f.kind ?? null, f.status ?? null, f.cf ?? null, f.ct ?? null, f.df ?? null, f.dt ?? null, f.q ?? null, f.overdue ?? false, f.receipt ?? false, f.limit ?? 50, f.offset ?? 0];
const list = async (user: keyof typeof U, store: string | null, f: F = {}) => (await who.u(user).rpc('finance_list', ...listArgs(store, f)))[0]!.r as { rows: any[]; total: number };
const summary = async (user: keyof typeof U, store: string | null, f: F = {}) => (await who.u(user).rpc('finance_summary', ...listArgs(store, f).slice(0, 10)))[0]!.r as any;
const rows = async (user: keyof typeof U, store: string | null, f: F = {}) => (await list(user, store, f)).rows.map((r) => r.description as string);

// Simula o upload feito pelo Storage (o Storage grava metadata.mimetype e metadata.size).
async function fakeUpload(path: string, mimetype = 'application/pdf', size = 1234) {
  await who.owner().q("insert into storage.buckets (id, name) values ('receipts', 'receipts') on conflict do nothing");
  await who.owner().q('insert into storage.objects (bucket_id, name, metadata) values ($1, $2, $3::jsonb) on conflict do nothing', ['receipts', path, JSON.stringify({ mimetype, size })]);
}
const rpath = (p: { store_id?: string; account: string; payment: string; store?: string }, file = 'comprovante.pdf') => `${p.store ?? p.store_id ?? S.alfa}/${p.account}/${p.payment}/${file}`;

// ============================================================================================
describe('permissões financeiras: nada é concedido automaticamente', () => {
  it('a migração financeira NÃO altera nenhuma permissão existente', async () => {
    const old = await openDb({ upTo: '20261111000700' });
    try {
      await seedScenario(old);
      const before = await old.query('select id, permissions from public.memberships order by id');
      await applyMigrations(old, { after: '20261111000700' });
      const after = await old.query('select id, permissions from public.memberships order by id');
      expect(after).toEqual(before);
      expect(after.some((m) => ['settle', 'reverse', 'confirm_send'].some((a) => JSON.stringify(m.permissions).includes(a)))).toBe(false);
    } finally {
      await old.close();
    }
  }, 60_000);

  it('vínculos antigos (inclusive responsável com as 5 ações antigas) não ganham liquidar, estornar nem confirmar envio', async () => {
    await who.owner().q("update public.memberships set permissions = permissions || jsonb_build_object('finance', jsonb_build_array('view','create','edit','delete','export')) where person_id = $1", [U.helena]);
    const a = await create('helena'); // tem "criar"
    expect((await payErr('helena', a, 100)).code).toBe('PT403');
    const p = await pay('bruno', a, 100);
    expect((await who.u('helena').rpcErr('reverse_finance_payment', p, 'motivo qualquer')).code).toBe('PT403');
    expect((await who.u('helena').rpcErr('confirm_receipt_sent', p, null)).code).toBe('PT403');
  });

  it('funcionário sem financeiro e pessoa de outra loja não acessam nada; anônimo não executa', async () => {
    const a = await create('bruno');
    for (const k of ['lucas', 'fabio', 'ines'] as const) {
      expect((await who.u(k).rpcErr('finance_get_account', a)).code).toMatch(/PT403|PT401/);
      expect((await who.u(k).rpcErr('create_finance_account', ...createArgs(acc()))).code).toMatch(/PT403|PT401/);
    }
    expect((await who.anon().rpcErr('finance_list', ...listArgs(S.alfa))).code).toBe('42501');
    expect((await who.anon().err('select * from public.finance_accounts')).code).toBe('42501');
    expect((await who.anon().err('select * from public.finance_accounts_v')).code).toBe('42501');
  });

  it('cada ação exige a SUA permissão (visualizar, criar, editar, liquidar, estornar, enviar, cancelar)', async () => {
    const a = await create('bruno');
    const p = await pay('bruno', a, 1000);
    // Igor: só visualizar
    expect((await who.u('igor').rpc('finance_get_account', a))[0]!.r.account.id).toBe(a);
    expect((await who.u('igor').rpcErr('create_finance_account', ...createArgs(acc()))).code).toBe('PT403');
    expect((await payErr('igor', a, 100)).code).toBe('PT403');
    // Julia: criar + liquidar, mas não editar/estornar/enviar/cancelar
    expect(await create('julia')).toBeTruthy();
    await pay('julia', a, 100);
    expect((await who.u('julia').rpcErr('update_finance_account', a, 'x1', '', '', 100000, '2026-03-01', '2026-03-10', '')).code).toBe('PT403');
    expect((await who.u('julia').rpcErr('reverse_finance_payment', p, 'motivo qualquer')).code).toBe('PT403');
    expect((await who.u('julia').rpcErr('confirm_receipt_sent', p, null)).code).toBe('PT403');
    expect((await who.u('julia').rpcErr('cancel_finance_account', a, 'motivo qualquer')).code).toBe('PT403');
  });

  it('a matriz respeita "ninguém concede além do que possui" também para as ações novas', async () => {
    // Julia (sem reverse) é responsável? Não; use Helena como responsável restrita a settle apenas
    await who.owner().q("update public.memberships set permissions = permissions || jsonb_build_object('finance', jsonb_build_array('view','settle')) where person_id = $1", [U.helena]);
    const igorAlfa = (await who.owner().q('select id from public.memberships where person_id = $1 and store_id = $2', [U.igor, S.alfa]))[0]!.id;
    const base = { overview: ['view'], team: ['view'], calendar: ['view', 'create'] };
    // Helena não possui "estornar": não pode concedê-lo
    const e = await who.u('helena').rpcErr('update_membership', igorAlfa, '', 'funcionario', { ...base, finance: ['view', 'reverse'] });
    expect(e.code).toBe('PT403');
    // mas pode conceder "liquidar", que possui
    await who.u('helena').rpc('update_membership', igorAlfa, '', 'funcionario', { ...base, finance: ['view', 'settle'] });
    const [m] = await who.owner().q('select permissions from public.memberships where id = $1', [igorAlfa]);
    expect(m!.permissions.finance).toEqual(['view', 'settle']);
    // o administrador concede qualquer uma; ações financeiras fora do módulo Financeiro são descartadas
    await who.u('ana').rpc('update_membership', igorAlfa, '', 'funcionario', { ...base, finance: ['view', 'reverse', 'confirm_send'], calendar: ['view', 'settle'] });
    const [m2] = await who.owner().q('select permissions from public.memberships where id = $1', [igorAlfa]);
    expect(m2!.permissions.finance).toEqual(['view', 'reverse', 'confirm_send']);
    expect(m2!.permissions.calendar).toEqual(['view']);
    // e a auditoria descreve as ações em português
    const log = await who.u('ana').q("select summary from public.audit_log where action = 'permissoes_alteradas' and target_person_id = $1 order by seq desc limit 1", [U.igor]);
    expect(log[0]!.summary).toMatch(/Financeiro: liberou estornar/);
  });

  it('o banco recusa permissões financeiras fora do formato (ação inexistente, sem visualizar)', async () => {
    for (const bad of [{ finance: ['settle'] }, { finance: ['view', 'pagar'] }, { calendar: ['view', 'settle'] }]) {
      const e = await who.owner().err("insert into public.memberships (person_id, store_id, role, permissions) values ($1, $2, 'funcionario', $3)", [U.ines, S.alfa, JSON.stringify(bad)]);
      expect(e.code).toBe('23514');
    }
    // funcionário PODE receber as ações novas (caixa que confirma pagamentos)
    await who.owner().q("insert into public.memberships (person_id, store_id, role, permissions) values ($1, $2, 'funcionario', $3)", [U.ines, S.alfa, JSON.stringify({ finance: FIN_FULL })]);
  });
});

describe('isolamento por loja', () => {
  it('responsável de uma loja não vê, lista, edita nem liquida contas de outra; RLS filtra as tabelas', async () => {
    const alfa = await create('bruno');
    const beta = await create('carla', { store: S.beta, desc: 'Fornecedor da Beta' });
    const pBeta = await pay('carla', beta, 500);
    // Bruno x Beta
    expect((await who.u('bruno').rpcErr('finance_get_account', beta)).code).toBe('PT403');
    expect((await who.u('bruno').rpcErr('finance_list', ...listArgs(S.beta))).code).toBe('PT403');
    expect((await who.u('bruno').rpcErr('update_finance_account', beta, 'novo nome', '', '', 100000, '2026-03-01', '2026-03-10', '')).code).toBe('PT403');
    expect((await payErr('bruno', beta, 100)).code).toBe('PT403');
    expect((await who.u('bruno').rpcErr('reverse_finance_payment', pBeta, 'motivo qualquer')).code).toBe('PT403');
    expect((await who.u('bruno').rpcErr('create_finance_account', ...createArgs(acc({ store: S.beta })))).code).toBe('PT403');
    expect((await who.u('bruno').rpcErr('finance_account_history', beta)).code).toBe('PT403');
    // RLS direto
    expect((await who.u('bruno').q('select id from public.finance_accounts')).map((r) => r.id)).toEqual([alfa]);
    expect(await who.u('bruno').q('select id from public.finance_payments')).toEqual([]);
    expect((await who.u('bruno').q('select id from public.finance_accounts_v')).map((r) => r.id)).toEqual([alfa]);
    expect((await who.u('carla').q('select id from public.finance_payments')).map((r) => r.id)).toEqual([pBeta]);
    // escrita direta é negada a todos os papéis de API
    for (const sql of ['insert into public.finance_accounts (store_id, kind, description, amount_cents, competence_date, due_date) values ($1, \'payable\', \'xx\', 1, now(), now())', 'update public.finance_accounts set amount_cents = 1', 'delete from public.finance_accounts']) {
      expect((await who.u('bruno').err(sql, sql.includes('$1') ? [S.alfa] : [])).code).toBe('42501');
    }
  });

  it('visão consolidada: só o administrador geral (p_store nulo) e sem duplicar contas', async () => {
    await create('bruno');
    await create('carla', { store: S.beta });
    for (const k of ['bruno', 'carla', 'igor'] as const) expect((await who.u(k).rpcErr('finance_list', ...listArgs(null))).code).toBe('PT403');
    expect((await who.u(k0()).rpcErr('finance_summary', ...listArgs(null).slice(0, 10))).code).toBe('PT403');
    const all = await list('ana', null);
    expect(all.total).toBe(2);
    expect(new Set(all.rows.map((r) => r.id)).size).toBe(2);
    function k0() { return 'bruno' as const; }
  });
});

describe('cadastro de contas', () => {
  it('cria conta a pagar/a receber em BRL, em centavos, com datas sem deslocamento de fuso', async () => {
    for (const tz of ['UTC', 'Pacific/Kiritimati', 'Pacific/Honolulu']) {
      await who.owner().q(`set local time zone '${tz}'`);
      const id = await create('bruno', { kind: 'receivable', cents: 123456, comp: '2026-03-31', due: '2026-01-01', desc: `Venda a prazo ${tz}` });
      const { account } = await get('bruno', id);
      expect(account).toMatchObject({ kind: 'receivable', amount_cents: 123456, currency: 'BRL', competence_date: '2026-03-31', due_date: '2026-01-01', situation: 'pending', balance_cents: 123456, settled_cents: 0 });
    }
    expect((await who.owner().q('select pg_typeof(amount_cents)::text as t from public.finance_accounts limit 1'))[0]!.t).toBe('bigint');
  });

  it('valida valor, descrição, tipo, datas e limites', async () => {
    const bad = async (o: Partial<Acc>, hint: string) => {
      const e = await who.u('bruno').rpcErr('create_finance_account', ...createArgs(acc(o)));
      expect(e, JSON.stringify(o)).toMatchObject({ code: 'PT422', hint });
    };
    await bad({ cents: 0 }, 'amountCents');
    await bad({ cents: -100 }, 'amountCents');
    await bad({ cents: 100000000000 }, 'amountCents');
    await bad({ desc: ' a ' }, 'description');
    await bad({ kind: 'transfer' }, 'kind');
    await bad({ comp: '1999-12-31' }, 'competenceDate');
    await bad({ due: '2101-01-01' }, 'dueDate');
    await bad({ cat: 'x'.repeat(81) }, 'category');
    await bad({ cp: 'x'.repeat(121) }, 'counterparty');
    await bad({ notes: 'x'.repeat(1001) }, 'notes');
    expect((await who.owner().err('insert into public.finance_accounts (store_id, kind, description, amount_cents, currency, competence_date, due_date) values ($1, \'payable\', \'xx\', 1, \'USD\', now(), now())', [S.alfa])).code).toBe('23514');
  });

  it('repetir a criação com a mesma chave não duplica', async () => {
    const k = key();
    const a = await create('bruno', { key: k });
    const b = await create('bruno', { key: k });
    expect(b).toBe(a);
    expect((await who.owner().q('select count(*)::int n from public.finance_accounts'))[0]!.n).toBe(1);
  });

  it('editar: não reduz abaixo do liquidado; loja e tipo são imutáveis; cancelada não edita; auditoria descreve', async () => {
    const a = await create('bruno', { cents: 100000 });
    await pay('bruno', a, 40000);
    const upd = (cents: number, desc = 'Aluguel da loja') => who.u('bruno').rpcErr('update_finance_account', a, desc, 'Aluguel', 'Imobiliária Exemplo', cents, '2026-03-01', '2026-03-10', '');
    expect(await upd(39999)).toMatchObject({ code: 'PT422', hint: 'amountCents', message: expect.stringMatching(/R\$ 400,00/) });
    await who.u('bruno').rpc('update_finance_account', a, 'Aluguel (reajustado)', 'Aluguel', 'Imobiliária Exemplo', 40000, '2026-03-02', '2026-03-12', 'obs');
    const { account } = await get('bruno', a);
    expect(account).toMatchObject({ amount_cents: 40000, balance_cents: 0, situation: 'paid', due_date: '2026-03-12', description: 'Aluguel (reajustado)' });
    // imutáveis, até para quem administra o banco
    expect((await who.owner().err('update public.finance_accounts set store_id = $2 where id = $1', [a, S.beta])).code).toBe('PT403');
    expect((await who.owner().err("update public.finance_accounts set kind = 'receivable' where id = $1", [a])).code).toBe('PT403');
    expect((await who.owner().err('update public.finance_accounts set amount_cents = 1 where id = $1', [a])).code).toBe('PT422'); // trigger, mesmo fora da RPC
    const hist = (await who.u('igor').rpc('finance_account_history', a))[0]!.r as { action: string; summary: string }[];
    expect(hist.find((h) => h.action === 'financeiro_conta_editada')!.summary).toMatch(/valor alterado de R\$ 1\.000,00 para R\$ 400,00/);
  });
});

describe('liquidações: total, parcial, saldo e limites', () => {
  it('parcial → parcial; total → quitada; saldo calculado no servidor em centavos exatos', async () => {
    const a = await create('bruno', { cents: 10000 }); // R$ 100,00
    expect((await get('bruno', a)).account).toMatchObject({ situation: 'pending', balance_cents: 10000 });
    await pay('bruno', a, 3333);
    expect((await get('bruno', a)).account).toMatchObject({ situation: 'partial', settled_cents: 3333, balance_cents: 6667 });
    await pay('julia', a, 3333);
    await pay('bruno', a, 3334);
    expect((await get('bruno', a)).account).toMatchObject({ situation: 'paid', settled_cents: 10000, balance_cents: 0 });
    expect((await payErr('bruno', a, 1)).message).toMatch(/excede o saldo pendente \(R\$ 0,00\)/);
  });

  it('sem ponto flutuante: somas que erram em float (10 + 20 centavos; valores enormes) são exatas', async () => {
    const a = await create('bruno', { cents: 99999999999 });
    await pay('bruno', a, 10);
    await pay('bruno', a, 20);
    await pay('bruno', a, 99999999969);
    expect((await get('bruno', a)).account).toMatchObject({ settled_cents: 99999999999, balance_cents: 0, situation: 'paid' });
  });

  it('recusa valor zero, negativo, nulo, acima do saldo, data futura, forma inválida, requisição sem chave', async () => {
    const a = await create('bruno', { cents: 5000 });
    for (const c of [0, -1, -5000]) expect(await payErr('bruno', a, c)).toMatchObject({ code: 'PT422', hint: 'amountCents' });
    expect(await payErr('bruno', a, 5001)).toMatchObject({ code: 'PT422', hint: 'amountCents', message: expect.stringMatching(/saldo pendente \(R\$ 50,00\)/) });
    expect(await payErr('bruno', a, 100, key(), { paidOn: await addDays(1) })).toMatchObject({ code: 'PT422', hint: 'paidOn' });
    expect(await payErr('bruno', a, 100, key(), { method: 'bitcoin' })).toMatchObject({ code: 'PT422', hint: 'method' });
    expect((await who.u('bruno').rpcErr('confirm_finance_payment', a, 100, '2026-03-05', 'pix', '', null)).hint).toBe('idempotencyKey');
    expect((await who.owner().err('insert into public.finance_payments (account_id, store_id, amount_cents, paid_on, method, idempotency_key, created_by, created_by_name) values ($1, $2, 0, now(), \'pix\', $3, $4, \'x\')', [a, S.alfa, key(), U.bruno])).code).toBe('23514');
    expect((await get('bruno', a)).payments).toHaveLength(0);
  });

  it('repetição da MESMA requisição não duplica; chave reutilizada com outros dados é conflito', async () => {
    const a = await create('bruno', { cents: 10000 });
    const k = key();
    const p1 = await pay('bruno', a, 4000, k);
    const p2 = await pay('bruno', a, 4000, k); // clique duplo / reenvio
    expect(p2).toBe(p1);
    expect((await get('bruno', a)).payments).toHaveLength(1);
    expect((await get('bruno', a)).account.balance_cents).toBe(6000);
    expect((await payErr('bruno', a, 4001, k)).code).toBe('PT409'); // mesmos dados? não: outro valor
    expect((await payErr('julia', a, 4000, k)).code).toBe('PT409'); // outra pessoa usando a chave
    // a repetição de uma requisição que quitaria a conta não falha por "saldo" depois de já aplicada
    const k2 = key();
    const full = await pay('bruno', a, 6000, k2);
    expect(await pay('bruno', a, 6000, k2)).toBe(full);
    expect((await get('bruno', a)).payments).toHaveLength(2);
  });

  it('registra valor, data (sem fuso), forma, observação e o usuário responsável', async () => {
    const a = await create('bruno');
    for (const tz of ['UTC', 'Pacific/Kiritimati']) {
      await who.owner().q(`set local time zone '${tz}'`);
      await pay('julia', a, 100, key(), { paidOn: '2026-03-04', method: 'dinheiro', notes: 'troco no caixa' });
    }
    const { payments } = await get('bruno', a);
    expect(payments[0]).toMatchObject({ amount_cents: 100, paid_on: '2026-03-04', method: 'dinheiro', notes: 'troco no caixa', created_by_name: 'Julia', reversed_at: null, receipt_path: null });
    expect(payments[1]!.paid_on).toBe('2026-03-04');
  });
});

describe('estornos e cancelamento', () => {
  it('estorno recalcula o saldo, preserva o registro original e exige motivo', async () => {
    const a = await create('bruno', { cents: 10000 });
    const p1 = await pay('bruno', a, 6000);
    await pay('bruno', a, 4000);
    expect((await get('bruno', a)).account.situation).toBe('paid');
    expect((await who.u('bruno').rpcErr('reverse_finance_payment', p1, ' ')).hint).toBe('reason');
    await who.u('bruno').rpc('reverse_finance_payment', p1, 'Valor lançado errado');
    const { account, payments } = await get('bruno', a);
    expect(account).toMatchObject({ situation: 'partial', settled_cents: 4000, balance_cents: 6000 });
    expect(payments).toHaveLength(2); // nada foi apagado
    expect(payments[0]).toMatchObject({ id: p1, amount_cents: 6000, reversal_reason: 'Valor lançado errado', reversed_by_name: 'Bruno' });
    expect(payments[0].reversed_at).not.toBeNull();
    // estornar de novo é recusado; a repetição da requisição original devolve o mesmo registro
    expect((await who.u('bruno').rpcErr('reverse_finance_payment', p1, 'outra vez')).code).toBe('PT409');
    // pode liquidar o saldo reaberto
    await pay('bruno', a, 6000);
    expect((await get('bruno', a)).account.situation).toBe('paid');
  });

  it('pagamento confirmado não é apagado nem alterado (nem pelo dono do banco ou pelo serviço)', async () => {
    const a = await create('bruno');
    const p = await pay('bruno', a, 1000);
    for (const w of [who.owner(), who.service()]) {
      expect((await w.err('delete from public.finance_payments where id = $1', [p])).code).toBe('PT403');
      expect((await w.err('truncate public.finance_payments')).code).toBe('PT403');
      expect((await w.err('delete from public.finance_accounts where id = $1', [a])).code).toBe('PT403');
      expect((await w.err('update public.finance_payments set amount_cents = 1 where id = $1', [p])).code).toBe('PT403');
      expect((await w.err('update public.finance_payments set paid_on = $2 where id = $1', [p, '2026-01-01'])).code).toBe('PT403');
    }
    for (const w of [who.u('bruno'), who.u('ana')]) {
      expect((await w.err('delete from public.finance_payments')).code).toBe('42501');
      expect((await w.err('update public.finance_payments set amount_cents = 1')).code).toBe('42501');
    }
    await who.u('bruno').rpc('reverse_finance_payment', p, 'Teste de estorno');
    expect((await who.owner().err('update public.finance_payments set reversed_at = null, reversed_by = null, reversal_reason = null where id = $1', [p])).code).toBe('PT409');
  });

  it('conta com liquidações não é cancelada sem estornar; depois do estorno pode; cancelada não aceita nada', async () => {
    const a = await create('bruno');
    const p = await pay('bruno', a, 1000);
    expect((await who.u('bruno').rpcErr('cancel_finance_account', a, 'Cliente desistiu')).message).toMatch(/Estorne-as antes/);
    expect((await who.owner().err("update public.finance_accounts set status = 'canceled', canceled_at = now() where id = $1", [a])).code).toBe('PT409'); // gatilho
    await who.u('bruno').rpc('reverse_finance_payment', p, 'Estorno para cancelar');
    expect((await who.u('bruno').rpcErr('cancel_finance_account', a, 'x')).hint).toBe('reason');
    await who.u('bruno').rpc('cancel_finance_account', a, 'Cliente desistiu');
    const { account } = await get('bruno', a);
    expect(account).toMatchObject({ situation: 'canceled', status: 'canceled', cancel_reason: 'Cliente desistiu', canceled_by_name: 'Bruno', is_overdue: false });
    expect((await payErr('bruno', a, 100)).code).toBe('PT409');
    expect((await who.u('bruno').rpcErr('update_finance_account', a, 'novo', '', '', 1000, '2026-03-01', '2026-03-10', '')).code).toBe('PT409');
    expect((await who.u('bruno').rpcErr('cancel_finance_account', a, 'de novo')).code).toBe('PT409');
  });
});

describe('atraso e datas (America/Sao_Paulo)', () => {
  it('today_sp usa o dia civil de São Paulo (UTC-3), não o de UTC', async () => {
    const d = async (ts: string) => (await who.owner().q('select private.today_sp($1::timestamptz)::text as d', [ts]))[0]!.d;
    expect(await d('2026-03-10T02:59:59Z')).toBe('2026-03-09'); // 23:59 em SP ainda é dia 9
    expect(await d('2026-03-10T03:00:00Z')).toBe('2026-03-10');
    expect(await d('2026-12-31T23:30:00Z')).toBe('2026-12-31');
    expect(await d('2027-01-01T02:00:00Z')).toBe('2026-12-31');
  });

  it('em atraso = vencimento anterior a hoje E saldo em aberto; quitada, cancelada ou vencendo hoje não estão em atraso', async () => {
    const [ontem, hoje, amanha] = [await addDays(-1), await today(), await addDays(1)];
    const vencida = await create('bruno', { desc: 'Vencida', due: ontem });
    const parcial = await create('bruno', { desc: 'Parcial vencida', due: ontem, cents: 1000 });
    await pay('bruno', parcial, 400);
    const quitada = await create('bruno', { desc: 'Quitada vencida', due: ontem, cents: 1000 });
    await pay('bruno', quitada, 1000);
    const cancelada = await create('bruno', { desc: 'Cancelada vencida', due: ontem });
    await who.u('bruno').rpc('cancel_finance_account', cancelada, 'Cancelada no teste');
    const venceHoje = await create('bruno', { desc: 'Vence hoje', due: hoje });
    const futura = await create('bruno', { desc: 'Futura', due: amanha });
    const flags = Object.fromEntries((await list('bruno', S.alfa)).rows.map((r) => [r.description, r.is_overdue]));
    expect(flags).toEqual({ Vencida: true, 'Parcial vencida': true, 'Quitada vencida': false, 'Cancelada vencida': false, 'Vence hoje': false, Futura: false });
    // estornar a quitada devolve o saldo e, portanto, o atraso
    const pq = (await get('bruno', quitada)).payments[0].id;
    await who.u('bruno').rpc('reverse_finance_payment', pq, 'Estorno de teste');
    expect((await get('bruno', quitada)).account.is_overdue).toBe(true);
    expect([vencida, venceHoje, futura].length).toBe(3);
  });
});

describe('filtros, busca, paginação e resumos', () => {
  let ids: Record<string, string>;
  beforeEach(async () => {
    const ontem = await addDays(-1);
    const amanha = await addDays(1);
    ids = {
      aluguel: await create('bruno', { desc: 'Aluguel março', cp: 'Imobiliária Central', kind: 'payable', cents: 200000, comp: '2026-03-01', due: '2026-03-10' }),
      luz: await create('bruno', { desc: 'Conta de luz', cp: 'Energia SA', kind: 'payable', cents: 45050, comp: '2026-02-15', due: ontem }),
      venda: await create('bruno', { desc: 'Venda 100% à vista_A', cp: 'Cliente João', kind: 'receivable', cents: 80000, comp: '2026-03-20', due: amanha }),
      servico: await create('bruno', { desc: 'Serviço de entrega', cp: 'Cliente Maria', kind: 'receivable', cents: 15000, comp: '2026-04-02', due: '2099-04-30' }),
      velha: await create('bruno', { desc: 'Conta cancelada', cp: 'Ninguém', kind: 'payable', cents: 999, comp: '2026-03-03', due: '2026-03-05' }),
    };
    await who.u('bruno').rpc('cancel_finance_account', ids.velha, 'Duplicada');
    await pay('bruno', ids.luz, 45050); // quitada
    await pay('bruno', ids.venda, 30000); // parcial
  });

  it('filtros por tipo, situação, período de competência e de vencimento', async () => {
    expect((await rows('bruno', S.alfa, { kind: 'receivable' })).sort()).toEqual(['Serviço de entrega', 'Venda 100% à vista_A']);
    expect(await rows('bruno', S.alfa, { status: 'paid' })).toEqual(['Conta de luz']);
    expect(await rows('bruno', S.alfa, { status: 'partial' })).toEqual(['Venda 100% à vista_A']);
    expect(await rows('bruno', S.alfa, { status: 'canceled' })).toEqual(['Conta cancelada']);
    expect((await rows('bruno', S.alfa, { status: 'pending' })).sort()).toEqual(['Aluguel março', 'Serviço de entrega']);
    expect((await rows('bruno', S.alfa, { status: 'open' })).sort()).toEqual(['Aluguel março', 'Serviço de entrega', 'Venda 100% à vista_A']);
    // competência: limites inclusivos, datas sem fuso
    expect((await rows('bruno', S.alfa, { cf: '2026-03-01', ct: '2026-03-20' })).sort()).toEqual(['Aluguel março', 'Conta cancelada', 'Venda 100% à vista_A']);
    expect(await rows('bruno', S.alfa, { cf: '2026-03-20', ct: '2026-03-20' })).toEqual(['Venda 100% à vista_A']);
    expect(await rows('bruno', S.alfa, { df: '2099-04-30', dt: '2099-04-30' })).toEqual(['Serviço de entrega']);
    expect(await rows('bruno', S.alfa, { df: '2026-03-10', dt: '2026-03-10', kind: 'payable' })).toEqual(['Aluguel março']);
  });

  it('busca por descrição e contraparte, sem diferenciar maiúsculas, tratando % e _ como texto literal', async () => {
    expect(await rows('bruno', S.alfa, { q: 'ALUGUEL' })).toEqual(['Aluguel março']);
    expect(await rows('bruno', S.alfa, { q: 'imobiliária' })).toEqual(['Aluguel março']);
    expect((await rows('bruno', S.alfa, { q: 'cliente' })).sort()).toEqual(['Serviço de entrega', 'Venda 100% à vista_A']);
    expect(await rows('bruno', S.alfa, { q: '100%' })).toEqual(['Venda 100% à vista_A']);
    expect(await rows('bruno', S.alfa, { q: '%' })).toEqual(['Venda 100% à vista_A']); // não é curinga
    expect(await rows('bruno', S.alfa, { q: '_' })).toEqual(['Venda 100% à vista_A']);
    expect(await rows('bruno', S.alfa, { q: 'zzz' })).toEqual([]);
    expect(await rows('bruno', S.alfa, { q: "'; drop table finance_accounts; --" })).toEqual([]);
  });

  it('atraso, paginação e filtro de comprovante pendente', async () => {
    expect(await rows('bruno', S.alfa, { overdue: true })).toEqual(['Aluguel março']); // a de luz está quitada
    const p1 = await list('bruno', S.alfa, { limit: 2, offset: 0 });
    const p2 = await list('bruno', S.alfa, { limit: 2, offset: 2 });
    const p3 = await list('bruno', S.alfa, { limit: 2, offset: 4 });
    expect([p1.total, p2.total, p3.total]).toEqual([5, 5, 5]);
    expect([...p1.rows, ...p2.rows, ...p3.rows].map((r) => r.id).sort()).toEqual(Object.values(ids).sort());
    expect((await list('bruno', S.alfa, { limit: 1000 })).rows).toHaveLength(5); // teto de 100 por página
    const pay1 = (await get('bruno', ids.luz)).payments[0];
    await fakeUpload(rpath({ account: ids.luz, payment: pay1.id }));
    expect(await rows('bruno', S.alfa, { receipt: true })).toEqual([]);
    await who.u('julia').rpc('attach_payment_receipt', pay1.id, rpath({ account: ids.luz, payment: pay1.id }), 'luz.pdf');
    expect(await rows('bruno', S.alfa, { receipt: true })).toEqual(['Conta de luz']);
    await who.u('bruno').rpc('confirm_receipt_sent', pay1.id, null);
    expect(await rows('bruno', S.alfa, { receipt: true })).toEqual([]);
  });

  it('resumo: a pagar, a receber e vencidos sobre os MESMOS filtros da listagem', async () => {
    const s = await summary('bruno', S.alfa);
    // a pagar: aluguel 2.000,00 em aberto (vencido) + luz quitada (450,50 liquidado); cancelada fora
    expect(s.payable).toMatchObject({ count: 2, amount_cents: 245050, settled_cents: 45050, open_cents: 200000, overdue_cents: 200000, overdue_count: 1 });
    // a receber: venda 800,00 com 300,00 recebidos (saldo 500,00) + serviço 150,00 pendente
    expect(s.receivable).toMatchObject({ count: 2, amount_cents: 95000, settled_cents: 30000, open_cents: 65000, overdue_cents: 0, overdue_count: 0 });
    expect(s.canceled_count).toBe(1);
    expect(s.by_store).toBeNull();
    expect(s.today).toBe(await today());
    // o filtro muda o resumo exatamente como muda a lista
    const f = { kind: 'receivable', df: '2099-04-01', dt: '2099-04-30' };
    const s2 = await summary('bruno', S.alfa, f);
    expect(s2.receivable).toMatchObject({ count: 1, amount_cents: 15000, open_cents: 15000 });
    expect(s2.payable).toMatchObject({ count: 0, amount_cents: 0, open_cents: 0 });
    expect((await list('bruno', S.alfa, f)).total).toBe(1);
  });

  it('consolidado: total = soma das lojas, cada conta contada uma única vez', async () => {
    await create('carla', { store: S.beta, desc: 'Boleto Beta', cents: 70000, kind: 'payable', due: '2026-03-10' });
    const bID = await create('carla', { store: S.beta, desc: 'Recebível Beta', cents: 10000, kind: 'receivable', due: '2026-12-10' });
    await pay('carla', bID, 2500);
    const total = await summary('ana', null);
    const alfa = await summary('ana', S.alfa);
    const beta = await summary('ana', S.beta);
    for (const k of ['payable', 'receivable'] as const) {
      for (const field of ['count', 'amount_cents', 'settled_cents', 'open_cents', 'overdue_cents', 'overdue_count']) {
        expect(Number(total[k][field]), `${k}.${field}`).toBe(Number(alfa[k][field]) + Number(beta[k][field]));
        const sum = total.by_store.reduce((acc: number, st: any) => acc + Number(st[k][field]), 0);
        expect(sum, `by_store ${k}.${field}`).toBe(Number(total[k][field]));
      }
    }
    expect(total.by_store.map((s: any) => s.store_name)).toEqual(['Loja Alfa', 'Loja Beta']);
    expect((await list('ana', null)).total).toBe(5 + 2);
    expect((await list('ana', null, { kind: 'payable' })).rows.every((r) => r.kind === 'payable')).toBe(true);
  });
});

describe('comprovantes: armazenamento privado, acesso por loja e envio confirmado à parte', () => {
  async function paid() {
    const a = await create('bruno', { cents: 50000 });
    const p = await pay('julia', a, 20000);
    return { a, p, path: rpath({ account: a, payment: p }) };
  }
  const insertObject = (user: keyof typeof U, path: string) =>
    who.u(user).err("insert into storage.objects (bucket_id, name, metadata) values ('receipts', $1, '{\"mimetype\":\"application/pdf\",\"size\":10}')", [path]);
  const insertOk = (user: keyof typeof U, path: string) =>
    who.u(user).q("insert into storage.objects (bucket_id, name, metadata) values ('receipts', $1, '{\"mimetype\":\"application/pdf\",\"size\":10}') returning id", [path]);

  it('upload: só com "confirmar liquidação" na loja, para o pagamento certo; leitura: só com "visualizar"', async () => {
    await who.owner().q("insert into storage.buckets (id, name) values ('receipts', 'receipts') on conflict do nothing");
    const { a, p, path } = await paid();
    // quem não pode
    expect((await insertObject('igor', path)).code).toBe('42501'); // só visualiza
    expect((await insertObject('lucas', path)).code).toBe('42501'); // outra loja
    expect((await insertObject('carla', path)).code).toBe('42501'); // responsável de outra loja
    expect((await who.anon().err("insert into storage.objects (bucket_id, name) values ('receipts', $1)", [path])).code).toBe('42501');
    // caminhos inválidos para quem pode
    for (const bad of [`${S.alfa}/${a}/${p}/../x.pdf`, `${S.alfa}/${a}/${p}/a b.pdf`, `${S.alfa}/${a}/${key()}/x.pdf`, `${S.alfa}/${key()}/${p}/x.pdf`, `${S.beta}/${a}/${p}/x.pdf`, `${a}/${p}/x.pdf`, `${S.alfa}/${a}/${p}/${'x'.repeat(101)}`]) {
      expect((await insertObject('julia', bad)).code, bad).toBe('42501');
    }
    // bucket diferente não tem política
    expect((await who.u('julia').err("insert into storage.objects (bucket_id, name) values ('outro', $1)", [path])).code).toMatch(/42501|23503/);
    // quem pode
    expect(await insertOk('julia', path)).toHaveLength(1);
    // leitura
    expect(await who.u('igor').q("select name from storage.objects where bucket_id = 'receipts'")).toEqual([{ name: path }]);
    expect(await who.u('bruno').q("select name from storage.objects where bucket_id = 'receipts'")).toHaveLength(1);
    expect(await who.u('ana').q("select name from storage.objects where bucket_id = 'receipts'")).toHaveLength(1);
    for (const k of ['lucas', 'carla', 'fabio', 'ines'] as const) expect(await who.u(k).q("select name from storage.objects where bucket_id = 'receipts'"), k).toEqual([]);
    expect(await who.anon().err("select name from storage.objects").then((e) => e.code)).toBe('42501');
  });

  it('ninguém atualiza nem apaga comprovantes; depois de anexado não aceita novo envio; estornado não aceita', async () => {
    const { a, p, path } = await paid();
    await insertOk('julia', path);
    for (const k of ['julia', 'bruno', 'ana'] as const) {
      expect(await who.u(k).q("update storage.objects set name = name || 'x' where bucket_id = 'receipts' returning id"), k).toEqual([]);
      expect(await who.u(k).q("delete from storage.objects where bucket_id = 'receipts' returning id"), k).toEqual([]);
    }
    expect(await who.owner().q("select 1 from storage.objects where name = $1", [path])).toHaveLength(1);
    await who.u('julia').rpc('attach_payment_receipt', p, path, 'nota.pdf');
    expect((await insertObject('julia', rpath({ account: a, payment: p }, 'outro.pdf'))).code).toBe('42501'); // já tem comprovante
    const a2 = await create('bruno');
    const p2 = await pay('bruno', a2, 100);
    await who.u('bruno').rpc('reverse_finance_payment', p2, 'Estorno de teste');
    expect((await insertObject('julia', rpath({ account: a2, payment: p2 }))).code).toBe('42501'); // estornado
  });

  it('anexar valida os metadados do PRÓPRIO Storage (tipo/tamanho/caminho) e não confirma envio', async () => {
    const { a, p, path } = await paid();
    const attach = (user: keyof typeof U, pid: string, file: string, name = 'comprovante.pdf') => who.u(user).rpcErr('attach_payment_receipt', pid, file, name);
    expect((await attach('julia', p, path)).hint).toBe('file'); // objeto não existe
    await fakeUpload(path, 'text/html', 100);
    expect(await attach('julia', p, path)).toMatchObject({ code: 'PT422', message: expect.stringMatching(/Tipo de arquivo/) });
    await who.owner().q("update storage.objects set metadata = '{\"mimetype\":\"application/pdf\",\"size\":5242881}' where name = $1", [path]);
    expect(await attach('julia', p, path)).toMatchObject({ code: 'PT422', message: expect.stringMatching(/5 MB/) });
    await who.owner().q("update storage.objects set metadata = '{\"mimetype\":\"image/png\",\"size\":2048}' where name = $1", [path]);
    expect((await attach('igor', p, path)).code).toBe('PT403');
    expect((await attach('lucas', p, path)).code).toMatch(/PT403/);
    // arquivo de OUTRO pagamento / caminho fora do padrão
    const outro = await pay('bruno', a, 100);
    await fakeUpload(rpath({ account: a, payment: outro }));
    expect((await attach('julia', p, rpath({ account: a, payment: outro }))).hint).toBe('file');
    expect((await attach('julia', p, `${S.alfa}/${a}/${p}/../${outro}`)).hint).toBe('file');
    await who.u('julia').rpc('attach_payment_receipt', p, path, 'Comprovante março.png');
    const [row] = (await get('bruno', a)).payments.filter((x) => x.id === p);
    expect(row).toMatchObject({ receipt_path: path, receipt_name: 'Comprovante março.png', receipt_mime: 'image/png', receipt_size: 2048, receipt_attached_by_name: 'Julia', receipt_sent_at: null, receipt_sent_by_name: null });
    expect((await attach('julia', p, path)).code).toBe('PT409'); // já anexado: não troca
  });

  it('confirmar envio é separado: exige permissão própria e anexo; registra quem e quando; repetir não altera', async () => {
    const { p, path } = await paid();
    const send = (user: keyof typeof U, note: string | null = null) => who.u(user).rpcErr('confirm_receipt_sent', p, note);
    expect((await send('bruno')).message).toMatch(/Anexe o comprovante/); // sem anexo
    await fakeUpload(path);
    await who.u('julia').rpc('attach_payment_receipt', p, path, 'c.pdf');
    const pending = async () => (await who.u('bruno').rpc('finance_summary', ...listArgs(S.alfa).slice(0, 10)))[0]!.r.receipts_pending_count as number;
    expect(await pending()).toBe(1); // anexado ≠ enviado
    expect((await send('julia')).code).toBe('PT403'); // pode liquidar/anexar, não confirmar envio
    expect((await send('igor')).code).toBe('PT403');
    await who.u('bruno').rpc('confirm_receipt_sent', p, 'Enviado por WhatsApp ao fornecedor');
    const [first] = (await get('bruno', p === '' ? '' : (await who.owner().q('select account_id from public.finance_payments where id = $1', [p]))[0]!.account_id)).payments;
    expect(first).toMatchObject({ receipt_sent_by_name: 'Bruno', receipt_sent_note: 'Enviado por WhatsApp ao fornecedor' });
    expect(first.receipt_sent_at).not.toBeNull();
    expect(await pending()).toBe(0);
    await who.u('bruno').rpc('confirm_receipt_sent', p, 'outra nota'); // repetição: sem efeito
    const [again] = await who.owner().q('select receipt_sent_at, receipt_sent_note from public.finance_payments where id = $1', [p]);
    expect(new Date(again!.receipt_sent_at).getTime()).toBe(new Date(first.receipt_sent_at).getTime());
    expect(again!.receipt_sent_note).toBe('Enviado por WhatsApp ao fornecedor');
    expect(await who.owner().q("select 1 from public.audit_log where action = 'financeiro_envio_confirmado'")).toHaveLength(1);
    expect((await who.owner().err('update public.finance_payments set receipt_sent_at = now() - interval \'1 day\' where id = $1', [p])).code).toBe('PT409');
    // estornado não aceita
    const a2 = await create('bruno');
    const p2 = await pay('bruno', a2, 100);
    await who.u('bruno').rpc('reverse_finance_payment', p2, 'Estorno de teste');
    expect((await who.u('bruno').rpcErr('confirm_receipt_sent', p2, null)).code).toBe('PT409');
  });

  it('falha no upload depois do pagamento salvo: tentar de novo anexa sem duplicar o pagamento', async () => {
    const a = await create('bruno', { cents: 10000 });
    const k = key();
    const p = await pay('julia', a, 4000, k); // pagamento salvo; o upload "falhou" (nenhum objeto existe)
    const path = rpath({ account: a, payment: p });
    expect((await who.u('julia').rpcErr('attach_payment_receipt', p, path, 'c.pdf')).hint).toBe('file');
    expect((await get('bruno', a)).account.balance_cents).toBe(6000); // o pagamento continua válido
    // nova tentativa: o cliente reenvia a MESMA requisição de pagamento (devolve o mesmo id) e refaz o upload
    expect(await pay('julia', a, 4000, k)).toBe(p);
    await insertOk('julia', path);
    await who.u('julia').rpc('attach_payment_receipt', p, path, 'c.pdf');
    const { payments, account } = await get('bruno', a);
    expect(payments).toHaveLength(1);
    expect(payments[0].receipt_path).toBe(path);
    expect(account.balance_cents).toBe(6000);
  });
});

describe('histórico e auditoria financeira', () => {
  it('registra criação, edição, liquidação, estorno, comprovante, envio e cancelamento; legível com "visualizar"', async () => {
    const a = await create('bruno', { cents: 20000, desc: 'Fornecedor X' });
    await who.u('bruno').rpc('update_finance_account', a, 'Fornecedor X', 'Compras', 'Forn X', 25000, '2026-03-01', '2026-03-15', '');
    const p = await pay('julia', a, 10000, key(), { method: 'boleto' });
    const path = rpath({ account: a, payment: p });
    await fakeUpload(path);
    await who.u('julia').rpc('attach_payment_receipt', p, path, 'c.pdf');
    await who.u('bruno').rpc('confirm_receipt_sent', p, null);
    await who.u('bruno').rpc('reverse_finance_payment', p, 'Pagamento duplicado');
    await who.u('bruno').rpc('cancel_finance_account', a, 'Fornecedor trocado');

    const hist = (await who.u('igor').rpc('finance_account_history', a))[0]!.r as { action: string; actor_name: string; summary: string }[];
    expect(hist.map((h) => h.action).reverse()).toEqual([
      'financeiro_conta_criada', 'financeiro_conta_editada', 'financeiro_liquidacao', 'financeiro_comprovante_anexado',
      'financeiro_envio_confirmado', 'financeiro_estorno', 'financeiro_conta_cancelada',
    ]);
    const by = Object.fromEntries(hist.map((h) => [h.action, h]));
    expect(by.financeiro_conta_criada).toMatchObject({ actor_name: 'Bruno', summary: expect.stringMatching(/Conta a pagar criada: Fornecedor X \(R\$ 200,00\), vencimento 10\/03\/2026/) });
    expect(by.financeiro_liquidacao).toMatchObject({ actor_name: 'Julia', summary: expect.stringMatching(/Pagamento de R\$ 100,00 confirmado .* \(boleto, 05\/03\/2026\)/) });
    expect(by.financeiro_estorno!.summary).toMatch(/Motivo: Pagamento duplicado/);
    expect(by.financeiro_conta_cancelada!.summary).toMatch(/Motivo: Fornecedor trocado/);
    // quem não vê o financeiro da loja não lê o histórico; a auditoria geral segue append-only
    expect((await who.u('lucas').rpcErr('finance_account_history', a)).code).toBe('PT403');
    expect((await who.u('bruno').err("update public.audit_log set summary = 'x' where action like 'financeiro%'")).code).toBe('42501');
    expect((await who.owner().err("delete from public.audit_log where action like 'financeiro%'")).code).toBe('PT403');
    // ator real e loja no registro central
    const [row] = await who.u('ana').q("select actor_id, store_id, store_name, details from public.audit_log where action = 'financeiro_estorno'");
    expect(row).toMatchObject({ actor_id: U.bruno, store_id: S.alfa, store_name: 'Loja Alfa' });
    expect(row!.details).toMatchObject({ account_id: a, payment_id: p, amount_cents: 10000, reason: 'Pagamento duplicado' });
  });

  it('operação e auditoria são atômicas: se a auditoria falhar, a liquidação não é gravada', async () => {
    const a = await create('bruno');
    await who.owner().q('alter table public.audit_log add constraint audit_boom check (action <> \'financeiro_liquidacao\') not valid');
    const e = await payErr('bruno', a, 100);
    expect(e.code).toBe('23514');
    await who.owner().q('alter table public.audit_log drop constraint audit_boom');
    expect((await get('bruno', a)).payments).toHaveLength(0);
  });
});

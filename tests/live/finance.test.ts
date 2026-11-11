// Financeiro contra a pilha REAL do Supabase LOCAL: Auth (JWT reais), PostgREST, Storage (bucket privado) e
// Postgres. Identidades distintas; nada é simulado. Mesmas variáveis e pré-requisitos de tests/live/stack.test.ts:
//   supabase start && supabase db reset && npm run dev:seed   # veja o cabeçalho de stack.test.ts
//   LIVE_SUPABASE_URL=... LIVE_SUPABASE_ANON_KEY=... LIVE_SERVICE_ROLE_KEY=... LIVE_DB_URL=... LIVE_MAIL_URL=... npx vitest run tests/live
// Registros financeiros nunca são apagados (gatilhos): cada execução usa um rótulo único e `supabase db reset` limpa tudo.
import { randomUUID } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const URL = process.env.LIVE_SUPABASE_URL!;
const ANON = process.env.LIVE_SUPABASE_ANON_KEY!;
const SERVICE = process.env.LIVE_SERVICE_ROLE_KEY!;
const DB_URL = process.env.LIVE_DB_URL!;
const ENABLED = !!(URL && ANON && SERVICE && DB_URL);
const PASSWORD = 'DevLocal2026x';
const TAG = `T${Date.now().toString(36)}`; // isola os dados desta execução

const FIN_FULL = ['view', 'create', 'edit', 'delete', 'export', 'settle', 'reverse', 'confirm_send'];
const fresh = (key = ANON) => createClient(URL, key, { auth: { persistSession: false, autoRefreshToken: false } });
const clients: Record<string, SupabaseClient> = {};
const tokens: Record<string, string> = {};
async function login(who: string) {
  const c = fresh();
  const { data, error } = await c.auth.signInWithPassword({ email: `${who}@dev.example`, password: PASSWORD });
  if (error) throw new Error(`login ${who}: ${error.message}`);
  clients[who] = c;
  tokens[who] = data.session!.access_token;
}

async function http(token: string | null, path: string, init: RequestInit & { prefer?: string } = {}) {
  const res = await fetch(`${URL}/rest/v1/${path}`, {
    ...init,
    headers: { apikey: ANON, Authorization: `Bearer ${token ?? ANON}`, 'Content-Type': 'application/json', ...(init.prefer ? { Prefer: init.prefer } : {}), ...(init.headers as object) },
  });
  const text = await res.text();
  let body: any = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  return { status: res.status, body };
}
const rpc = (who: string | null, fn: string, args: object = {}, prefer?: string) => http(who ? tokens[who]! : null, `rpc/${fn}`, { method: 'POST', body: JSON.stringify(args), prefer });

let db: pg.Client;
const sql = async (q: string, p: unknown[] = []) => (await db.query(q, p)).rows;
let ALFA = '';
let BETA = '';
const original: { id: string; permissions: any }[] = [];

async function setFinance(email: string, store: string, actions: string[] | null) {
  const [m] = await sql('select m.id, m.role, m.job_title, m.permissions from public.memberships m join public.profiles p on p.id = m.person_id where p.email = $1 and m.store_id = $2', [email, store]);
  original.push({ id: m!.id, permissions: m!.permissions });
  const permissions = { ...m!.permissions };
  if (actions) permissions.finance = actions; else delete permissions.finance;
  const r = await rpc('ana', 'update_membership', { p_membership_id: m!.id, p_job_title: m!.job_title, p_role: m!.role, p_permissions: permissions });
  expect(r.status, `grant ${email}`).toBeLessThan(300);
}

beforeAll(async () => {
  if (!ENABLED) return;
  db = new pg.Client({ connectionString: DB_URL });
  await db.connect();
  ALFA = (await sql("select id from public.stores where code = 'A01'"))[0]!.id;
  BETA = (await sql("select id from public.stores where code = 'B02'"))[0]!.id;
  for (const who of ['ana', 'bruno', 'julia', 'igor', 'carla', 'lucas']) await login(who);
  // Permissões EXPLÍCITAS e diferentes, concedidas pelo administrador pelo caminho normal (RPC com o JWT dele).
  await setFinance('bruno@dev.example', ALFA, FIN_FULL);
  await setFinance('julia@dev.example', ALFA, ['view', 'create', 'settle']);
  await setFinance('igor@dev.example', ALFA, ['view']);
  await setFinance('carla@dev.example', BETA, FIN_FULL);
  // Lucas (Beta) segue SEM financeiro algum.
  // Os JWT existentes continuam válidos: as permissões vêm do banco a cada chamada.
}, 60_000);

afterAll(async () => {
  if (!ENABLED) return;
  for (const o of original.reverse()) {
    const [m] = await sql('select role, job_title from public.memberships where id = $1', [o.id]);
    await rpc('ana', 'update_membership', { p_membership_id: o.id, p_job_title: m!.job_title, p_role: m!.role, p_permissions: o.permissions });
  }
  await db.end();
});

// ---------- atalhos ----------
const acct = (o: Record<string, unknown> = {}) => ({
  p_store_id: ALFA, p_kind: 'payable', p_description: `${TAG} Aluguel`, p_category: 'Aluguel', p_counterparty: 'Imobiliária Exemplo',
  p_amount_cents: 100000, p_competence_date: '2026-03-01', p_due_date: '2026-03-10', p_notes: '', p_idempotency_key: randomUUID(), ...o,
});
const createAcc = async (who = 'bruno', o: Record<string, unknown> = {}) => {
  const r = await rpc(who, 'create_finance_account', acct(o));
  expect(r.status, JSON.stringify(r.body)).toBe(200);
  return r.body as string;
};
const payBody = (account: string, cents: number, key = randomUUID(), o: Record<string, unknown> = {}) => ({
  p_account_id: account, p_amount_cents: cents, p_paid_on: '2026-03-05', p_method: 'pix', p_notes: '', p_idempotency_key: key, ...o,
});
const pay = async (who: string, account: string, cents: number, key = randomUUID()) => {
  const r = await rpc(who, 'confirm_finance_payment', payBody(account, cents, key));
  expect(r.status, JSON.stringify(r.body)).toBe(200);
  return r.body as string;
};
const detail = async (who: string, id: string) => (await rpc(who, 'finance_get_account', { p_account_id: id })).body as { account: any; payments: any[] };
const listArgs = (store: string | null, f: Record<string, unknown> = {}) => ({
  p_store_id: store, p_kind: null, p_status: null, p_competence_from: null, p_competence_to: null, p_due_from: null, p_due_to: null,
  p_search: TAG, p_overdue: false, p_receipt_pending: false, p_limit: 100, p_offset: 0, ...f,
});
const summaryArgs = (store: string | null, f: Record<string, unknown> = {}) => { const { p_limit, p_offset, ...rest } = listArgs(store, f); void p_limit; void p_offset; return rest; };
const PDF = new TextEncoder().encode('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF');
const rpath = (store: string, account: string, payment: string, file = `${randomUUID()}.pdf`) => `${store}/${account}/${payment}/${file}`;
const upload = (who: string, path: string, body: Uint8Array = PDF, contentType = 'application/pdf', upsert = false) =>
  clients[who]!.storage.from('receipts').upload(path, body, { contentType, upsert });

describe.runIf(ENABLED)('financeiro · permissões e isolamento (HTTP real)', () => {
  it('sem financeiro, sem sessão ou em outra loja: 401/403 em todas as operações', async () => {
    const a = await createAcc();
    const p = await pay('bruno', a, 1000);
    for (const [who, expected] of [['lucas', 403], ['carla', 403]] as const) {
      expect((await rpc(who, 'finance_get_account', { p_account_id: a })).status, who).toBe(expected);
      expect((await rpc(who, 'finance_list', listArgs(ALFA))).status, who).toBe(expected);
      expect((await rpc(who, 'create_finance_account', acct())).status, who).toBe(expected);
      expect((await rpc(who, 'confirm_finance_payment', payBody(a, 100))).status, who).toBe(expected);
      expect((await rpc(who, 'reverse_finance_payment', { p_payment_id: p, p_reason: 'motivo qualquer' })).status, who).toBe(expected);
      expect((await rpc(who, 'finance_account_history', { p_account_id: a })).status, who).toBe(expected);
    }
    expect([401, 403]).toContain((await rpc(null, 'finance_list', listArgs(ALFA))).status);
    for (const t of ['finance_accounts', 'finance_payments', 'finance_accounts_v']) expect([401, 403]).toContain((await http(null, `${t}?select=*`)).status);
    // RLS direta: Carla (Beta) e Lucas só veem o que a loja deles permite
    expect((await http(tokens.carla!, `finance_accounts?select=id&id=eq.${a}`)).body).toEqual([]);
    expect((await http(tokens.lucas!, 'finance_accounts?select=id')).body).toEqual([]);
    expect(((await http(tokens.bruno!, `finance_payments?select=id&account_id=eq.${a}`)).body as unknown[]).length).toBe(1);
  });

  it('cada ação exige a sua permissão (Igor só vê; Julia cria e liquida; Bruno faz tudo)', async () => {
    const a = await createAcc('bruno');
    const p = await pay('julia', a, 500);
    expect((await rpc('igor', 'finance_get_account', { p_account_id: a })).status).toBe(200);
    expect((await rpc('igor', 'create_finance_account', acct())).status).toBe(403);
    expect((await rpc('igor', 'confirm_finance_payment', payBody(a, 100))).status).toBe(403);
    expect((await rpc('julia', 'update_finance_account', { p_account_id: a, p_description: `${TAG} x`, p_category: '', p_counterparty: '', p_amount_cents: 100000, p_competence_date: '2026-03-01', p_due_date: '2026-03-10', p_notes: '' })).status).toBe(403);
    expect((await rpc('julia', 'reverse_finance_payment', { p_payment_id: p, p_reason: 'motivo qualquer' })).status).toBe(403);
    expect((await rpc('julia', 'confirm_receipt_sent', { p_payment_id: p, p_note: null })).status).toBe(403);
    expect((await rpc('julia', 'cancel_finance_account', { p_account_id: a, p_reason: 'motivo qualquer' })).status).toBe(403);
    expect((await rpc('julia', 'create_finance_account', acct({ p_description: `${TAG} criada pela Julia` }))).status).toBe(200);
  });

  it('escrita direta pela API REST é negada; consolidado só para o administrador geral', async () => {
    const a = await createAcc();
    for (const [method, path, body] of [
      ['POST', 'finance_accounts', { store_id: ALFA, kind: 'payable', description: 'x', amount_cents: 1, competence_date: '2026-03-01', due_date: '2026-03-01' }],
      ['PATCH', `finance_accounts?id=eq.${a}`, { amount_cents: 1 }],
      ['DELETE', `finance_accounts?id=eq.${a}`, undefined],
      ['PATCH', 'finance_payments?id=not.is.null', { amount_cents: 1 }],
      ['DELETE', 'finance_payments?id=not.is.null', undefined],
    ] as const) {
      const r = await http(tokens.bruno!, path, { method, body: body ? JSON.stringify(body) : undefined });
      expect([401, 403], `${method} ${path}`).toContain(r.status);
    }
    expect((await rpc('bruno', 'finance_list', listArgs(null))).status).toBe(403);
    expect((await rpc('carla', 'finance_summary', summaryArgs(null))).status).toBe(403);
    const all = await rpc('ana', 'finance_list', listArgs(null));
    expect(all.status).toBe(200);
    expect(all.body.rows.every((r: any) => r.description.startsWith(TAG))).toBe(true);
  });

  it('administrador geral age em qualquer loja sem vínculo; a matriz não concede financeiro automaticamente', async () => {
    const [helena] = await sql("select m.permissions from public.memberships m join public.profiles p on p.id = m.person_id where p.email = 'helena@dev.example'");
    expect(helena!.permissions.finance).toEqual(['view', 'create', 'edit', 'delete', 'export']); // permissões antigas intactas
    await login('helena');
    const a = await createAcc('helena'); // pode criar (tinha "criar")
    expect((await rpc('helena', 'confirm_finance_payment', payBody(a, 100))).status).toBe(403); // não ganhou "liquidar"
    expect((await rpc('ana', 'confirm_finance_payment', payBody(a, 100))).status).toBe(200); // administrador: tudo
  });
});

describe.runIf(ENABLED)('financeiro · contas, liquidações, saldo e estornos (HTTP real)', () => {
  it('liquidação parcial e total; saldo exato em centavos; datas sem deslocamento em qualquer fuso', async () => {
    const a = await createAcc('bruno', { p_amount_cents: 10000, p_competence_date: '2026-03-31', p_due_date: '2026-01-01' });
    await pay('bruno', a, 3333);
    let d = await detail('bruno', a);
    expect(d.account).toMatchObject({ situation: 'partial', settled_cents: 3333, balance_cents: 6667, currency: 'BRL', competence_date: '2026-03-31', due_date: '2026-01-01', is_overdue: true });
    await pay('julia', a, 3333);
    await pay('bruno', a, 3334);
    d = await detail('bruno', a);
    expect(d.account).toMatchObject({ situation: 'paid', settled_cents: 10000, balance_cents: 0, is_overdue: false });
    expect(d.payments.map((p) => p.created_by_name)).toEqual(['Bruno Almeida', 'Júlia Nunes', 'Bruno Almeida']);
    // as datas não mudam com o fuso pedido ao PostgREST
    for (const tz of ['UTC', 'Pacific/Kiritimati', 'Pacific/Honolulu', 'America/Sao_Paulo']) {
      const r = await rpc('bruno', 'finance_get_account', { p_account_id: a }, `timezone=${tz}`);
      expect(r.body.account, tz).toMatchObject({ competence_date: '2026-03-31', due_date: '2026-01-01' });
      expect(r.body.payments[0].paid_on, tz).toBe('2026-03-05');
    }
  });

  it('recusa valor zero, negativo, acima do saldo, data futura e forma inválida (HTTP 422)', async () => {
    const a = await createAcc('bruno', { p_amount_cents: 5000 });
    for (const c of [0, -1]) expect((await rpc('bruno', 'confirm_finance_payment', payBody(a, c))).status).toBe(422);
    const over = await rpc('bruno', 'confirm_finance_payment', payBody(a, 5001));
    expect(over).toMatchObject({ status: 422, body: { hint: 'amountCents', message: expect.stringMatching(/saldo pendente \(R\$ 50,00\)/) } });
    const tomorrow = (await sql("select (private.today_sp() + 1)::text d"))[0]!.d;
    expect((await rpc('bruno', 'confirm_finance_payment', payBody(a, 100, randomUUID(), { p_paid_on: tomorrow }))).body.hint).toBe('paidOn');
    expect((await rpc('bruno', 'confirm_finance_payment', payBody(a, 100, randomUUID(), { p_method: 'bitcoin' }))).body.hint).toBe('method');
    expect((await detail('bruno', a)).payments).toHaveLength(0);
  });

  it('repetição da mesma requisição (sequencial e 25 simultâneas) não duplica; outra chave com os mesmos dados é outro pagamento', async () => {
    const a = await createAcc('bruno', { p_amount_cents: 100000 });
    const k = randomUUID();
    const first = await pay('julia', a, 4000, k);
    expect(await pay('julia', a, 4000, k)).toBe(first);
    const k2 = randomUUID();
    const burst = await Promise.all(Array.from({ length: 25 }, () => rpc('julia', 'confirm_finance_payment', payBody(a, 4000, k2))));
    expect(burst.every((r) => r.status === 200)).toBe(true);
    expect(new Set(burst.map((r) => r.body)).size).toBe(1);
    expect((await detail('bruno', a)).payments).toHaveLength(2);
    expect((await rpc('julia', 'confirm_finance_payment', payBody(a, 4001, k))).status).toBe(409); // mesma chave, outro valor
    expect((await detail('bruno', a)).account.balance_cents).toBe(92000);
    // criação de conta idempotente
    const ck = randomUUID();
    const ids = await Promise.all(Array.from({ length: 10 }, () => rpc('bruno', 'create_finance_account', acct({ p_description: `${TAG} idempotente`, p_idempotency_key: ck }))));
    expect(new Set(ids.map((r) => r.body)).size).toBe(1);
  });

  it('10 liquidações simultâneas de R$ 30,00 sobre R$ 100,00 (conexões reais): exatamente 3 passam', async () => {
    const a = await createAcc('bruno', { p_amount_cents: 10000 });
    const r = await Promise.all(Array.from({ length: 10 }, () => rpc('julia', 'confirm_finance_payment', payBody(a, 3000))));
    expect(r.filter((x) => x.status === 200)).toHaveLength(3);
    expect(r.filter((x) => x.status === 422)).toHaveLength(7);
    const d = await detail('bruno', a);
    expect(d.account).toMatchObject({ settled_cents: 9000, balance_cents: 1000, situation: 'partial' });
    expect(d.payments).toHaveLength(3);
    // duas pessoas diferentes disputando o saldo restante
    const [x, y] = await Promise.all([rpc('bruno', 'confirm_finance_payment', payBody(a, 1000)), rpc('julia', 'confirm_finance_payment', payBody(a, 1000))]);
    expect([x.status, y.status].sort()).toEqual([200, 422]);
    expect((await detail('bruno', a)).account).toMatchObject({ balance_cents: 0, situation: 'paid' });
  });

  it('estorno recalcula o saldo e preserva o registro; estornar duas vezes (também em paralelo) só vale uma', async () => {
    const a = await createAcc('bruno', { p_amount_cents: 10000 });
    const p1 = await pay('bruno', a, 6000);
    await pay('bruno', a, 4000);
    expect((await rpc('bruno', 'reverse_finance_payment', { p_payment_id: p1, p_reason: ' ' })).body.hint).toBe('reason');
    const r = await Promise.all(Array.from({ length: 5 }, () => rpc('bruno', 'reverse_finance_payment', { p_payment_id: p1, p_reason: 'Valor lançado errado' })));
    expect(r.filter((x) => x.status < 300)).toHaveLength(1);
    expect(r.filter((x) => x.status === 409)).toHaveLength(4);
    const d = await detail('bruno', a);
    expect(d.account).toMatchObject({ situation: 'partial', settled_cents: 4000, balance_cents: 6000 });
    expect(d.payments).toHaveLength(2); // nada apagado
    expect(d.payments[0]).toMatchObject({ id: p1, amount_cents: 6000, reversal_reason: 'Valor lançado errado', reversed_by_name: 'Bruno Almeida' });
    // o registro original é imutável, mesmo para o dono do banco; e não há como apagar
    for (const q of ['update public.finance_payments set amount_cents = 1 where id = $1', 'delete from public.finance_payments where id = $1', 'update public.finance_payments set reversed_at = null, reversed_by = null, reversal_reason = null where id = $1'])
      await expect(sql(q, [p1])).rejects.toMatchObject({ code: expect.stringMatching(/PT403|PT409/) });
    expect((await fresh(SERVICE).from('finance_payments').delete().eq('id', p1)).error?.code).toBe('PT403'); // nem com a chave de serviço
  });

  it('cancelamento exige estornar as liquidações; edição não reduz abaixo do liquidado', async () => {
    const a = await createAcc('bruno', { p_amount_cents: 100000 });
    const p = await pay('bruno', a, 40000);
    const upd = (cents: number) => rpc('bruno', 'update_finance_account', { p_account_id: a, p_description: `${TAG} Aluguel`, p_category: '', p_counterparty: '', p_amount_cents: cents, p_competence_date: '2026-03-01', p_due_date: '2026-03-10', p_notes: '' });
    expect((await upd(39999)).body).toMatchObject({ hint: 'amountCents', message: expect.stringMatching(/R\$ 400,00/) });
    expect((await upd(40000)).status).toBeLessThan(300);
    expect((await rpc('bruno', 'cancel_finance_account', { p_account_id: a, p_reason: 'Cliente desistiu' })).body.message).toMatch(/Estorne-as antes/);
    await rpc('bruno', 'reverse_finance_payment', { p_payment_id: p, p_reason: 'Estorno para cancelar' });
    expect((await rpc('bruno', 'cancel_finance_account', { p_account_id: a, p_reason: 'Cliente desistiu' })).status).toBeLessThan(300);
    const d = await detail('bruno', a);
    expect(d.account).toMatchObject({ situation: 'canceled', status: 'canceled', cancel_reason: 'Cliente desistiu', is_overdue: false });
    expect((await rpc('bruno', 'confirm_finance_payment', payBody(a, 100))).status).toBe(409);
    expect((await upd(50000)).status).toBe(409);
  });
});

describe.runIf(ENABLED)('financeiro · filtros, busca, resumos e atraso (HTTP real)', () => {
  it('filtros por tipo, situação, vencimento e competência; busca literal; paginação; resumo no mesmo filtro; atraso em São Paulo', async () => {
    const t = TAG + 'F';
    const today = (await sql("select private.today_sp()::text d"))[0]!.d as string;
    const yday = (await sql("select (private.today_sp() - 1)::text d"))[0]!.d as string;
    const mk = (d: string, extra: Record<string, unknown>) => createAcc('bruno', { p_description: `${t} ${d}`, ...extra });
    const luz = await mk('Luz', { p_kind: 'payable', p_amount_cents: 45050, p_competence_date: '2026-02-15', p_due_date: yday, p_counterparty: 'Energia SA' });
    const venda = await mk('Venda 100% à vista_A', { p_kind: 'receivable', p_amount_cents: 80000, p_competence_date: '2026-03-20', p_due_date: '2099-05-01', p_counterparty: 'Cliente João' });
    const hoje = await mk('Vence hoje', { p_kind: 'payable', p_amount_cents: 1000, p_due_date: today });
    await pay('bruno', venda, 30000);
    const f = (o: Record<string, unknown>) => listArgs(ALFA, { p_search: null, ...o });
    const names = async (o: Record<string, unknown>) => ((await rpc('bruno', 'finance_list', { ...f(o), p_search: o.p_search ?? t })).body.rows as any[]).map((r) => r.description.replace(`${t} `, '')).sort();
    expect(await names({})).toEqual(['Luz', 'Venda 100% à vista_A', 'Vence hoje'].sort());
    expect(await names({ p_kind: 'receivable' })).toEqual(['Venda 100% à vista_A']);
    expect(await names({ p_status: 'partial' })).toEqual(['Venda 100% à vista_A']);
    expect(await names({ p_status: 'open' })).toEqual(['Luz', 'Venda 100% à vista_A', 'Vence hoje'].sort());
    expect(await names({ p_overdue: true })).toEqual(['Luz']); // venceu ontem; "vence hoje" NÃO está em atraso
    expect(await names({ p_due_from: today, p_due_to: today })).toEqual(['Vence hoje']);
    expect(await names({ p_competence_from: '2026-03-01', p_competence_to: '2026-03-31' })).toContain('Venda 100% à vista_A');
    expect(await names({ p_search: `${t} Venda 100%` })).toEqual(['Venda 100% à vista_A']);
    expect(await names({ p_search: `${t} cliente joão` })).toEqual([]); // a busca é por descrição OU contraparte, não pela soma
    expect(await names({ p_search: 'cliente joão' })).toContain('Venda 100% à vista_A');
    expect(await names({ p_search: "'; drop table finance_accounts; --" })).toEqual([]);
    const page = await rpc('bruno', 'finance_list', { ...f({ p_limit: 2, p_offset: 0 }), p_search: t });
    expect(page.body.total).toBe(3);
    expect(page.body.rows).toHaveLength(2);
    // resumo no MESMO filtro e "hoje" de São Paulo
    const sum = (await rpc('bruno', 'finance_summary', { ...summaryArgs(ALFA, {}), p_search: t })).body;
    expect(sum.payable).toMatchObject({ count: 2, amount_cents: 46050, open_cents: 46050, overdue_cents: 45050, overdue_count: 1 });
    expect(sum.receivable).toMatchObject({ count: 1, amount_cents: 80000, settled_cents: 30000, open_cents: 50000, overdue_cents: 0 });
    const spToday = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
    expect([spToday, new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(Date.now() + 5000))]).toContain(sum.today);
    expect((await rpc('bruno', 'finance_summary', { ...summaryArgs(ALFA, { p_kind: 'receivable' }), p_search: t })).body.payable.count).toBe(0);
    void luz; void hoje;
  });

  it('consolidado: total = soma das lojas, cada conta uma vez', async () => {
    const t = TAG + 'C';
    await createAcc('bruno', { p_description: `${t} Alfa`, p_amount_cents: 70000 });
    const b = await createAcc('carla', { p_store_id: BETA, p_description: `${t} Beta`, p_amount_cents: 30000, p_kind: 'receivable' });
    await pay('carla', b, 10000);
    const s = (await rpc('ana', 'finance_summary', { ...summaryArgs(null), p_search: t })).body;
    const sumStores = (k: 'payable' | 'receivable', f: string) => s.by_store.reduce((acc: number, st: any) => acc + Number(st[k][f]), 0);
    for (const k of ['payable', 'receivable'] as const) for (const f of ['count', 'amount_cents', 'settled_cents', 'open_cents']) expect(sumStores(k, f), `${k}.${f}`).toBe(Number(s[k][f]));
    expect(s.payable.amount_cents).toBe(70000);
    expect(s.receivable).toMatchObject({ amount_cents: 30000, settled_cents: 10000, open_cents: 20000 });
    expect(s.by_store.map((x: any) => x.store_name)).toEqual(['Loja Alfa', 'Loja Beta']);
    expect((await rpc('ana', 'finance_list', { ...listArgs(null), p_search: t })).body.total).toBe(2);
  });
});

describe.runIf(ENABLED)('financeiro · comprovantes no Storage real (bucket privado)', () => {
  async function paid() {
    const a = await createAcc('bruno', { p_amount_cents: 50000 });
    const p = await pay('julia', a, 20000);
    return { a, p };
  }
  const attach = (who: string, p: string, path: string, name = 'comprovante.pdf') => rpc(who, 'attach_payment_receipt', { p_payment_id: p, p_file_path: path, p_file_name: name });

  it('o bucket é privado e só aceita imagem/PDF até 5 MB (configuração do Storage real)', async () => {
    const res = await fetch(`${URL}/storage/v1/bucket/receipts`, { headers: { apikey: ANON, Authorization: `Bearer ${SERVICE}` } });
    expect(await res.json()).toMatchObject({ id: 'receipts', public: false, file_size_limit: 5242880, allowed_mime_types: ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'] });
  });

  it('upload: só quem pode liquidar, no caminho do pagamento; tipo e tamanho validados pelo Storage', async () => {
    const { a, p } = await paid();
    const path = rpath(ALFA, a, p);
    expect((await upload('igor', path)).error).toBeTruthy(); // só visualiza
    expect((await upload('lucas', path)).error).toBeTruthy(); // outra loja, sem financeiro
    expect((await upload('carla', path)).error).toBeTruthy(); // responsável de outra loja
    expect((await upload('julia', rpath(ALFA, a, randomUUID()))).error).toBeTruthy(); // pagamento inexistente
    expect((await upload('julia', rpath(ALFA, a, p, 'a b.pdf'))).error).toBeTruthy(); // nome inválido
    expect((await upload('julia', rpath(BETA, a, p))).error).toBeTruthy(); // loja trocada
    const html = await upload('julia', rpath(ALFA, a, p, `${randomUUID()}.pdf`), new TextEncoder().encode('<html>'), 'text/html');
    expect(html.error).toMatchObject({ statusCode: expect.stringMatching(/415|400/) }); // tipo fora da lista
    const big = await upload('julia', rpath(ALFA, a, p, `${randomUUID()}.pdf`), new Uint8Array(5 * 1024 * 1024 + 1), 'application/pdf');
    expect(big.error).toMatchObject({ statusCode: expect.stringMatching(/413|400/) });
    expect((await upload('julia', path)).error).toBeNull(); // quem pode, onde pode
    expect((await upload('julia', path, PDF, 'application/pdf', true)).error).toBeTruthy(); // não sobrescreve
  });

  it('anexar lê os metadados do próprio Storage; só quem liquida; um comprovante por pagamento; NÃO confirma envio', async () => {
    const { a, p } = await paid();
    const path = rpath(ALFA, a, p);
    expect((await attach('julia', p, path)).body.hint).toBe('file'); // ainda não enviado
    expect((await upload('julia', path)).error).toBeNull();
    expect((await attach('igor', p, path)).status).toBe(403);
    expect((await attach('lucas', p, path)).status).toBe(403);
    const other = await pay('bruno', a, 100);
    expect((await attach('julia', other, path)).status).toBe(422); // arquivo de outro pagamento
    expect((await attach('julia', p, path, 'Nota fiscal março.pdf')).status).toBeLessThan(300);
    const row = (await detail('bruno', a)).payments.find((x) => x.id === p)!;
    expect(row).toMatchObject({ receipt_path: path, receipt_name: 'Nota fiscal março.pdf', receipt_mime: 'application/pdf', receipt_attached_by_name: 'Júlia Nunes', receipt_sent_at: null, receipt_sent_by_name: null });
    expect(Number(row.receipt_size)).toBe(PDF.byteLength);
    expect((await attach('julia', p, path)).status).toBe(409);
    expect((await upload('julia', rpath(ALFA, a, p))).error).toBeTruthy(); // depois de anexado, não aceita outro arquivo
    // alerta: anexado ≠ enviado
    const s = (await rpc('bruno', 'finance_summary', { ...summaryArgs(ALFA), p_receipt_pending: true, p_search: TAG })).body;
    expect(s.receipts_pending_count).toBeGreaterThanOrEqual(1);
  });

  it('acesso ao arquivo: quem visualiza o financeiro da loja baixa; os demais, nunca (URL assinada, API direta e anônimo)', async () => {
    const { a, p } = await paid();
    const path = rpath(ALFA, a, p);
    await upload('julia', path);
    await attach('julia', p, path);
    const bucket = (who: string) => clients[who]!.storage.from('receipts');
    // autorizados: Igor (só visualiza), Julia, Bruno, Ana
    for (const who of ['igor', 'julia', 'bruno', 'ana']) {
      const signed = await bucket(who).createSignedUrl(path, 60);
      expect(signed.error, who).toBeNull();
      const bytes = new Uint8Array(await (await fetch(signed.data!.signedUrl)).arrayBuffer());
      expect(Buffer.from(bytes).equals(Buffer.from(PDF)), who).toBe(true);
      expect((await bucket(who).download(path)).error, who).toBeNull();
    }
    // download forçado (Content-Disposition: attachment) para o botão "Baixar"
    const forced = await bucket('igor').createSignedUrl(path, 60, { download: 'nota.pdf' });
    expect((await fetch(forced.data!.signedUrl)).headers.get('content-disposition')).toMatch(/attachment/);
    // negados: sem financeiro na loja Alfa, ou de outra loja
    for (const who of ['lucas', 'carla']) {
      expect((await bucket(who).createSignedUrl(path, 60)).error, who).toBeTruthy();
      expect((await bucket(who).download(path)).error, who).toBeTruthy();
      expect(((await bucket(who).list(`${ALFA}/${a}/${p}`)).data ?? []).length, who).toBe(0);
    }
    // anônimo e URL pública (bucket privado)
    expect((await fetch(`${URL}/storage/v1/object/public/receipts/${path}`)).ok).toBe(false);
    expect((await fetch(`${URL}/storage/v1/object/receipts/${path}`, { headers: { apikey: ANON } })).ok).toBe(false);
    expect((await fresh().storage.from('receipts').createSignedUrl(path, 60)).error).toBeTruthy();
    // ninguém apaga nem sobrescreve (o objeto continua intacto)
    for (const who of ['julia', 'bruno', 'ana']) {
      await bucket(who).remove([path]);
      await bucket(who).update(path, new TextEncoder().encode('%PDF-adulterado'), { contentType: 'application/pdf' });
    }
    const still = await (await fetch((await bucket('igor').createSignedUrl(path, 60)).data!.signedUrl)).arrayBuffer();
    expect(Buffer.from(still).equals(Buffer.from(PDF))).toBe(true);
    expect((await sql("select count(*)::int n from storage.objects where bucket_id = 'receipts' and name = $1", [path]))[0]!.n).toBe(1);
  });

  it('confirmar envio: permissão própria, exige anexo, registra quem/quando e repetir não altera', async () => {
    const { a, p } = await paid();
    const send = (who: string, note: string | null = null) => rpc(who, 'confirm_receipt_sent', { p_payment_id: p, p_note: note });
    expect((await send('bruno')).body.message).toMatch(/Anexe o comprovante/);
    const path = rpath(ALFA, a, p);
    await upload('julia', path);
    await attach('julia', p, path);
    expect((await send('julia')).status).toBe(403);
    expect((await send('igor')).status).toBe(403);
    expect((await send('bruno', 'Enviado por e-mail ao fornecedor')).status).toBeLessThan(300);
    const first = (await detail('bruno', a)).payments.find((x) => x.id === p)!;
    expect(first).toMatchObject({ receipt_sent_by_name: 'Bruno Almeida', receipt_sent_note: 'Enviado por e-mail ao fornecedor' });
    const [r2, r3] = await Promise.all([send('bruno', 'outra'), send('bruno', 'outra ainda')]);
    expect([r2.status, r3.status].every((s) => s < 300)).toBe(true);
    const again = (await detail('bruno', a)).payments.find((x) => x.id === p)!;
    expect(again.receipt_sent_at).toBe(first.receipt_sent_at);
    expect(again.receipt_sent_note).toBe('Enviado por e-mail ao fornecedor');
    expect((await sql("select count(*)::int n from public.audit_log where action = 'financeiro_envio_confirmado' and details ->> 'payment_id' = $1", [p]))[0]!.n).toBe(1);
  });

  it('upload falha depois do pagamento salvo: tentar de novo anexa sem duplicar o pagamento', async () => {
    const a = await createAcc('bruno', { p_amount_cents: 10000 });
    const k = randomUUID();
    const p = await pay('julia', a, 4000, k); // pagamento salvo
    const path = rpath(ALFA, a, p);
    const failed = await upload('julia', rpath(ALFA, a, p, `${randomUUID()}.pdf`), new Uint8Array(5 * 1024 * 1024 + 1)); // upload que falha
    expect(failed.error).toBeTruthy();
    expect((await attach('julia', p, path)).status).toBe(422); // nada para anexar ainda
    expect((await detail('bruno', a)).account.balance_cents).toBe(6000); // o pagamento continua válido
    expect(await pay('julia', a, 4000, k)).toBe(p); // reenvio da mesma requisição: mesmo pagamento
    expect((await upload('julia', path)).error).toBeNull();
    expect((await attach('julia', p, path)).status).toBeLessThan(300);
    const d = await detail('bruno', a);
    expect(d.payments).toHaveLength(1);
    expect(d.payments[0].receipt_path).toBe(path);
  });

  it('estornado não aceita comprovante; o upload fica bloqueado pela política', async () => {
    const { a, p } = await paid();
    await rpc('bruno', 'reverse_finance_payment', { p_payment_id: p, p_reason: 'Estorno de teste' });
    expect((await upload('julia', rpath(ALFA, a, p))).error).toBeTruthy();
    expect((await attach('julia', p, rpath(ALFA, a, p))).status).toBe(409);
    expect((await rpc('bruno', 'confirm_receipt_sent', { p_payment_id: p, p_note: null })).status).toBe(409);
  });
});

describe.runIf(ENABLED)('financeiro · histórico e auditoria (HTTP real)', () => {
  it('registra criação, edição, liquidação, comprovante, envio, estorno e cancelamento, com ator e loja', async () => {
    const a = await createAcc('bruno', { p_amount_cents: 20000, p_description: `${TAG} Fornecedor X` });
    await rpc('bruno', 'update_finance_account', { p_account_id: a, p_description: `${TAG} Fornecedor X`, p_category: 'Compras', p_counterparty: 'Forn X', p_amount_cents: 25000, p_competence_date: '2026-03-01', p_due_date: '2026-03-15', p_notes: '' });
    const p = await pay('julia', a, 10000);
    const path = rpath(ALFA, a, p);
    await upload('julia', path);
    await rpc('julia', 'attach_payment_receipt', { p_payment_id: p, p_file_path: path, p_file_name: 'c.pdf' });
    await rpc('bruno', 'confirm_receipt_sent', { p_payment_id: p, p_note: null });
    await rpc('bruno', 'reverse_finance_payment', { p_payment_id: p, p_reason: 'Pagamento duplicado' });
    await rpc('bruno', 'cancel_finance_account', { p_account_id: a, p_reason: 'Fornecedor trocado' });
    const hist = (await rpc('igor', 'finance_account_history', { p_account_id: a })).body as { action: string; actor_name: string; summary: string }[];
    expect(hist.map((h) => h.action).reverse()).toEqual(['financeiro_conta_criada', 'financeiro_conta_editada', 'financeiro_liquidacao', 'financeiro_comprovante_anexado', 'financeiro_envio_confirmado', 'financeiro_estorno', 'financeiro_conta_cancelada']);
    expect(hist.find((h) => h.action === 'financeiro_liquidacao')).toMatchObject({ actor_name: 'Júlia Nunes', summary: expect.stringMatching(/Pagamento de R\$ 100,00 confirmado/) });
    expect(hist.find((h) => h.action === 'financeiro_conta_editada')!.summary).toMatch(/valor alterado de R\$ 200,00 para R\$ 250,00/);
    expect((await rpc('lucas', 'finance_account_history', { p_account_id: a })).status).toBe(403);
    // a auditoria geral também as registra (quem tem "histórico" na loja as vê) e continua append-only
    const log = await http(tokens.bruno!, `audit_log?select=action,actor_name,store_name&action=like.financeiro_*&limit=1&order=seq.desc`);
    expect(log.body[0]).toMatchObject({ store_name: 'Loja Alfa' });
    expect([401, 403]).toContain((await http(tokens.ana!, 'audit_log?action=like.financeiro_*', { method: 'DELETE' })).status);
    expect((await fresh(SERVICE).from('audit_log').update({ summary: 'x' }).like('action', 'financeiro_%')).error?.code).toBe('PT403');
  });
});

// Integração contra a pilha REAL do Supabase LOCAL (GoTrue + PostgREST + Edge Function + Mailpit),
// com sessões de verdade (JWT emitido pelo Auth) de identidades distintas.
//
// Não roda por padrão (precisa de Docker + Supabase CLI). Para executar, em ambiente LOCAL:
//   supabase start && supabase db reset         # migrações + seed.sql, só no banco local
//   eval "$(supabase status -o env | sed 's/^/export /')"
//   SUPABASE_URL=$API_URL SUPABASE_SERVICE_ROLE_KEY=$SERVICE_ROLE_KEY npm run dev:seed
//   LIVE_SUPABASE_URL=$API_URL LIVE_SUPABASE_ANON_KEY=$ANON_KEY LIVE_SERVICE_ROLE_KEY=$SERVICE_ROLE_KEY \
//   LIVE_DB_URL=$DB_URL LIVE_MAIL_URL=$MAILPIT_URL npx vitest run tests/live
//
// A chave de serviço só é usada aqui para PREPARAR/CONFERIR casos (criar usuário pela API de administração).
// Os e-mails vão para o Mailpit local: nenhuma mensagem sai para pessoas reais. Isto NÃO valida a
// entrega por um SMTP hospedado.
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const URL = process.env.LIVE_SUPABASE_URL!;
const ANON = process.env.LIVE_SUPABASE_ANON_KEY!;
const SERVICE = process.env.LIVE_SERVICE_ROLE_KEY!;
const DB_URL = process.env.LIVE_DB_URL!;
const MAIL = process.env.LIVE_MAIL_URL!;
const ENABLED = !!(URL && ANON && SERVICE && DB_URL && MAIL);
const APP = 'http://127.0.0.1:5173'; // consta em additional_redirect_urls
const PASSWORD = 'DevLocal2026x'; // senha FICTÍCIA criada por scripts/dev-seed.mjs (somente local)
const DOMAIN = 'conv.dev.example'; // contas criadas pelos testes (removidas ao final)

const CALENDAR = { overview: ['view'], calendar: ['view'] };
const run = Date.now().toString(36);
let seq = 0;
const newEmail = (tag: string) => `${tag}-${run}-${seq++}@${DOMAIN}`;

const fresh = (key = ANON) => createClient(URL, key, { auth: { persistSession: false, autoRefreshToken: false } });
async function login(who: string, password = PASSWORD): Promise<SupabaseClient> {
  const c = fresh();
  const { error } = await c.auth.signInWithPassword({ email: who.includes('@') ? who : `${who}@dev.example`, password });
  if (error) throw new Error(`login ${who}: ${error.message}`);
  return c;
}
const tokenOf = async (c: SupabaseClient) => (await c.auth.getSession()).data.session!.access_token;

/** Chamada crua à API REST (para conferir o status HTTP, que o supabase-js esconde em parte). */
async function rest(token: string | null, path: string, init: RequestInit = {}) {
  const res = await fetch(`${URL}/rest/v1/${path}`, {
    ...init,
    headers: { apikey: ANON, Authorization: `Bearer ${token ?? ANON}`, 'Content-Type': 'application/json', ...(init.headers as object) },
  });
  const text = await res.text();
  let body: any = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  return { status: res.status, body };
}
const rpc = (token: string, fn: string, args: object = {}) => rest(token, `rpc/${fn}`, { method: 'POST', body: JSON.stringify(args) });

/** Chama a Edge Function via HTTP real e devolve status + corpo. */
async function invite(token: string | null, body: object) {
  const res = await fetch(`${URL}/functions/v1/invite-member`, {
    method: 'POST',
    headers: { apikey: ANON, ...(token ? { Authorization: `Bearer ${token}` } : {}), 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json().catch(() => null)) as any };
}

// ----- Mailpit (captura local de e-mails) -----
async function mailsTo(email: string): Promise<{ ID: string; Subject: string }[]> {
  const r = await fetch(`${MAIL}/api/v1/search?query=${encodeURIComponent(`to:${email}`)}`);
  return ((await r.json()) as any).messages ?? [];
}
async function waitMail(email: string, ms = 8000) {
  const end = Date.now() + ms;
  for (;;) {
    const m = await mailsTo(email);
    if (m.length) return m;
    if (Date.now() > end) throw new Error(`nenhum e-mail para ${email}`);
    await new Promise((r) => setTimeout(r, 200));
  }
}
async function mailLink(email: string): Promise<string> {
  const [m] = await waitMail(email);
  const msg = (await (await fetch(`${MAIL}/api/v1/message/${m!.ID}`)).json()) as { HTML: string; Text: string };
  const hit = /https?:\/\/[^\s"'<>]+\/auth\/v1\/verify[^\s"'<>]+/.exec(msg.HTML + ' ' + msg.Text);
  if (!hit) throw new Error('link de verificação não encontrado no e-mail');
  return hit[0].replace(/&amp;/g, '&');
}
/** Segue o link do e-mail SEM abrir o app e devolve os tokens do fragmento (como o navegador receberia). */
async function followLink(link: string) {
  const res = await fetch(link, { redirect: 'manual' });
  const location = res.headers.get('location') ?? '';
  const frag = new URLSearchParams(location.split('#')[1] ?? '');
  return { status: res.status, location, type: frag.get('type'), access: frag.get('access_token'), refresh: frag.get('refresh_token'), error: frag.get('error_code') };
}

// ----- Banco local (somente leitura/conferência e injeção de falhas) -----
let db: pg.Client;
const sql = async (q: string, p: unknown[] = []) => (await db.query(q, p)).rows;
const storeId = async (code: string) => (await sql('select id from public.stores where code = $1', [code]))[0]!.id as string;
const membershipOf = async (email: string, code: string) =>
  (await sql(
    'select m.id, m.active from public.memberships m join public.profiles p on p.id = m.person_id join public.stores s on s.id = m.store_id where p.email = $1 and s.code = $2',
    [email, code],
  ))[0] as { id: string; active: boolean } | undefined;

beforeAll(async () => {
  if (!ENABLED) return;
  db = new pg.Client({ connectionString: DB_URL });
  await db.connect();
  await sql('delete from public.invite_attempts'); // começa com cotas zeradas (banco local)
});
afterAll(async () => {
  if (!ENABLED) return;
  // Remove as contas criadas pelos testes (banco LOCAL; a auditoria é preservada por não ter FKs).
  await sql(`delete from public.memberships where person_id in (select id from public.profiles where email like '%@${DOMAIN}')`);
  const ids = (await sql(`select id from public.profiles where email like '%@${DOMAIN}'`)).map((r) => r.id);
  await sql(`delete from public.profiles where email like '%@${DOMAIN}'`);
  if (ids.length) await sql('delete from auth.users where id = any($1::uuid[])', [ids]);
  await db.end();
});

describe.runIf(ENABLED)('pilha Supabase local · infraestrutura e configuração', () => {
  it('Edge Function realmente inicia (resposta do nosso handler, não 503 do runtime)', async () => {
    const r = await invite(null, {});
    expect(r.status).toBe(401);
    expect(r.body).toMatchObject({ ok: false, code: 'unauthorized' });
  });

  it('cadastro público desligado: signup recusado e nenhuma conta criada', async () => {
    const before = (await sql('select count(*)::int n from auth.users'))[0]!.n;
    const { error } = await fresh().auth.signUp({ email: newEmail('intruso'), password: 'IntrusoSenha2026x' });
    expect(error?.code).toBe('signup_disabled');
    expect((await sql('select count(*)::int n from auth.users'))[0]!.n).toBe(before);
  });

  it('política de senha do Auth: curta ou sem maiúscula é recusada (validado no servidor)', async () => {
    const c = await login('lucas');
    expect((await c.auth.updateUser({ password: 'curta1A' })).error?.code).toBe('weak_password');
    expect((await c.auth.updateUser({ password: 'tudominusculo123' })).error?.code).toBe('weak_password');
  });

  it('anônimo não lê tabelas nem executa funções; status HTTP real', async () => {
    for (const t of ['stores', 'profiles', 'memberships', 'audit_log', 'invite_attempts']) {
      expect([401, 403]).toContain((await rest(null, `${t}?select=*`)).status);
    }
    expect([401, 403]).toContain((await rpc(ANON, 'list_all_people')).status);
    expect([401, 403]).toContain((await rpc(ANON, 'activate_profile', { p_id: '00000000-0000-4000-8000-000000000000', p_name: 'x', p_invited_by: null })).status);
  });

  it('o schema private não é exposto pela API', async () => {
    const t = await tokenOf(await login('bruno'));
    expect((await rest(t, 'rpc/is_general_admin', { method: 'POST', body: '{}' })).status).toBe(404);
    const r = await fetch(`${URL}/rest/v1/rpc/bootstrap_first_general_admin`, { method: 'POST', headers: { apikey: ANON, Authorization: `Bearer ${t}`, 'Content-Type': 'application/json', 'Content-Profile': 'private' }, body: '{"p_email":"x@y.zz"}' });
    expect([403, 404, 406]).toContain(r.status);
  });
});

describe.runIf(ENABLED)('autenticação real · login, logout, recuperação, definição de senha', () => {
  it('login, senha errada e logout revogando a sessão', async () => {
    const wrong = await fresh().auth.signInWithPassword({ email: 'bruno@dev.example', password: 'errada-errada' });
    expect(wrong.error?.code).toBe('invalid_credentials');
    const unknown = await fresh().auth.signInWithPassword({ email: 'naoexiste@dev.example', password: 'errada-errada' });
    expect(unknown.error?.code).toBe('invalid_credentials'); // mesma resposta: não revela contas
    expect(unknown.error?.message).toBe(wrong.error?.message);

    const c = await login('bruno');
    const refresh = (await c.auth.getSession()).data.session!.refresh_token;
    expect((await c.auth.signOut()).error).toBeNull();
    const res = await fetch(`${URL}/auth/v1/token?grant_type=refresh_token`, { method: 'POST', headers: { apikey: ANON, 'Content-Type': 'application/json' }, body: JSON.stringify({ refresh_token: refresh }) });
    expect(res.status).toBe(400); // refresh token revogado pelo logout
  });

  it('recuperação de senha: link por e-mail (Mailpit) → nova senha → login; e-mail desconhecido não vaza nada', async () => {
    const email = newEmail('rec');
    const created = await fresh(SERVICE).auth.admin.createUser({ email, password: 'SenhaAntiga2026x', email_confirm: true, user_metadata: { full_name: 'Pessoa Recuperacao' } });
    expect(created.error).toBeNull();
    const c = fresh();
    expect((await c.auth.resetPasswordForEmail(email, { redirectTo: APP })).error).toBeNull();
    const link = await mailLink(email);
    const step = await followLink(link);
    expect(step).toMatchObject({ status: 303, type: 'recovery' });
    expect(step.location.startsWith(APP)).toBe(true); // volta para o app
    await c.auth.setSession({ access_token: step.access!, refresh_token: step.refresh! });
    expect((await c.auth.updateUser({ password: 'SenhaNova2026ok' })).error).toBeNull();
    await c.auth.signOut();
    expect((await fresh().auth.signInWithPassword({ email, password: 'SenhaAntiga2026x' })).error?.code).toBe('invalid_credentials');
    expect((await fresh().auth.signInWithPassword({ email, password: 'SenhaNova2026ok' })).error).toBeNull();
    // O link é de uso único
    expect((await followLink(link)).error).toBeTruthy();
    // E-mail inexistente: mesma resposta, nenhuma mensagem enviada
    const ghost = newEmail('fantasma');
    expect((await fresh().auth.resetPasswordForEmail(ghost, { redirectTo: APP })).error).toBeNull();
    await new Promise((r) => setTimeout(r, 800));
    expect(await mailsTo(ghost)).toHaveLength(0);
    // Limpeza desta conta de teste (criada pela API de administração)
    await sql('delete from public.profiles where email = $1', [email]);
    await sql('delete from auth.users where email = $1', [email]);
  });

  it('conta criada pela API de administração (como no painel) nasce INATIVA e sem acesso até o bootstrap/convite', async () => {
    const email = newEmail('pendente');
    const { data, error } = await fresh(SERVICE).auth.admin.createUser({ email, password: 'SenhaPendente2026x', email_confirm: true });
    expect(error).toBeNull();
    const [p] = await sql('select active, is_general_admin, activated_at from public.profiles where id = $1', [data.user!.id]);
    expect(p).toMatchObject({ active: false, is_general_admin: false, activated_at: null });
    const c = await login(email, 'SenhaPendente2026x'); // consegue autenticar...
    const t = await tokenOf(c);
    expect((await rest(t, 'profiles?select=*')).body).toEqual([]); // ...mas não enxerga nada
    expect((await rest(t, 'stores?select=*')).body).toEqual([]);
    expect((await rpc(t, 'list_all_people')).status).toBe(401); // PT401: conta inativa
    await sql('delete from public.profiles where email = $1', [email]);
    await sql('delete from auth.users where email = $1', [email]);
  });
});

describe.runIf(ENABLED)('convites · conta nova e conta existente', () => {
  const email = newEmail('novo');
  it('responsável convida pessoa NOVA: conta ativada, só o vínculo da loja, e-mail no Mailpit', async () => {
    const alfa = await storeId('A01');
    const bruno = await tokenOf(await login('bruno'));
    const r = await invite(bruno, { storeId: alfa, email, name: 'Pessoa Nova', jobTitle: 'Caixa', role: 'funcionario', permissions: CALENDAR });
    expect(r).toEqual({ status: 200, body: { ok: true } });
    const [p] = await sql('select active, activated_at, full_name from public.profiles where email = $1', [email]);
    expect(p).toMatchObject({ active: true, full_name: 'Pessoa Nova' });
    expect((await membershipOf(email, 'A01'))?.active).toBe(true);
    expect(await membershipOf(email, 'B02')).toBeUndefined();
    expect((await mailsTo(email)).length).toBe(1);
  });

  it('o link do convite leva à definição de senha; depois a pessoa entra e vê só a loja do vínculo', async () => {
    const step = await followLink(await mailLink(email));
    expect(step).toMatchObject({ status: 303, type: 'invite' });
    const c = fresh();
    await c.auth.setSession({ access_token: step.access!, refresh_token: step.refresh! });
    expect((await c.auth.updateUser({ password: 'SenhaConvite2026ok' })).error).toBeNull();
    await c.auth.signOut();
    const me = await login(email, 'SenhaConvite2026ok');
    const { data: stores } = await me.from('stores').select('code');
    expect(stores).toEqual([{ code: 'A01' }]);
    const { data: self } = await me.from('profiles').select('email');
    expect(self).toEqual([{ email }]);
  });

  it('responsável de OUTRA loja vincula a MESMA conta: identidade reaproveitada, sem novo e-mail, resposta idêntica', async () => {
    const beta = await storeId('B02');
    const carla = await tokenOf(await login('carla'));
    const before = (await mailsTo(email)).length;
    const r = await invite(carla, { storeId: beta, email, name: 'Nome Que Deve Ser Ignorado', jobTitle: 'Apoio', role: 'funcionario', permissions: { overview: ['view'] } });
    expect(r).toEqual({ status: 200, body: { ok: true } }); // idêntica à resposta de conta nova
    expect((await sql('select count(*)::int n from public.profiles where email = $1', [email]))[0]!.n).toBe(1);
    expect((await sql('select full_name from public.profiles where email = $1', [email]))[0]!.full_name).toBe('Pessoa Nova'); // conta intacta
    expect((await membershipOf(email, 'A01'))?.active).toBe(true); // vínculo da Alfa preservado
    expect((await membershipOf(email, 'B02'))?.active).toBe(true);
    expect((await mailsTo(email)).length).toBe(before); // nenhum e-mail novo
    const me = await login(email, 'SenhaConvite2026ok');
    expect(((await me.from('stores').select('code')).data ?? []).map((s) => s.code).sort()).toEqual(['A01', 'B02']);
  });

  it('repetir o convite não duplica nada e informa o conflito da própria loja', async () => {
    const alfa = await storeId('A01');
    const bruno = await tokenOf(await login('bruno'));
    const r = await invite(bruno, { storeId: alfa, email, name: 'Pessoa Nova', jobTitle: 'Caixa', role: 'funcionario', permissions: CALENDAR });
    expect(r.status).toBe(409);
    expect(r.body).toMatchObject({ code: 'conflict', fieldErrors: { email: expect.stringMatching(/já está vinculada/) } });
    expect((await sql('select count(*)::int n from public.memberships m join public.profiles p on p.id=m.person_id where p.email=$1', [email]))[0]!.n).toBe(2);
  });
});

describe.runIf(ENABLED)('convite sem autorização e escalada de privilégios', () => {
  it('funcionário, responsável de outra loja, anônimo e token inválido: nada é criado nem enviado', async () => {
    const alfa = await storeId('A01');
    const e = newEmail('negado');
    const body = { storeId: alfa, email: e, name: 'Pessoa Negada', jobTitle: '', role: 'funcionario', permissions: CALENDAR };
    const accounts = (await sql('select count(*)::int n from auth.users'))[0]!.n;
    const attempts = (await sql('select count(*)::int n from public.invite_attempts'))[0]!.n;

    expect(await invite(await tokenOf(await login('julia')), body)).toMatchObject({ status: 403, body: { code: 'forbidden' } });
    expect(await invite(await tokenOf(await login('carla')), body)).toMatchObject({ status: 403, body: { code: 'forbidden' } }); // responsável da Beta, loja Alfa
    expect(await invite(null, body)).toMatchObject({ status: 401 });
    expect((await invite('token.invalido.xyz', body)).status).toBe(401);
    expect(await invite(await tokenOf(await login('bruno')), { ...body, role: 'responsavel' })).toMatchObject({ status: 403, body: { code: 'forbidden', message: expect.stringMatching(/administrador geral/) } });

    expect((await sql('select count(*)::int n from auth.users'))[0]!.n).toBe(accounts); // nenhuma conta criada
    expect((await sql('select count(*)::int n from public.invite_attempts'))[0]!.n).toBe(attempts); // nem vaga consumida
    expect(await mailsTo(e)).toHaveLength(0); // nenhum e-mail
  });

  it('ninguém concede permissões superiores às próprias (pela função, pela RPC e por edição)', async () => {
    const alfa = await storeId('A01');
    const ana = await login('ana');
    const helenaMembership = (await membershipOf('helena@dev.example', 'A01'))!.id;
    // O administrador restringe Helena: sem Financeiro e sem "excluir" em Calendário.
    const restricted = { overview: ['view'], team: ['view', 'create', 'edit', 'delete', 'export'], calendar: ['view', 'create', 'edit'] };
    expect((await ana.rpc('update_membership', { p_membership_id: helenaMembership, p_job_title: 'Subgerente', p_role: 'responsavel', p_permissions: restricted })).error).toBeNull();
    try {
      const helena = await tokenOf(await login('helena'));
      const e = newEmail('alem');
      const viaFn = await invite(helena, { storeId: alfa, email: e, name: 'Pessoa Alem', jobTitle: '', role: 'funcionario', permissions: { overview: ['view'], finance: ['view'] } });
      expect(viaFn).toMatchObject({ status: 403, body: { code: 'forbidden', message: expect.stringMatching(/não possui/) } });
      expect(await mailsTo(e)).toHaveLength(0);

      const igorAlfa = (await membershipOf('igor@dev.example', 'A01'))!.id;
      const edit = await rpc(helena, 'update_membership', { p_membership_id: igorAlfa, p_job_title: '', p_role: 'funcionario', p_permissions: { overview: ['view'], team: ['view'], calendar: ['view', 'create', 'edit', 'delete'] } });
      expect(edit.status).toBe(403);
      expect(edit.body.code).toBe('PT403');
      // outro responsável não altera responsável, nem concede administrador
      const bruno = await tokenOf(await login('bruno'));
      expect((await rpc(bruno, 'update_membership', { p_membership_id: helenaMembership, p_job_title: '', p_role: 'responsavel', p_permissions: restricted })).status).toBe(403);
      const me = (await sql("select id from public.profiles where email = 'bruno@dev.example'"))[0]!.id;
      expect((await rpc(bruno, 'set_general_admin', { p_person_id: me, p_value: true })).status).toBe(403);
      // escrita direta pela API REST também é negada
      const direct = await rest(bruno, `memberships?id=eq.${igorAlfa}`, { method: 'PATCH', body: JSON.stringify({ role: 'responsavel' }) });
      expect([401, 403]).toContain(direct.status);
      expect((await sql('select role from public.memberships where id = $1', [igorAlfa]))[0]!.role).toBe('funcionario');
    } finally {
      await ana.rpc('update_membership', { p_membership_id: helenaMembership, p_job_title: 'Subgerente', p_role: 'responsavel', p_permissions: { overview: ['view'], finance: ['view', 'create', 'edit', 'delete', 'export'], team: ['view', 'create', 'edit', 'delete', 'export'], calendar: ['view', 'create', 'edit', 'delete', 'export'], activity: ['view', 'export'], settings: ['view'] } });
    }
  });
});

describe.runIf(ENABLED)('isolamento por loja · chamada direta à API', () => {
  it('funcionário da Beta tenta ler e agir na Alfa pelas rotas REST/RPC', async () => {
    const alfa = await storeId('A01');
    const lucas = await tokenOf(await login('lucas'));
    expect((await rest(lucas, 'stores?select=code')).body).toEqual([{ code: 'B02' }]);
    expect((await rest(lucas, `memberships?select=id&store_id=eq.${alfa}`)).body).toEqual([]);
    expect((await rest(lucas, `audit_log?select=id&store_id=eq.${alfa}`)).body).toEqual([]);
    expect(((await rest(lucas, 'profiles?select=email')).body as { email: string }[]).map((p) => p.email)).toEqual(['lucas@dev.example']);
    for (const fn of ['list_store_members', 'store_summary']) {
      const r = await rpc(lucas, fn, { p_store_id: alfa });
      expect(r.status).toBe(403);
      expect(r.body.code).toBe('PT403');
    }
    expect((await rpc(lucas, 'list_all_people')).status).toBe(403);
    expect((await rpc(lucas, 'consolidated_summary')).status).toBe(403);
    const poke = await rest(lucas, `memberships?store_id=eq.${alfa}`, { method: 'DELETE' });
    expect([401, 403]).toContain(poke.status);
    expect((await sql('select count(*)::int n from public.memberships where store_id = $1', [alfa]))[0]!.n).toBeGreaterThan(0);
  });
});

describe.runIf(ENABLED)('desativação de vínculo com token já emitido', () => {
  it('o mesmo JWT perde o acesso da loja na hora; outros vínculos e o histórico permanecem', async () => {
    const alfa = await storeId('A01');
    const igor = await login('igor');
    const token = await tokenOf(igor);
    expect(((await rest(token, 'stores?select=code')).body as { code: string }[]).map((s) => s.code).sort()).toEqual(['A01', 'B02']);
    expect((await rpc(token, 'store_summary', { p_store_id: alfa })).status).toBe(200);

    const bruno = await login('bruno');
    const igorAlfa = (await membershipOf('igor@dev.example', 'A01'))!.id;
    expect((await bruno.rpc('set_membership_active', { p_membership_id: igorAlfa, p_active: false })).error).toBeNull();
    try {
      // MESMO token, sem novo login
      expect(((await rest(token, 'stores?select=code')).body as { code: string }[]).map((s) => s.code)).toEqual(['B02']);
      const denied = await rpc(token, 'store_summary', { p_store_id: alfa });
      expect(denied.status).toBe(403);
      expect((await rpc(token, 'list_store_members', { p_store_id: alfa })).status).toBe(403);
      expect((await rest(token, `audit_log?select=id&store_id=eq.${alfa}`)).body).toEqual([]);
      expect((await rpc(token, 'store_summary', { p_store_id: await storeId('B02') })).status).toBe(200); // vínculo da Beta intacto
      // Vínculo e permissões preservados para reativação; histórico registra a desativação
      const [m] = await sql('select active, deactivated_at, permissions from public.memberships where id = $1', [igorAlfa]);
      expect(m.active).toBe(false);
      expect(m.deactivated_at).not.toBeNull();
      expect(m.permissions.calendar).toContain('edit');
      const log = await sql("select actor_name, summary from public.audit_log where action = 'vinculo_desativado' and target_person_id = (select id from public.profiles where email = 'igor@dev.example') order by seq desc limit 1");
      expect(log[0]).toMatchObject({ actor_name: 'Bruno Almeida', summary: 'Vínculo de Igor Lima com a Loja Alfa desativado.' });
    } finally {
      await bruno.rpc('set_membership_active', { p_membership_id: igorAlfa, p_active: true });
    }
    expect((await rpc(token, 'store_summary', { p_store_id: alfa })).status).toBe(200); // reativado: acesso volta
  });

  it('desativar a CONTA derruba o acesso a todas as lojas com o token já emitido', async () => {
    const julia = await login('julia');
    const token = await tokenOf(julia);
    expect(((await rest(token, 'stores?select=code')).body as unknown[]).length).toBe(1);
    const ana = await login('ana');
    const id = (await sql("select id from public.profiles where email = 'julia@dev.example'"))[0]!.id;
    expect((await ana.rpc('set_account_active', { p_person_id: id, p_active: false })).error).toBeNull();
    try {
      expect((await rest(token, 'stores?select=code')).body).toEqual([]);
      expect((await rest(token, 'profiles?select=id')).body).toEqual([]);
      expect((await rpc(token, 'store_summary', { p_store_id: await storeId('A01') })).status).toBe(401);
    } finally {
      await ana.rpc('set_account_active', { p_person_id: id, p_active: true });
    }
  });
});

describe.runIf(ENABLED)('último administrador geral', () => {
  it('não pode ser removido nem desativado (HTTP 409)', async () => {
    const ana = await tokenOf(await login('ana'));
    const me = (await sql("select id from public.profiles where email = 'ana@dev.example'"))[0]!.id;
    const r1 = await rpc(ana, 'set_general_admin', { p_person_id: me, p_value: false });
    const r2 = await rpc(ana, 'set_account_active', { p_person_id: me, p_active: false });
    expect(r1).toMatchObject({ status: 409, body: { code: 'PT409' } });
    expect(r2).toMatchObject({ status: 409, body: { code: 'PT409' } });
  });

  it('dois administradores removendo um ao outro AO MESMO TEMPO: exatamente um sucesso, nunca zero administradores', async () => {
    const anaC = await login('ana');
    const diegoId = (await sql("select id from public.profiles where email = 'diego@dev.example'"))[0]!.id;
    const anaId = (await sql("select id from public.profiles where email = 'ana@dev.example'"))[0]!.id;
    expect((await anaC.rpc('set_general_admin', { p_person_id: diegoId, p_value: true })).error).toBeNull();
    const [ta, td] = [await tokenOf(anaC), await tokenOf(await login('diego'))];
    try {
      const [a, d] = await Promise.all([
        rpc(ta, 'set_general_admin', { p_person_id: diegoId, p_value: false }),
        rpc(td, 'set_general_admin', { p_person_id: anaId, p_value: false }),
      ]);
      expect([a.status, d.status].filter((s) => s >= 200 && s < 300)).toHaveLength(1);
      // A perdedora recebe 409 (era a última administradora naquele instante) ou 403 (a outra remoção confirmou
      // primeiro e ela já não é administradora). Em ambos os casos, nunca zero administradores.
      expect([403, 409]).toContain([a.status, d.status].find((x) => x < 200 || x >= 300));
      expect((await sql('select count(*)::int n from public.profiles where is_general_admin and active'))[0]!.n).toBe(1);
    } finally {
      // Restaura: quem sobrou promove o outro e depois Diego volta a ser só responsável.
      const survivor = (await sql('select email from public.profiles where is_general_admin and active'))[0]!.email as string;
      const s = await login(survivor.split('@')[0]!);
      await s.rpc('set_general_admin', { p_person_id: anaId, p_value: true });
      await s.rpc('set_general_admin', { p_person_id: diegoId, p_value: false });
      if (survivor !== 'ana@dev.example') await (await login('ana')).rpc('set_general_admin', { p_person_id: diegoId, p_value: false });
    }
    expect((await sql("select is_general_admin from public.profiles where email = 'ana@dev.example'"))[0]!.is_general_admin).toBe(true);
    expect((await sql('select count(*)::int n from public.profiles where is_general_admin and active'))[0]!.n).toBe(1);
  });
});

describe.runIf(ENABLED)('auditoria', () => {
  it('registra ator, loja e alteração; leitura filtrada; ninguém edita ou apaga', async () => {
    const alfa = await storeId('A01');
    const ana = await login('ana');
    const { data: all } = await ana.from('audit_log').select('action, actor_name, store_name, summary').order('seq', { ascending: false }).limit(200);
    expect(all!.length).toBeGreaterThan(0);
    expect(all!.some((r) => r.action === 'vinculo_criado' && r.actor_name === 'Bruno Almeida' && r.store_name === 'Loja Alfa')).toBe(true);
    expect(all!.some((r) => r.action === 'permissoes_alteradas' && r.actor_name === 'Ana Ribeiro')).toBe(true);
    expect(all!.some((r) => r.action === 'conta_criada' && r.actor_name === 'Bruno Almeida')).toBe(true); // convite: ator registrado pela Edge Function

    const bruno = await login('bruno');
    const { data: br } = await bruno.from('audit_log').select('store_id');
    expect(br!.length).toBeGreaterThan(0);
    expect(br!.every((r) => r.store_id === alfa)).toBe(true); // só a própria loja
    expect((await login('lucas').then((c) => c.from('audit_log').select('id'))).data).toEqual([]); // sem permissão no histórico

    const t = await tokenOf(ana);
    expect([401, 403]).toContain((await rest(t, 'audit_log?action=eq.vinculo_criado', { method: 'PATCH', body: JSON.stringify({ summary: 'x' }) })).status);
    expect([401, 403]).toContain((await rest(t, 'audit_log?action=eq.vinculo_criado', { method: 'DELETE' })).status);
    // Nem a chave de serviço (nem o dono do banco) consegue: append-only por gatilho
    const svc = fresh(SERVICE);
    const upd = await svc.from('audit_log').update({ summary: 'adulterado' }).eq('action', 'vinculo_criado');
    expect(upd.error?.code).toBe('PT403');
    const del = await svc.from('audit_log').delete().eq('action', 'vinculo_criado');
    expect(del.error?.code).toBe('PT403');
    await expect(sql("update public.audit_log set summary = 'x'")).rejects.toMatchObject({ code: 'PT403' });
  });
});

describe.runIf(ENABLED)('falhas parciais e repetição de convite (injeção de falhas no banco local)', () => {
  const dropTriggers = () =>
    sql(`drop trigger if exists zz_fail_membership on public.memberships; drop trigger if exists zz_fail_activation on public.profiles;
         drop function if exists public.zz_fail();`);

  it('conta criada no Auth, mas o vínculo falha: sem duplicação; repetir o convite conclui sem novo e-mail', async () => {
    const alfa = await storeId('A01');
    const bruno = await tokenOf(await login('bruno'));
    const e = newEmail('parcial');
    const body = { storeId: alfa, email: e, name: 'Pessoa Parcial', jobTitle: '', role: 'funcionario', permissions: CALENDAR };
    await sql(`create function public.zz_fail() returns trigger language plpgsql as $$ begin raise exception 'falha injetada'; end $$;
               create trigger zz_fail_membership before insert on public.memberships for each row execute function public.zz_fail();`);
    try {
      const first = await invite(bruno, body);
      expect([500, 502]).toContain(first.status); // falha genérica, sem detalhes internos
      expect(JSON.stringify(first.body)).not.toMatch(/falha injetada|zz_fail/);
    } finally {
      await dropTriggers();
    }
    // Estado após a falha: conta existe e está ativa, mas SEM vínculo (inofensiva), com 1 e-mail enviado
    const [p] = await sql('select active, activated_at from public.profiles where email = $1', [e]);
    expect(p).toMatchObject({ active: true });
    expect(await membershipOf(e, 'A01')).toBeUndefined();
    expect((await mailsTo(e)).length).toBe(1);
    // Repetição: reaproveita a conta, cria o vínculo, não duplica nada, não reenvia e-mail
    const retry = await invite(bruno, body);
    expect(retry).toEqual({ status: 200, body: { ok: true } });
    expect((await sql('select count(*)::int n from public.profiles where email = $1', [e]))[0]!.n).toBe(1);
    expect((await sql('select count(*)::int n from public.memberships m join public.profiles p on p.id=m.person_id where p.email=$1', [e]))[0]!.n).toBe(1);
    expect((await mailsTo(e)).length).toBe(1);
  });

  it('conta criada no Auth, mas a ATIVAÇÃO falha: a repetição ativa a mesma conta e conclui', async () => {
    const alfa = await storeId('A01');
    const bruno = await tokenOf(await login('bruno'));
    const e = newEmail('ativacao');
    const body = { storeId: alfa, email: e, name: 'Pessoa Ativacao', jobTitle: '', role: 'funcionario', permissions: CALENDAR };
    await sql(`create function public.zz_fail() returns trigger language plpgsql as $$ begin
                 if old.activated_at is null and new.activated_at is not null then raise exception 'falha injetada'; end if; return new; end $$;
               create trigger zz_fail_activation before update on public.profiles for each row execute function public.zz_fail();`);
    try {
      expect([500, 502]).toContain((await invite(bruno, body)).status);
    } finally {
      await dropTriggers();
    }
    const [p] = await sql('select active, activated_at from public.profiles where email = $1', [e]);
    expect(p).toMatchObject({ active: false, activated_at: null }); // continua inativa: sem acesso a nada
    expect(await membershipOf(e, 'A01')).toBeUndefined();
    expect(await invite(bruno, body)).toEqual({ status: 200, body: { ok: true } });
    const [after] = await sql('select active, activated_at from public.profiles where email = $1', [e]);
    expect(after.active).toBe(true);
    expect((await sql('select count(*)::int n from public.profiles where email = $1', [e]))[0]!.n).toBe(1);
    expect((await mailsTo(e)).length).toBe(1);
  });

  it('dois responsáveis convidando o MESMO e-mail novo ao mesmo tempo: uma conta, um vínculo por loja', async () => {
    const [alfa, gama] = [await storeId('A01'), await storeId('G03')];
    const bruno = await tokenOf(await login('bruno'));
    const diego = await tokenOf(await login('diego'));
    const e = newEmail('corrida');
    const mk = (storeId: string) => ({ storeId, email: e, name: 'Pessoa Corrida', jobTitle: '', role: 'funcionario', permissions: CALENDAR });
    const [a, b] = await Promise.all([invite(bruno, mk(alfa)), invite(diego, mk(gama))]);
    // Uma delas pode perder a corrida na criação da conta (502); repetir resolve.
    for (const [res, tk, st] of [[a, bruno, alfa], [b, diego, gama]] as const) if (res.status !== 200) expect(await invite(tk, mk(st))).toEqual({ status: 200, body: { ok: true } });
    expect((await sql('select count(*)::int n from auth.users where email = $1', [e]))[0]!.n).toBe(1);
    expect((await sql('select count(*)::int n from public.profiles where email = $1', [e]))[0]!.n).toBe(1);
    expect((await membershipOf(e, 'A01'))?.active).toBe(true);
    expect((await membershipOf(e, 'G03'))?.active).toBe(true);
  });
});

describe.runIf(ENABLED)('limite de convites no servidor sob chamadas simultâneas', () => {
  it('40 convites simultâneos da mesma pessoa: no máximo 30 contas/e-mails; o resto recebe 429', async () => {
    await sql('delete from public.invite_attempts');
    const alfa = await storeId('A01');
    const helena = await tokenOf(await login('helena'));
    const emails = Array.from({ length: 40 }, (_, i) => newEmail(`lote${i}`));
    const results = await Promise.all(
      emails.map((email) => invite(helena, { storeId: alfa, email, name: 'Pessoa Em Lote', jobTitle: '', role: 'funcionario', permissions: CALENDAR })),
    );
    const ok = results.filter((r) => r.status === 200).length;
    const limited = results.filter((r) => r.status === 429).length;
    const accounts = (await sql('select count(*)::int n from public.profiles where email = any($1)', [emails]))[0]!.n;
    const sent = (await Promise.all(emails.map((e) => mailsTo(e)))).filter((m) => m.length > 0).length;
    const attempts = (await sql('select count(*)::int n from public.invite_attempts where actor_id = (select id from public.profiles where email = $1)', ['helena@dev.example']))[0]!.n;
    expect(ok + limited).toBe(40); // sem outros erros
    expect(limited).toBeGreaterThanOrEqual(10);
    expect(accounts).toBeLessThanOrEqual(30);
    expect(sent).toBeLessThanOrEqual(30); // o que se quer limitar: e-mails enviados a terceiros
    expect(attempts).toBe(30);
    // Quem não é limitado: outra pessoa continua convidando
    const bruno = await tokenOf(await login('bruno'));
    expect((await invite(bruno, { storeId: alfa, email: newEmail('livre'), name: 'Pessoa Livre', jobTitle: '', role: 'funcionario', permissions: CALENDAR })).status).toBe(200);
  }, 120_000);
});

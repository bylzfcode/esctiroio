// Interface conectada à pilha REAL do Supabase local (GoTrue + PostgREST + Edge Function + Mailpit).
// Sem servidor falso. Os e-mails ficam no Mailpit local: nenhuma mensagem sai para pessoas reais.
//
//   (pilha local já iniciada e com `npm run dev:seed`; veja tests/live/stack.test.ts)
//   VITE_SUPABASE_URL=$API_URL VITE_SUPABASE_ANON_KEY=$ANON_KEY npx vite --port 5173 --strictPort &
//   LIVE_SUPABASE_URL=$API_URL LIVE_SUPABASE_ANON_KEY=$ANON_KEY LIVE_SERVICE_ROLE_KEY=$SERVICE_ROLE_KEY \
//   LIVE_DB_URL=$DB_URL LIVE_MAIL_URL=$MAILPIT_URL node e2e/stack-ui.cjs     # requer o pacote "playwright"
//
// O endereço do app precisa ser http://127.0.0.1:5173 (consta nas URLs de redirecionamento do config.toml).
// Variável opcional E2E_SHOTS: pasta para capturas de tela.
const { chromium } = require('playwright');
const pg = require('pg');
const fs = require('fs');

const APP = 'http://127.0.0.1:5173';
const API = process.env.LIVE_SUPABASE_URL;
const ANON = process.env.LIVE_SUPABASE_ANON_KEY;
const SERVICE = process.env.LIVE_SERVICE_ROLE_KEY;
const DB = process.env.LIVE_DB_URL;
const MAIL = process.env.LIVE_MAIL_URL;
const SHOTS = process.env.E2E_SHOTS || null;
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
if (![API, ANON, SERVICE, DB, MAIL].every(Boolean)) {
  console.error('Defina LIVE_SUPABASE_URL, LIVE_SUPABASE_ANON_KEY, LIVE_SERVICE_ROLE_KEY, LIVE_DB_URL e LIVE_MAIL_URL.');
  process.exit(2);
}

const PASSWORD = 'DevLocal2026x';
const run = Date.now().toString(36);
const DOMAIN = 'conv.dev.example';
let pass = 0, fail = 0;
const ok = (c, m) => { c ? pass++ : fail++; console.log(c ? '  ok   ' : '  FALHA', m); };

// ---------- apoio ----------
const mailsTo = async (email) => ((await (await fetch(`${MAIL}/api/v1/search?query=${encodeURIComponent('to:' + email)}`)).json()).messages) || [];
async function mailLink(email, ms = 8000) {
  const end = Date.now() + ms;
  for (;;) {
    const [m] = await mailsTo(email);
    if (m) {
      const msg = await (await fetch(`${MAIL}/api/v1/message/${m.ID}`)).json();
      const hit = /https?:\/\/[^\s"'<>]+\/auth\/v1\/verify[^\s"'<>]+/.exec(msg.HTML + ' ' + msg.Text);
      return hit[0].replace(/&amp;/g, '&');
    }
    if (Date.now() > end) throw new Error('sem e-mail para ' + email);
    await new Promise((r) => setTimeout(r, 200));
  }
}
const apiToken = async (user, password = PASSWORD) =>
  (await (await fetch(`${API}/auth/v1/token?grant_type=password`, { method: 'POST', headers: { apikey: ANON, 'Content-Type': 'application/json' }, body: JSON.stringify({ email: `${user}@dev.example`, password }) })).json()).access_token;
const rpc = (token, fn, args) => fetch(`${API}/rest/v1/rpc/${fn}`, { method: 'POST', headers: { apikey: ANON, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(args) });

(async () => {
  const db = new pg.Client({ connectionString: DB });
  await db.connect();
  const sql = async (q, p = []) => (await db.query(q, p)).rows;
  const browser = await chromium.launch();
  const errors = [];
  const newPage = async (url = APP, vp = { width: 1280, height: 800 }) => {
    const ctx = await browser.newContext({ viewport: vp });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push('pageerror ' + e.message));
    page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|net::ERR/.test(m.text())) errors.push(m.text()); });
    await page.goto(url);
    return page;
  };
  const shot = async (page, name) => { if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png` }); };
  const nav = (page, name) => page.locator('nav[aria-label="Principal"]').getByRole('link', { name });
  const loginUi = async (page, email, password = PASSWORD) => {
    await page.getByLabel('E-mail').fill(email.includes('@') ? email : `${email}@dev.example`);
    await page.getByLabel('Senha').fill(password);
    await page.getByRole('button', { name: 'Entrar' }).click();
  };
  const logoutUi = async (page) => {
    await page.getByRole('button', { name: /Usuário conectado/ }).click();
    await page.getByRole('menuitem', { name: 'Sair' }).click();
    await page.getByRole('heading', { name: 'Entrar' }).waitFor();
  };

  console.log('1. Login e logout (GoTrue real)');
  let page = await newPage();
  await page.getByRole('heading', { name: 'Entrar' }).waitFor();
  ok(await page.getByText('Escolha um perfil').count() === 0 && await page.getByText('Demonstração com dados fictícios').count() === 0, 'sem seletor nem faixa de demonstração');
  await loginUi(page, 'bruno', 'senha-errada-1');
  await page.getByText('E-mail ou senha incorretos.').waitFor();
  ok(true, 'senha errada: mensagem neutra do servidor real');
  await page.getByLabel('E-mail').fill('naoexiste@dev.example');
  await page.getByRole('button', { name: 'Entrar' }).click();
  await page.waitForTimeout(500);
  ok(await page.getByText('E-mail ou senha incorretos.').count() === 1, 'e-mail inexistente: mesma mensagem (não revela contas)');
  await loginUi(page, 'bruno');
  await page.waitForSelector('main#conteudo');
  await page.getByText('Loja Alfa').first().waitFor();
  ok(true, 'login válido: entra na loja do vínculo');
  ok((await page.evaluate(() => Object.keys(localStorage))).every((k) => !k.startsWith('esctiroio.demo')), 'nenhuma chave da demonstração no armazenamento');
  await shot(page, '01-logado');
  await logoutUi(page);
  ok(await page.getByText(/sessão expirou/).count() === 0, 'logout manual: sem aviso de expiração');
  await page.reload();
  await page.getByRole('heading', { name: 'Entrar' }).waitFor();
  ok(true, 'após sair e recarregar continua no login (sessão revogada)');
  await page.context().close();

  console.log('2. Recuperação e definição de senha (link capturado no Mailpit)');
  page = await newPage();
  await page.getByRole('button', { name: 'Esqueci minha senha' }).click();
  await page.getByLabel('E-mail').fill('lucas@dev.example');
  await page.getByRole('button', { name: 'Enviar link' }).click();
  await page.getByRole('heading', { name: 'Verifique seu e-mail' }).waitFor();
  const ghost = `fantasma-${run}@${DOMAIN}`;
  await page.getByRole('button', { name: 'Voltar para entrar' }).click();
  await page.getByRole('button', { name: 'Esqueci minha senha' }).click();
  await page.getByLabel('E-mail').fill(ghost);
  await page.getByRole('button', { name: 'Enviar link' }).click();
  await page.getByRole('heading', { name: 'Verifique seu e-mail' }).waitFor();
  await page.waitForTimeout(800);
  ok((await mailsTo(ghost)).length === 0, 'e-mail desconhecido: mesma tela e nenhum e-mail enviado');
  const recLink = await mailLink('lucas@dev.example');
  await page.context().close();
  page = await newPage(recLink); // abre o link do e-mail
  await page.getByRole('heading', { name: 'Defina sua senha' }).waitFor();
  ok(!page.url().includes('access_token'), 'link de recuperação abre a definição de senha e o token sai do endereço');
  await page.getByLabel('Nova senha').fill('curta');
  await page.getByLabel('Repita a senha').fill('curta');
  await page.getByRole('button', { name: 'Salvar senha e entrar' }).click();
  await page.getByText('Use ao menos 10 caracteres.').waitFor();
  await page.getByLabel('Nova senha').fill('SenhaUi2026ok');
  await page.getByLabel('Repita a senha').fill('SenhaUi2026ok');
  await page.getByRole('button', { name: 'Salvar senha e entrar' }).click();
  await page.waitForSelector('main#conteudo');
  ok(true, 'senha definida: entra no app');
  await logoutUi(page);
  await loginUi(page, 'lucas', PASSWORD);
  await page.getByText('E-mail ou senha incorretos.').waitFor();
  await loginUi(page, 'lucas', 'SenhaUi2026ok');
  await page.waitForSelector('main#conteudo');
  ok(true, 'senha antiga recusada; nova senha funciona');
  await page.context().close();
  // restaura a senha fictícia de desenvolvimento
  const lucasId = (await sql("select id from public.profiles where email = 'lucas@dev.example'"))[0].id;
  await fetch(`${API}/auth/v1/admin/users/${lucasId}`, { method: 'PUT', headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ password: PASSWORD }) });

  console.log('3. Convite pela interface: pessoa nova e conta existente');
  const novo = `ui-${run}@${DOMAIN}`;
  page = await newPage();
  await loginUi(page, 'bruno');
  await page.waitForSelector('main#conteudo');
  await nav(page, 'Equipe e permissões').click();
  await page.locator('ul li', { hasText: 'Igor Lima' }).first().waitFor();
  await page.getByRole('button', { name: 'Novo funcionário' }).click();
  let dlg = page.getByRole('dialog');
  await dlg.getByLabel(/^E-mail/).fill(novo);
  await dlg.getByLabel(/^E-mail/).blur();
  await page.waitForTimeout(300);
  ok(await dlg.getByText(/Conta existente de/).count() === 0, 'o formulário não revela se a conta existe');
  await dlg.getByLabel(/^Nome completo/).fill('Pessoa Interface');
  await dlg.getByRole('checkbox', { name: 'Calendário: Visualizar' }).check();
  await dlg.getByRole('button', { name: 'Cadastrar' }).click();
  await page.getByText(/Se a pessoa ainda não tiver conta, ela receberá um convite/).first().waitFor();
  await page.locator('ul li', { hasText: 'Pessoa Interface' }).first().waitFor();
  ok(true, 'cadastro de pessoa nova: mensagem única e pessoa na lista');
  await shot(page, '03-convite-enviado');
  ok((await mailsTo(novo)).length === 1, 'um convite chegou ao Mailpit (e a mais nenhum destino real)');
  const inviteLink = await mailLink(novo);
  const invitee = await newPage(inviteLink);
  await invitee.getByRole('heading', { name: 'Defina sua senha' }).waitFor();
  await invitee.getByLabel('Nova senha').fill('SenhaConvite2026ok');
  await invitee.getByLabel('Repita a senha').fill('SenhaConvite2026ok');
  await invitee.getByRole('button', { name: 'Salvar senha e entrar' }).click();
  await invitee.waitForSelector('main#conteudo');
  await invitee.getByText('Loja Alfa').first().waitFor();
  const menu = await invitee.locator('nav[aria-label="Principal"] a').evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')));
  ok(menu.join('|') === 'Visão geral|Calendário', `convidada: aceita o convite, define a senha e vê só o permitido (${menu.join(', ')})`);
  await invitee.getByRole('button', { name: /Loja ativa/ }).click();
  ok((await invitee.getByRole('listbox').getByRole('option').count()) === 1, 'seletor mostra somente a loja do vínculo');
  await shot(invitee, '03-convidada-entrou');
  await invitee.context().close();
  // Conta existente: responsável de OUTRA loja vincula a mesma pessoa
  const before = (await mailsTo(novo)).length;
  const carla = await newPage();
  await loginUi(carla, 'carla');
  await carla.waitForSelector('main#conteudo');
  await nav(carla, 'Equipe e permissões').click();
  await carla.locator('ul li', { hasText: 'Lucas Rocha' }).first().waitFor();
  await carla.getByRole('button', { name: 'Novo funcionário' }).click();
  dlg = carla.getByRole('dialog');
  await dlg.getByLabel(/^E-mail/).fill(novo);
  await dlg.getByLabel(/^Nome completo/).fill('Outro Nome');
  await dlg.getByRole('button', { name: 'Cadastrar' }).click();
  await carla.getByText(/Se a pessoa ainda não tiver conta, ela receberá um convite/).first().waitFor();
  await carla.locator('ul li', { hasText: 'Pessoa Interface' }).first().waitFor();
  ok(true, 'conta existente: mesma mensagem, vínculo criado na outra loja');
  ok((await mailsTo(novo)).length === before, 'conta existente: nenhum e-mail novo');
  ok((await sql('select count(*)::int n from public.profiles where email = $1', [novo]))[0].n === 1, 'identidade reaproveitada: uma única conta');
  ok((await sql('select count(*)::int n from public.memberships m join public.profiles p on p.id = m.person_id where p.email = $1', [novo]))[0].n === 2, 'dois vínculos independentes (Alfa e Beta)');
  ok((await sql('select full_name from public.profiles where email = $1', [novo]))[0].full_name === 'Pessoa Interface', 'o nome da conta existente não foi sobrescrito');
  await carla.context().close();
  await page.context().close();

  console.log('4. Sem autorização e permissões superiores às próprias');
  const julia = await newPage();
  await loginUi(julia, 'julia');
  await julia.waitForSelector('main#conteudo');
  const jMenu = await julia.locator('nav[aria-label="Principal"] a').evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')));
  ok(!jMenu.includes('Equipe e permissões'), 'funcionária não tem Equipe no menu');
  await julia.goto(APP + '/equipe');
  await julia.waitForURL((u) => !u.pathname.includes('equipe'));
  ok(true, '/equipe por URL direta redireciona (a barreira real é o servidor, testada via API)');
  await julia.context().close();
  // Helena restrita pelo administrador: a matriz bloqueia o que ela não possui, e o servidor também
  const adminToken = await apiToken('ana');
  const hMem = (await sql("select m.id from public.memberships m join public.profiles p on p.id=m.person_id join public.stores s on s.id=m.store_id where p.email='helena@dev.example' and s.code='A01'"))[0].id;
  const FULL = { overview: ['view'], finance: ['view', 'create', 'edit', 'delete', 'export'], team: ['view', 'create', 'edit', 'delete', 'export'], calendar: ['view', 'create', 'edit', 'delete', 'export'], activity: ['view', 'export'], settings: ['view'] };
  await rpc(adminToken, 'update_membership', { p_membership_id: hMem, p_job_title: 'Subgerente', p_role: 'responsavel', p_permissions: { overview: ['view'], team: FULL.team, calendar: ['view', 'create', 'edit'] } });
  try {
    const helena = await newPage();
    await loginUi(helena, 'helena');
    await helena.waitForSelector('main#conteudo');
    await nav(helena, 'Equipe e permissões').click();
    await helena.locator('ul li', { hasText: 'Igor Lima' }).first().waitFor();
    await helena.getByRole('button', { name: 'Editar Igor Lima' }).click();
    dlg = helena.getByRole('dialog');
    ok(await dlg.getByRole('checkbox', { name: 'Financeiro: Visualizar' }).isDisabled(), 'responsável restrito: não consegue conceder "Financeiro" (campo bloqueado)');
    ok(await dlg.getByRole('checkbox', { name: 'Calendário: Excluir' }).isDisabled(), 'responsável restrito: não consegue conceder "Excluir" em Calendário');
    ok(await dlg.getByRole('checkbox', { name: 'Calendário: Editar' }).isEnabled(), 'o que ela possui continua editável');
    await shot(helena, '04-matriz-restrita');
    await helena.context().close();
  } finally {
    await rpc(adminToken, 'update_membership', { p_membership_id: hMem, p_job_title: 'Subgerente', p_role: 'responsavel', p_permissions: FULL });
  }

  console.log('5. Desativação de vínculo com sessão já aberta');
  const j2 = await newPage();
  await loginUi(j2, 'julia');
  await j2.waitForSelector('main#conteudo');
  await nav(j2, 'Histórico de atividades').click();
  await j2.getByRole('heading', { name: 'Histórico de atividades' }).waitFor();
  const brunoToken = await apiToken('bruno');
  const jMem = (await sql("select m.id from public.memberships m join public.profiles p on p.id=m.person_id where p.email='julia@dev.example'"))[0].id;
  ok((await rpc(brunoToken, 'set_membership_active', { p_membership_id: jMem, p_active: false })).ok, 'responsável desativa o vínculo pela API');
  try {
    await nav(j2, 'Visão geral').click(); // mesma sessão, mesmo token, sem novo login
    // O servidor recusa (403) com o MESMO token; a recusa dispara a revalidação e a interface converge.
    await j2.getByText('Sem acesso a nenhuma loja').waitFor(); // sem recarregar: a recusa dispara a revalidação da sessão
    ok(true, 'a interface converge sozinha: menu e permissões antigas somem ("Sem acesso a nenhuma loja")');
    await shot(j2, '05-vinculo-desativado');
    await j2.reload();
    await j2.getByText('Sem acesso a nenhuma loja').waitFor();
    ok(true, 'ao recarregar continua sem acesso (conta e histórico preservados)');
  } finally {
    await rpc(brunoToken, 'set_membership_active', { p_membership_id: jMem, p_active: true });
  }
  await j2.context().close();

  console.log('6. Sessão expirada (renovação do token falha de verdade)');
  const ex = await newPage();
  await loginUi(ex, 'bruno');
  await ex.waitForSelector('main#conteudo');
  const brunoId = (await sql("select id from public.profiles where email = 'bruno@dev.example'"))[0].id;
  await sql('delete from auth.sessions where user_id = $1', [brunoId]); // revoga no servidor
  await ex.evaluate(() => {
    const k = 'esctiroio.auth';
    const s = JSON.parse(localStorage.getItem(k));
    s.expires_at = 1; // access token "vencido": força a renovação, que o servidor agora recusa
    localStorage.setItem(k, JSON.stringify(s));
  });
  await ex.reload();
  await ex.getByRole('heading', { name: 'Entrar' }).waitFor();
  const expired = await ex.getByText('Sua sessão expirou. Entre novamente para continuar.').count();
  ok(expired === 1, 'sessão revogada/vencida: volta ao login COM o aviso de expiração');
  await shot(ex, '06-sessao-expirada');
  await ex.context().close();

  ok(errors.length === 0, 'sem erros no console do navegador' + (errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''));

  // limpeza das contas criadas pelos testes (banco LOCAL)
  await sql(`delete from public.memberships where person_id in (select id from public.profiles where email like '%@${DOMAIN}')`);
  const ids = (await sql(`select id from public.profiles where email like '%@${DOMAIN}'`)).map((r) => r.id);
  await sql(`delete from public.profiles where email like '%@${DOMAIN}'`);
  if (ids.length) await sql('delete from auth.users where id = any($1::uuid[])', [ids]);
  await db.end();
  console.log(`\nResultado: ${pass} ok, ${fail} falhas`);
  await browser.close();
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('ERRO NO ROTEIRO:', e.message); process.exit(2); });

// Financeiro na INTERFACE, conectada à pilha REAL do Supabase local (Auth, PostgREST e Storage reais). Sem servidor falso.
//   (pilha iniciada, `supabase db reset` e `npm run dev:seed` feitos; veja tests/live/stack.test.ts)
//   VITE_SUPABASE_URL=$API_URL VITE_SUPABASE_ANON_KEY=$ANON_KEY npm run build && npx vite preview --port 5173 --strictPort &
//   LIVE_SUPABASE_URL=... LIVE_SUPABASE_ANON_KEY=... LIVE_SERVICE_ROLE_KEY=... LIVE_DB_URL=... node e2e/finance-ui.cjs   # requer "playwright"
// Registros financeiros não são apagados: o script usa um rótulo único por execução. E2E_SHOTS: pasta para capturas.
const { chromium } = require('playwright');
const pg = require('pg');
const fs = require('fs');

const APP = 'http://127.0.0.1:5173';
const API = process.env.LIVE_SUPABASE_URL;
const ANON = process.env.LIVE_SUPABASE_ANON_KEY;
const DB = process.env.LIVE_DB_URL;
const SHOTS = process.env.E2E_SHOTS || null;
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
if (![API, ANON, DB].every(Boolean)) { console.error('Defina LIVE_SUPABASE_URL, LIVE_SUPABASE_ANON_KEY e LIVE_DB_URL.'); process.exit(2); }

const PASSWORD = 'DevLocal2026x';
const TAG = `UI${Date.now().toString(36)}`;
const FIN_FULL = ['view', 'create', 'edit', 'delete', 'export', 'settle', 'reverse', 'confirm_send'];
let pass = 0, fail = 0;
const ok = (c, m) => { c ? pass++ : fail++; console.log(c ? '  ok   ' : '  FALHA', m); };
const PDF = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF');

(async () => {
  const db = new pg.Client({ connectionString: DB });
  await db.connect();
  const sql = async (q, p = []) => (await db.query(q, p)).rows;
  const tokenOf = async (u) => (await (await fetch(`${API}/auth/v1/token?grant_type=password`, { method: 'POST', headers: { apikey: ANON, 'Content-Type': 'application/json' }, body: JSON.stringify({ email: `${u}@dev.example`, password: PASSWORD }) })).json()).access_token;
  const rpc = (t, fn, a) => fetch(`${API}/rest/v1/rpc/${fn}`, { method: 'POST', headers: { apikey: ANON, Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' }, body: JSON.stringify(a) });

  // permissões explícitas, concedidas pelo administrador (RPC com o JWT dele)
  const ana = await tokenOf('ana');
  const ALFA = (await sql("select id from public.stores where code='A01'"))[0].id;
  const original = [];
  const setFin = async (email, store, actions) => {
    const [m] = await sql('select m.id, m.role, m.job_title, m.permissions from public.memberships m join public.profiles p on p.id=m.person_id where p.email=$1 and m.store_id=$2', [email, store]);
    original.push(m);
    const permissions = { ...m.permissions, finance: actions };
    const r = await rpc(ana, 'update_membership', { p_membership_id: m.id, p_job_title: m.job_title, p_role: m.role, p_permissions: permissions });
    if (!r.ok) throw new Error('grant ' + email + ' ' + (await r.text()));
  };
  await setFin('bruno@dev.example', ALFA, FIN_FULL);
  await setFin('julia@dev.example', ALFA, ['view', 'create', 'settle']);
  await setFin('igor@dev.example', ALFA, ['view']);

  const browser = await chromium.launch();
  const errors = [];
  const newPage = async (vp = { width: 1280, height: 800 }) => {
    const ctx = await browser.newContext({ viewport: vp });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push('pageerror ' + e.message));
    page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|net::ERR|Erro simulado/.test(m.text())) errors.push(m.text()); });
    await page.goto(APP);
    return page;
  };
  const shot = async (p, n) => { if (SHOTS) await p.screenshot({ path: `${SHOTS}/${n}.png`, fullPage: true }); };
  const login = async (page, user) => {
    await page.getByLabel('E-mail').fill(`${user}@dev.example`);
    await page.getByLabel('Senha').fill(PASSWORD);
    await page.getByRole('button', { name: 'Entrar' }).click();
    await page.waitForSelector('main#conteudo');
  };
  const nav = (page, name) => page.locator('nav[aria-label="Principal"]').getByRole('link', { name });
  const dlgOf = (page) => page.getByRole('dialog');
  const toast = (page, re) => page.getByText(re).first().waitFor();
  const overflowing = (page) => page.evaluate(() => { const W = window.innerWidth; const bad = []; document.querySelectorAll('body *').forEach((e) => { const r = e.getBoundingClientRect(); if (r.right > W + 1 && r.width > 0) bad.push(`${e.tagName}.${String(e.className).slice(0, 50)} →${Math.round(r.right)}`); }); return { sw: document.documentElement.scrollWidth, W, bad: bad.slice(0, 5) }; });
  const count = async (q, p) => (await sql(q, p))[0].n;

  try {
    console.log('1. Bruno (responsável com financeiro completo): criar conta');
    let page = await newPage();
    await login(page, 'bruno');
    await nav(page, 'Financeiro').click();
    await page.getByRole('heading', { name: 'Financeiro' }).waitFor();
    ok(true, 'Financeiro aparece no menu e abre');
    await page.getByRole('button', { name: 'Nova conta' }).click();
    let dlg = dlgOf(page);
    const ontem = (await sql("select (private.today_sp() - 1)::text d"))[0].d;
    await dlg.getByLabel('Descrição').fill(`${TAG} Aluguel`);
    await dlg.getByLabel('Valor (R$)').fill('1.234,56');
    await dlg.getByLabel('Vencimento').fill(ontem);
    await dlg.getByLabel(/Fornecedor/).fill('Imobiliária Exemplo');
    await dlg.getByRole('button', { name: 'Criar conta' }).dblclick(); // clique duplo
    await page.getByRole('heading', { name: `${TAG} Aluguel` }).waitFor();
    await page.waitForTimeout(500);
    ok(await count('select count(*)::int n from public.finance_accounts where description = $1', [`${TAG} Aluguel`]) === 1, 'clique duplo em "Criar conta" cria uma única conta');
    ok(await page.getByText('R$ 1.234,56').first().isVisible(), 'valor exibido em BRL com centavos exatos');
    ok(await page.getByText('Em atraso').first().isVisible(), 'vencimento passado com saldo: "Em atraso" (calculado no servidor)');
    ok((await sql('select amount_cents::text a from public.finance_accounts where description = $1', [`${TAG} Aluguel`]))[0].a === '123456', 'valor gravado em centavos inteiros (123456)');
    const accountUrl = page.url();
    await shot(page, 'f1-conta-criada');

    console.log('2. Validações de pagamento e liquidação parcial com comprovante');
    await page.getByRole('button', { name: 'Confirmar pagamento' }).first().click();
    dlg = dlgOf(page);
    await dlg.getByLabel('Valor (R$)').fill('0,00');
    await dlg.getByRole('button', { name: 'Confirmar pagamento' }).click();
    await dlg.getByText('Informe um valor maior que zero.').waitFor();
    await dlg.getByLabel('Valor (R$)').fill('10.000,00');
    await dlg.getByRole('button', { name: 'Confirmar pagamento' }).click();
    await dlg.getByText(/excede o saldo pendente \(R\$ 1\.234,56\)/).waitFor();
    ok(true, 'valor zero e valor acima do saldo são recusados com mensagem clara');
    ok(await count('select count(*)::int n from public.finance_payments fp join public.finance_accounts a on a.id=fp.account_id where a.description=$1', [`${TAG} Aluguel`]) === 0, 'nada foi gravado nas tentativas inválidas');
    await dlg.getByLabel('Valor (R$)').fill('500,00');
    await dlg.getByLabel(/Comprovante/).setInputFiles({ name: 'comprovante.pdf', mimeType: 'application/pdf', buffer: PDF });
    await dlg.getByRole('button', { name: 'Confirmar pagamento' }).dblclick(); // clique duplo
    await toast(page, /Pagamento confirmado e comprovante anexado/);
    await page.getByText('Parcial').first().waitFor();
    await page.getByText('R$ 734,56').first().waitFor();
    ok(await count('select count(*)::int n from public.finance_payments fp join public.finance_accounts a on a.id=fp.account_id where a.description=$1', [`${TAG} Aluguel`]) === 1, 'clique duplo em "Confirmar pagamento" registra um único pagamento');
    ok(true, 'saldo recalculado (R$ 1.234,56 − R$ 500,00 = R$ 734,56) e situação "Parcial"');
    await page.getByText('Envio pendente').first().waitFor();
    ok(true, 'comprovante anexado, mas o envio continua PENDENTE (anexar não confirma envio)');
    ok(await page.getByText('Bruno Almeida').first().isVisible(), 'usuário responsável registrado');
    await shot(page, 'f2-parcial');

    console.log('3. Ver/baixar comprovante (URL assinada) e confirmar envio');
    const respP = page.context().waitForEvent('response', (r) => r.request().method() === 'GET' && r.url().includes('/storage/v1/object/sign/'));
    await page.getByRole('button', { name: /Ver comprovante/ }).click();
    const resp = await respP;
    ok(resp.status() === 200 && /pdf/.test(resp.headers()['content-type'] || ''), 'o comprovante abre por link temporário assinado');
    for (const extra of page.context().pages().filter((p) => p !== page)) await extra.close();
    await page.getByRole('button', { name: 'Confirmar envio do comprovante' }).click();
    dlg = dlgOf(page);
    await dlg.getByText(/apenas REGISTRA/).waitFor();
    await dlg.getByLabel(/Observação/).fill('Enviado por e-mail');
    await dlg.getByRole('button', { name: 'Confirmar envio' }).click();
    await page.getByText(/Envio confirmado por Bruno Almeida/).waitFor();
    ok(true, 'confirmação de envio registra quem e quando (sem enviar mensagem alguma)');

    console.log('4. Falha de upload depois do pagamento salvo: repetir sem duplicar');
    await page.getByRole('button', { name: 'Confirmar pagamento' }).first().click();
    dlg = dlgOf(page);
    await dlg.getByLabel('Valor (R$)').fill('100,00');
    await dlg.getByLabel(/Comprovante/).setInputFiles({ name: 'segunda.pdf', mimeType: 'application/pdf', buffer: PDF });
    await page.route('**/storage/v1/object/receipts/**', (r) => r.abort('failed')); // o upload falha
    await dlg.getByRole('button', { name: 'Confirmar pagamento' }).click();
    await page.getByText('Pagamento confirmado', { exact: true }).waitFor();
    await dlg.getByRole('button', { name: 'Tentar anexar novamente' }).waitFor();
    ok(true, 'pagamento salvo; a falha do upload é informada e oferece "Tentar anexar novamente"');
    ok(await count('select count(*)::int n from public.finance_payments fp join public.finance_accounts a on a.id=fp.account_id where a.description=$1', [`${TAG} Aluguel`]) === 2, 'o pagamento foi gravado uma vez');
    await page.unroute('**/storage/v1/object/receipts/**');
    await dlg.getByRole('button', { name: 'Tentar anexar novamente' }).click();
    await page.getByText('Comprovante anexado.', { exact: true }).waitFor(); // o aviso (o histórico tem texto mais longo)
    await page.getByText('R$ 634,56').first().waitFor();
    ok(await count('select count(*)::int n from public.finance_payments fp join public.finance_accounts a on a.id=fp.account_id where a.description=$1', [`${TAG} Aluguel`]) === 2, 'a nova tentativa anexou sem duplicar o pagamento');
    ok(await count("select count(*)::int n from public.finance_payments fp join public.finance_accounts a on a.id=fp.account_id where a.description=$1 and fp.receipt_path is not null", [`${TAG} Aluguel`]) === 2, 'os dois pagamentos têm comprovante');

    console.log('5. Estorno, cancelamento e histórico');
    ok(await page.getByRole('button', { name: 'Cancelar conta' }).isDisabled(), 'conta com liquidações não pode ser cancelada (botão bloqueado)');
    await page.getByRole('button', { name: 'Estornar' }).nth(1).click();
    dlg = dlgOf(page);
    await dlg.getByRole('button', { name: 'Estornar' }).click();
    await dlg.getByText('Informe ao menos 3 caracteres.').waitFor();
    await dlg.getByLabel(/Motivo/).fill('Valor lançado errado');
    await dlg.getByRole('button', { name: 'Estornar' }).click();
    await toast(page, /Liquidação estornada/);
    await page.getByText('Estornado', { exact: true }).first().waitFor();
    await page.getByText(/Motivo: Valor lançado errado/).first().waitFor();
    await page.getByText('R$ 734,56').first().waitFor();
    ok(true, 'estorno mantém o registro (marcado), mostra o motivo e recalcula o saldo (R$ 634,56 → R$ 734,56)');
    await page.getByText(/Estorno de pagamento de R\$ 100,00/).first().waitFor();
    for (const re of [/Conta a pagar criada/, /Pagamento de R\$ 500,00 confirmado/, /Comprovante anexado/, /Envio do comprovante confirmado/]) await page.getByText(re).first().waitFor();
    ok(true, 'histórico traz criação, liquidação, comprovante, envio e estorno');
    await shot(page, 'f5-estorno-historico');

    console.log('6. Lista: alertas separados, resumo, filtros e busca');
    await nav(page, 'Financeiro').click();
    await page.getByText('Pagamentos e recebimentos pendentes', { exact: true }).waitFor();
    ok(await page.getByText('Pagamentos e recebimentos pendentes').isVisible() && await page.getByText('Comprovantes com envio pendente').isVisible(), 'dois alertas separados: pagamento pendente × comprovante com envio pendente');
    await page.getByLabel('Buscar contas').fill(TAG);
    await page.getByText(`${TAG} Aluguel`).first().waitFor();
    ok(await page.getByText(/Resumo das contas que atendem aos filtros/).isVisible(), 'o resumo declara o período e os filtros aplicados');
    ok(await page.getByText(new RegExp(`busca “${TAG}”`)).first().isVisible(), 'a descrição dos filtros inclui a busca');
    await page.getByLabel('Filtrar por situação').selectOption('paid');
    await page.getByText('Nenhuma conta encontrada').waitFor();
    await page.getByLabel('Filtrar por situação').selectOption('partial');
    await page.getByText(`${TAG} Aluguel`).first().waitFor();
    await page.getByLabel('Filtrar por tipo').selectOption('receivable');
    await page.getByText('Nenhuma conta encontrada').waitFor();
    ok(true, 'filtros por situação e tipo, com estado vazio explicado');
    await page.getByRole('button', { name: 'Limpar filtros' }).first().click();
    await page.getByRole('button', { name: 'Período e mais filtros' }).click();
    await page.getByRole('button', { name: 'Já vencidos' }).click();
    await page.getByLabel('Buscar contas').fill(TAG);
    await page.getByText(`${TAG} Aluguel`).first().waitFor();
    await page.getByRole('checkbox', { name: 'Somente em atraso' }).check();
    await page.getByText(`${TAG} Aluguel`).first().waitFor();
    ok(true, 'período de vencimento e "somente em atraso" aplicados no servidor');
    await shot(page, 'f6-lista');
    await page.context().close();

    console.log('7. Permissões na interface (o servidor é a barreira real)');
    const julia = await newPage();
    await login(julia, 'julia');
    await nav(julia, 'Financeiro').click();
    await julia.getByLabel('Buscar contas').fill(TAG);
    await julia.getByText(`${TAG} Aluguel`).first().waitFor();
    await julia.getByText(`${TAG} Aluguel`).first().click();
    await julia.getByRole('heading', { name: `${TAG} Aluguel` }).waitFor();
    ok(await julia.getByRole('button', { name: 'Confirmar pagamento' }).count() > 0, 'Júlia (liquidar) vê "Confirmar pagamento"');
    ok(await julia.getByRole('button', { name: 'Estornar' }).count() === 0 && await julia.getByRole('button', { name: 'Confirmar envio do comprovante' }).count() === 0 && await julia.getByRole('button', { name: 'Editar' }).count() === 0, 'Júlia não vê estornar, confirmar envio nem editar');
    await julia.context().close();
    const igor = await newPage();
    await login(igor, 'igor');
    await nav(igor, 'Financeiro').click();
    ok(await igor.getByRole('button', { name: 'Nova conta' }).count() === 0, 'Igor (só visualizar) não vê "Nova conta"');
    await igor.getByLabel('Buscar contas').fill(TAG);
    await igor.getByText(`${TAG} Aluguel`).first().click();
    await igor.getByRole('heading', { name: `${TAG} Aluguel` }).waitFor();
    ok(await igor.getByRole('button', { name: /Confirmar pagamento|Editar|Estornar|Cancelar conta|Anexar comprovante/ }).count() === 0, 'Igor não vê nenhuma ação de escrita');
    const respP2 = igor.context().waitForEvent('response', (r) => r.request().method() === 'GET' && r.url().includes('/storage/v1/object/sign/'));
    await igor.getByRole('button', { name: /Baixar comprovante/ }).first().click();
    ok((await respP2).status() === 200, 'Igor consegue visualizar/baixar o comprovante (tem "visualizar")');
    for (const extra of igor.context().pages().filter((p) => p !== igor)) await extra.close();
    await igor.context().close();
    const lucas = await newPage();
    await login(lucas, 'lucas');
    const items = await lucas.locator('nav[aria-label="Principal"] a').evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')));
    ok(!items.includes('Financeiro'), 'Lucas (sem financeiro) não tem o item no menu');
    await lucas.goto(`${APP}/financeiro`);
    await lucas.waitForURL((u) => !u.pathname.startsWith('/financeiro'));
    ok(true, '/financeiro por URL direta redireciona');
    await lucas.context().close();

    console.log('8. Visão consolidada (administrador geral)');
    const adm = await newPage();
    await login(adm, 'ana');
    await nav(adm, 'Financeiro').click();
    await adm.getByRole('heading', { name: 'Por loja' }).waitFor();
    ok(await adm.getByRole('button', { name: 'Nova conta' }).count() === 0, 'consolidado é somente leitura (sem "Nova conta")');
    ok(await adm.getByText(/cada conta aparece uma única vez/).isVisible(), 'o consolidado explica que não duplica valores');
    const totalRow = await adm.locator('tr', { hasText: /^Total/ }).innerText();
    ok(/R\$/.test(totalRow), 'linha Total calculada no servidor');
    await adm.context().close();

    console.log('9. Celular (390 px)');
    const mob = await newPage({ width: 390, height: 844 });
    await login(mob, 'bruno');
    await mob.getByRole('button', { name: 'Abrir menu' }).click();
    await mob.locator('nav[aria-label="Principal"]').getByRole('link', { name: 'Financeiro' }).click();
    await mob.getByText(`${TAG} Aluguel`).first().waitFor().catch(async () => { await mob.getByLabel('Buscar contas').fill(TAG); await mob.getByText(`${TAG} Aluguel`).first().waitFor(); });
    ok(!(await mob.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)), 'lista sem rolagem horizontal da página');
    await shot(mob, 'f9-mobile-lista');
    await mob.getByText(`${TAG} Aluguel`).first().click();
    await mob.getByRole('heading', { name: `${TAG} Aluguel` }).waitFor();
    const ov = await overflowing(mob);
    if (ov.sw > ov.W) console.log('     elementos largos demais:', JSON.stringify(ov));
    ok(ov.sw <= ov.W, 'detalhe sem rolagem horizontal da página');
    await mob.getByRole('button', { name: 'Confirmar pagamento' }).first().click();
    ok(await dlgOf(mob).getByRole('button', { name: 'Confirmar pagamento' }).isVisible(), 'modal de pagamento utilizável no celular');
    await shot(mob, 'f9-mobile-pagamento');
    await mob.context().close();

    ok(errors.length === 0, 'sem erros no console do navegador' + (errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''));
  } finally {
    for (const m of original.reverse()) await rpc(ana, 'update_membership', { p_membership_id: m.id, p_job_title: m.job_title, p_role: m.role, p_permissions: m.permissions });
    await db.end();
    await browser.close();
  }
  console.log(`\nResultado: ${pass} ok, ${fail} falhas`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('ERRO NO ROTEIRO:', e.message); process.exit(2); });

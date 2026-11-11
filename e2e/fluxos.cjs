const { chromium } = require('playwright');
// Roteiro de verificação dos fluxos (troca de loja, redirecionamento, permissões, equipe).
// Uso: com `npm run dev` rodando, execute `node e2e/fluxos.cjs`.
// Requer o pacote "playwright" instalado (npm i -D playwright && npx playwright install chromium).
// Variáveis opcionais: E2E_URL (padrão http://127.0.0.1:5173) e E2E_SHOTS (pasta para salvar capturas de tela).
const SHOTS = process.env.E2E_SHOTS || null;
const URL = process.env.E2E_URL || 'http://127.0.0.1:5173';
const fs = require('fs');
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) { pass++; console.log('  ok  ', msg); } else { fail++; console.log('  FALHA', msg); } };

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));

  const pickProfile = async (name) => {
    await page.getByRole('button', { name: new RegExp(`^${name}`) }).first().click();
    await page.waitForSelector('main#conteudo');
  };
  const openSwitcher = async () => { await page.getByRole('button', { name: /Loja ativa/ }).click(); };
  const storeOptions = async () => (await page.getByRole('listbox').getByRole('option').allInnerTexts()).map((t) => t.split('\n')[0]);
  const navLabels = async () => page.locator('nav[aria-label="Principal"] a').evaluateAll((els) => els.map((e) => e.getAttribute('aria-label') || e.textContent.trim()));
  const navLink = (n) => page.locator('nav[aria-label="Principal"]').getByRole('link', { name: n });
  const chooseStore = async (name) => { await openSwitcher(); await page.getByRole('listbox').getByRole('option', { name: new RegExp(name) }).click(); };
  const switchProfile = async (name) => {
    await page.getByRole('button', { name: /Usuário conectado/ }).click();
    await page.getByRole('menuitem', { name: /Trocar perfil/ }).click();
    await page.getByRole('dialog').getByRole('button', { name: new RegExp(`^${name}`) }).click();
    await page.waitForSelector('main#conteudo');
  };

  console.log('1. Entrada / demonstração');
  await page.goto(URL);
  await page.getByText('Escolha um perfil para explorar').waitFor();
  ok(await page.getByText('não é login').count() > 0, 'seletor identifica que não é autenticação');
  ok(await page.locator('html').evaluate((e) => !e.classList.contains('dark')), 'tema claro por padrão');
  await page.waitForTimeout(300);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/01-entrada.png` });

  console.log('2. Administrador geral');
  await pickProfile('Ana Ribeiro');
  await page.getByRole('heading', { name: 'Visão consolidada' }).waitFor();
  await page.waitForTimeout(700);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/02-admin-consolidado.png` });
  ok((await navLabels()).length === 6, 'admin vê 6 itens de menu');
  await openSwitcher();
  const adminOpts = await storeOptions();
  ok(adminOpts.length === 5 && adminOpts[0] === 'Visão consolidada', `admin: consolidada + 4 lojas (${adminOpts.join(', ')})`);
  await page.keyboard.press('Escape');
  await navLink('Equipe e permissões').click();
  await page.getByText('Todas as contas e os seus vínculos').waitFor();
  await page.getByText('Patrícia Gomes').waitFor();
  ok(await page.getByText('Patrícia Gomes').count() > 0, 'consolidado lista todas as contas');
  await navLink('Histórico de atividades').click();
  await page.getByText('Alterações de acesso registradas em todas as lojas').waitFor();
  ok(await page.getByRole('combobox', { name: 'Filtrar por loja' }).count() === 1, 'histórico consolidado tem filtro de loja');

  console.log('3. Carla: responsável na Beta, funcionária na Gama');
  await switchProfile('Carla Mendes');
  await openSwitcher();
  const carlaOpts = await storeOptions();
  ok(carlaOpts.length === 2 && !carlaOpts.includes('Visão consolidada'), `Carla só vê Beta e Gama (${carlaOpts.join(', ')})`);
  await page.keyboard.press('Escape');
  const betaNav = await navLabels();
  ok(betaNav.includes('Equipe e permissões'), `Beta (responsável): menu inclui Equipe (${betaNav.join(', ')})`);
  await navLink('Equipe e permissões').click();
  await page.getByRole('heading', { name: 'Equipe e permissões' }).waitFor();
  await page.getByText('Lucas Rocha').waitFor();
  await chooseStore('Loja Gama');
  await page.waitForURL((u) => !u.pathname.includes('equipe'));
  ok(page.url().endsWith('/'), 'trocar para Gama (sem Equipe) redireciona para página autorizada');
  ok(await page.getByText(/não está liberado para você na Loja Gama/).count() > 0, 'aviso explica o redirecionamento');
  const gamaNav = await navLabels();
  ok(gamaNav.join('|') === 'Visão geral|Calendário', `Gama (funcionária): menu reduzido (${gamaNav.join(', ')})`);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/03-carla-gama.png` });
  await page.goto(URL + '/equipe');
  await page.waitForURL((u) => !u.pathname.includes('equipe'));
  ok(true, 'acesso direto por URL a /equipe também é redirecionado');

  console.log('4. Igor: permissões diferentes por loja');
  await switchProfile('Igor Lima');
  await navLink('Calendário').click();
  await page.getByText('será implementado nas próximas etapas').waitFor();
  ok(true, 'Calendário em Alfa mostra estado vazio (sem simulação)');
  const alfaNavIgor = await navLabels();
  await chooseStore('Loja Beta');
  await page.waitForURL((u) => u.pathname === '/');
  ok(true, 'Beta não libera Calendário: redirecionado para a Visão geral');
  const betaNavIgor = await navLabels();
  ok(alfaNavIgor.includes('Calendário') && !betaNavIgor.includes('Calendário'), 'menu muda com a loja');

  console.log('5. Marcos: vínculo inativo em Alfa');
  await switchProfile('Marcos Teixeira');
  await openSwitcher();
  const marcosOpts = await storeOptions();
  ok(marcosOpts.length === 1 && marcosOpts[0] === 'Loja Delta', `só Delta aparece (${marcosOpts.join(', ')})`);
  await page.keyboard.press('Escape');

  console.log('6. Patrícia: sem vínculos ativos');
  await page.getByRole('button', { name: /Usuário conectado/ }).click();
  await page.getByRole('menuitem', { name: /Trocar perfil/ }).click();
  await page.getByRole('dialog').getByRole('button', { name: /^Patrícia Gomes/ }).click();
  await page.getByText('Sem acesso a nenhuma loja').waitFor();
  ok(await page.getByText('Sem acesso a nenhuma loja').count() > 0, 'pessoa sem vínculo vê tela de sem acesso');
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/04-sem-acesso.png` });
  await page.getByRole('button', { name: 'Escolher outro perfil' }).click();

  console.log('7. Bruno: gerenciar equipe da Loja Alfa');
  await pickProfile('Bruno Almeida');
  await navLink('Equipe e permissões').click();
  await page.getByText('Igor Lima').waitFor();
  ok(await page.getByText('Gerido pela administração geral').count() >= 1, 'responsáveis (Helena) aparecem bloqueados para edição');
  ok(await page.getByText('Seu vínculo').count() === 1, 'próprio vínculo bloqueado');
  ok(await page.getByText('Marcos Teixeira').count() === 0, 'inativos ocultos por padrão');
  await page.getByRole('button', { name: /^Inativos/ }).click();
  await page.getByText('Marcos Teixeira').waitFor();
  ok(true, 'filtro Inativos mostra Marcos');
  await page.getByRole('button', { name: /^Ativos/ }).click();
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/05-equipe-bruno.png` });

  // cadastro: conta existente
  await page.getByRole('button', { name: 'Novo funcionário' }).click();
  const dlg = page.getByRole('dialog');
  await dlg.getByLabel(/^E-mail/).fill('lucas@demo.example');
  await dlg.getByLabel(/^E-mail/).blur();
  await dlg.getByText(/Conta existente de/).waitFor();
  ok(await dlg.getByText('Lucas Rocha').count() > 0, 'e-mail existente reaproveita a conta (separação conta x vínculo)');
  ok(await dlg.getByLabel('Nome completo').count() === 0, 'campo de nome não aparece para conta existente');
  // matriz: visualizar bloqueia ações
  const calView = dlg.getByRole('checkbox', { name: 'Calendário: Visualizar' });
  const calEdit = dlg.getByRole('checkbox', { name: 'Calendário: Editar' });
  ok(await calEdit.isDisabled(), 'ação desabilitada enquanto "visualizar" estiver desmarcado');
  await calView.check();
  ok(await calEdit.isEnabled(), 'ação habilitada após marcar "visualizar"');
  await calEdit.check();
  await calView.uncheck();
  ok(!(await calEdit.isChecked()) && await calEdit.isDisabled(), 'desmarcar "visualizar" limpa e bloqueia as ações');
  ok(await dlg.getByRole('checkbox', { name: 'Equipe e permissões: Criar' }).isDisabled(), 'funcionário não recebe ações administrativas');
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/06-form-cadastro.png` });
  await calView.check();
  await calEdit.check();
  await dlg.getByLabel('Cargo ou função').fill('Apoio');
  await dlg.getByRole('button', { name: 'Cadastrar' }).click();
  await page.getByText(/foi vinculado\(a\) à Loja Alfa/).waitFor();
  ok(await page.getByText('Lucas Rocha').count() > 0, 'Lucas aparece na lista da Alfa após o cadastro');

  // cadastro: conta nova
  await page.getByRole('button', { name: 'Novo funcionário' }).click();
  await dlg.getByLabel(/^E-mail/).fill('nova.pessoa@demo.example');
  await dlg.getByLabel(/^E-mail/).blur();
  await dlg.getByLabel('Nome completo').waitFor();
  await dlg.getByRole('button', { name: 'Cadastrar' }).click();
  await dlg.getByText('Informe o nome da pessoa.').first().waitFor();
  ok(true, 'validação: nome obrigatório para conta nova');
  await dlg.getByLabel('Nome completo').fill('Nova Pessoa');
  await dlg.getByRole('button', { name: 'Cadastrar' }).click();
  await page.getByText(/Cadastro concluído/).waitFor();
  ok(await page.getByText('Nova Pessoa').count() > 0, 'conta nova criada e vinculada');

  // edição
  await page.getByRole('button', { name: 'Editar Júlia Nunes' }).click();
  await dlg.getByRole('checkbox', { name: 'Financeiro: Visualizar' }).check();
  await dlg.getByRole('button', { name: 'Salvar alterações' }).click();
  await page.getByText('Vínculo de Júlia Nunes atualizado.').waitFor();
  ok(true, 'edição de permissões salva com feedback');

  // desativação
  await page.getByRole('button', { name: 'Desativar vínculo de Igor Lima' }).click();
  await page.getByRole('dialog').getByText('A conta da pessoa e os vínculos com outras lojas continuam ativos').waitFor();
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/07-confirmar-desativacao.png` });
  await page.getByRole('dialog').getByRole('button', { name: 'Desativar vínculo' }).click();
  await page.getByText(/desativado\. A conta e os outros vínculos foram mantidos/).waitFor();
  await page.locator('ul li', { hasText: 'Igor Lima' }).waitFor({ state: 'detached' });
  ok(true, 'Igor some da lista de ativos');

  // histórico
  await navLink('Histórico de atividades').click();
  await page.locator('ul li', { hasText: 'Vínculo de Igor Lima com a Loja Alfa desativado.' }).waitFor();
  ok(await page.getByText(/Calendário: liberou editar/).count() > 0, 'histórico registra mudanças locais');
  ok(await page.getByText(/Financeiro: liberou visualizar/).count() > 0, 'histórico registra permissões editadas');
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/08-historico.png` });

  // efeito sobre Igor: só Beta
  await switchProfile('Igor Lima');
  await openSwitcher();
  const igorOpts = await storeOptions();
  ok(igorOpts.length === 1 && igorOpts[0] === 'Loja Beta', `Igor mantém só a Beta após desativação na Alfa (${igorOpts.join(', ')})`);
  await page.keyboard.press('Escape');

  console.log('8. Persistência, tema, financeiro, erro');
  await page.reload();
  await page.waitForSelector('main#conteudo');
  ok(await page.getByRole('button', { name: /Usuário conectado: Igor Lima/ }).count() === 1, 'perfil mantido após recarregar');
  await page.getByRole('button', { name: 'Usar tema escuro' }).click();
  ok(await page.locator('html').evaluate((e) => e.classList.contains('dark')), 'tema escuro ativa');
  await navLink('Financeiro').click();
  await page.getByText('será implementado nas próximas etapas').waitFor();
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/09-financeiro-escuro.png` });
  await switchProfile('Ana Ribeiro');
  await navLink('Configurações').click();
  await page.getByRole('switch', { name: 'Simular falha de carregamento' }).click();
  await navLink('Histórico de atividades').click();
  await page.getByRole('heading', { name: 'Não foi possível carregar' }).waitFor();
  ok(true, 'estado de erro aparece com falha simulada');
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/10-erro.png` });
  await navLink('Configurações').click();
  await page.getByRole('switch', { name: 'Simular falha de carregamento' }).click();
  await navLink('Histórico de atividades').click();
  await page.locator('ul li').first().waitFor();
  ok(true, 'após desligar a falha, os dados carregam novamente');
  await navLink('Configurações').click();
  await page.getByRole('button', { name: 'Restaurar', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Restaurar' }).click();
  await page.getByText('Dados de demonstração restaurados').waitFor();
  ok(true, 'restaurar dados com confirmação');

  console.log('9. Celular');
  const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  const mp = await mobile.newPage();
  mp.on('console', (m) => { if (m.type() === 'error') errors.push('mobile: ' + m.text()); });
  await mp.goto(URL);
  await mp.getByRole('button', { name: /^Carla Mendes/ }).click();
  await mp.waitForSelector('main#conteudo');
  ok(await mp.locator('aside').first().isHidden(), 'menu lateral fixo escondido no celular');
  await mp.getByRole('button', { name: 'Abrir menu' }).click();
  await mp.locator('nav[aria-label="Principal"]').getByRole('link', { name: 'Equipe e permissões' }).waitFor();
  if (SHOTS) await mp.screenshot({ path: `${SHOTS}/11-mobile-menu.png` });
  await mp.locator('nav[aria-label="Principal"]').getByRole('link', { name: 'Equipe e permissões' }).click();
  await mp.getByText('Lucas Rocha').waitFor();
  const overflow = await mp.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  ok(!overflow, 'sem rolagem horizontal da página no celular');
  if (SHOTS) await mp.screenshot({ path: `${SHOTS}/12-mobile-equipe.png` });
  await mp.getByRole('button', { name: 'Novo funcionário' }).click();
  await mp.waitForTimeout(200);
  if (SHOTS) await mp.screenshot({ path: `${SHOTS}/13-mobile-form.png` });

  ok(errors.length === 0, 'sem erros no console' + (errors.length ? ': ' + errors.join(' | ') : ''));
  console.log(`\nResultado: ${pass} ok, ${fail} falhas`);
  await browser.close();
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('ERRO NO ROTEIRO:', e.message); process.exit(2); });

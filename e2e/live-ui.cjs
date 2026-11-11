const { chromium } = require('playwright');
// Roteiro de interface do MODO REAL contra e2e/fake-supabase.cjs (não é o Supabase de verdade).
// Passos:
//   node e2e/fake-supabase.cjs &
//   VITE_SUPABASE_URL=http://127.0.0.1:54399 VITE_SUPABASE_ANON_KEY=<jwt anon qualquer> npx vite --port 5174 &
//   npx vite --port 5175 &          # sem variáveis: deve mostrar a orientação de configuração
//   node e2e/live-ui.cjs            # requer o pacote "playwright"
// Variável opcional E2E_SHOTS: pasta para salvar capturas de tela.
const SH = process.env.E2E_SHOTS || null;
if (SH) require('fs').mkdirSync(SH, { recursive: true });
let pass = 0, fail = 0;
const ok = (c, m) => { c ? pass++ : fail++; console.log(c ? '  ok   ' : '  FALHA', m); };
const control = (body) => fetch('http://127.0.0.1:54399/__control', { method: 'POST', body: JSON.stringify(body) });

(async () => {
  const browser = await chromium.launch();
  const errors = [];
  const newPage = async (url, vp = { width: 1280, height: 800 }) => {
    const ctx = await browser.newContext({ viewport: vp });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push(`pageerror ${e.message}`));
    page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|net::ERR/.test(m.text())) errors.push(m.text()); });
    await page.goto(url);
    return page;
  };

  console.log('1. Sem configuração (porta 5175): orientação, sem mock');
  let page = await newPage('http://127.0.0.1:5175');
  await page.getByRole('heading', { name: 'Backend não configurado' }).waitFor();
  ok(await page.getByText('VITE_SUPABASE_URL não está definida.').count() === 1, 'lista o que falta');
  ok(await page.getByText('não usa dados de demonstração no lugar').count() === 1, 'explica que NÃO cai no mock');
  ok(await page.getByText('Ana Ribeiro').count() === 0 && await page.getByText('Escolha um perfil').count() === 0, 'nenhum seletor de perfis fictícios');
  if (SH) await page.screenshot({ path: `${SH}/01-sem-config.png` });
  await page.context().close();

  console.log('2. Backend real: login, erros, recuperação');
  await control({ expire: false });
  page = await newPage('http://127.0.0.1:5174');
  await page.getByRole('heading', { name: 'Entrar' }).waitFor();
  ok(await page.getByText(/criar conta|cadastre-se/i).count() === 0, 'sem link de cadastro público');
  ok(await page.getByText(/Não há cadastro aberto/).count() === 1, 'explica acesso por convite');
  ok(await page.getByText('Escolha um perfil').count() === 0, 'sem seletor de perfis de demonstração');
  await page.getByLabel('E-mail').fill('bruno@fake.test');
  await page.getByLabel('Senha').fill('errada-errada');
  await page.getByRole('button', { name: 'Entrar' }).click();
  await page.getByText('E-mail ou senha incorretos.').waitFor();
  ok(true, 'senha errada: mensagem neutra');
  await page.getByLabel('E-mail').fill('naoexiste@fake.test');
  await page.getByRole('button', { name: 'Entrar' }).click();
  await page.waitForTimeout(400);
  ok(await page.getByText('E-mail ou senha incorretos.').count() === 1, 'e-mail inexistente: MESMA mensagem (não revela contas)');
  if (SH) await page.screenshot({ path: `${SH}/02-login-erro.png` });
  await page.getByRole('button', { name: 'Esqueci minha senha' }).click();
  await page.getByLabel('E-mail').fill('naoexiste@fake.test');
  await page.getByRole('button', { name: 'Enviar link' }).click();
  await page.getByRole('heading', { name: 'Verifique seu e-mail' }).waitFor();
  ok(await page.getByText(/Se o endereço informado estiver cadastrado/).count() === 1, 'recuperação: resposta genérica, igual para qualquer e-mail');

  console.log('3. Entrada, sessão e ausência de rastros da demonstração');
  await page.getByRole('button', { name: 'Voltar para entrar' }).click();
  await page.getByLabel('E-mail').fill('bruno@fake.test');
  await page.getByLabel('Senha').fill('Senha1234567');
  await page.getByRole('button', { name: 'Entrar' }).click();
  await page.waitForSelector('main#conteudo');
  await page.getByText('Loja Real Alfa').first().waitFor();
  ok(await page.getByText('Demonstração com dados fictícios').count() === 0, 'sem faixa de demonstração');
  ok(await page.getByRole('button', { name: /Trocar perfil/ }).count() === 0, 'sem botão de trocar perfil');
  await page.waitForTimeout(400);
  if (SH) await page.screenshot({ path: `${SH}/03-logado.png` });
  await page.getByRole('button', { name: /Usuário conectado: Bruno/ }).click();
  ok(await page.getByRole('menuitem', { name: 'Sair' }).count() === 1 && await page.getByText('Trocar perfil de demonstração').count() === 0, 'menu do usuário: Sair (e não troca de perfil)');
  await page.keyboard.press('Escape');
  const keys = await page.evaluate(() => Object.keys(localStorage));
  ok(!keys.some((k) => k.startsWith('esctiroio.demo')), `nenhuma chave da demonstração no armazenamento (${keys.join(', ')})`);
  ok(keys.includes('esctiroio.auth'), 'sessão guardada pelo cliente de autenticação');
  await page.locator('nav[aria-label="Principal"]').getByRole('link', { name: 'Equipe e permissões' }).click();
  await page.getByText('Lucas Rocha').waitFor();
  ok(true, 'equipe vem do servidor (RPC)');
  await page.getByRole('button', { name: 'Novo funcionário' }).click();
  const dlg = page.getByRole('dialog');
  ok(await dlg.getByLabel(/^Nome completo/).count() === 1, 'nome sempre visível (não depende de a conta existir)');
  ok(await dlg.getByText(/Conta existente de/).count() === 0, 'sem consulta que revele contas existentes');
  await dlg.getByLabel(/^E-mail/).fill('alguem@fake.test');
  await dlg.getByLabel(/^E-mail/).blur();
  await page.waitForTimeout(300);
  const log = await (await fetch('http://127.0.0.1:54399/__log')).json();
  ok(!log.some((l) => /profiles\?.*email/.test(l)), 'digitar um e-mail não gera nenhuma consulta de contas no servidor');
  await page.keyboard.press('Escape');

  console.log('4. Sessão expirada');
  await control({ expire: true });
  await page.locator('nav[aria-label="Principal"]').getByRole('link', { name: 'Histórico de atividades' }).click();
  await page.getByRole('heading', { name: 'Entrar' }).waitFor();
  ok(await page.getByText('Sua sessão expirou. Entre novamente para continuar.').count() === 1, 'volta ao login com aviso de sessão expirada');
  if (SH) await page.screenshot({ path: `${SH}/04-expirada.png` });
  await page.context().close();

  console.log('5. Sair por vontade própria não mostra aviso de expiração');
  await control({ expire: false });
  page = await newPage('http://127.0.0.1:5174');
  await page.getByLabel('E-mail').fill('bruno@fake.test');
  await page.getByLabel('Senha').fill('Senha1234567');
  await page.getByRole('button', { name: 'Entrar' }).click();
  await page.waitForSelector('main#conteudo');
  await page.getByRole('button', { name: /Usuário conectado/ }).click();
  await page.getByRole('menuitem', { name: 'Sair' }).click();
  await page.getByRole('heading', { name: 'Entrar' }).waitFor();
  ok(await page.getByText(/sessão expirou/).count() === 0, 'logout manual: sem aviso de expiração');
  await page.reload();
  await page.getByRole('heading', { name: 'Entrar' }).waitFor();
  ok(true, 'após sair e recarregar, continua no login');
  await page.context().close();

  console.log('6. Convite: link do e-mail leva a definir senha');
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`pageerror ${e.message}`));
  const inviteToken = (() => { const b = (o) => Buffer.from(JSON.stringify(o)).toString('base64url'); return `${b({ alg: 'HS256' })}.${b({ sub: 'u-bruno', role: 'authenticated', exp: Math.floor(Date.now() / 1000) + 3600 })}.sig`; })();
  await page.goto(`http://127.0.0.1:5174/#access_token=${inviteToken}&refresh_token=r-u-bruno&expires_in=3600&token_type=bearer&type=invite`);
  await page.getByRole('heading', { name: 'Defina sua senha' }).waitFor();
  ok(true, 'convite aceito: tela de definir senha (não entra direto)');
  ok(!page.url().includes('access_token'), 'token removido do endereço');
  await page.getByLabel('Nova senha').fill('curta');
  await page.getByLabel('Repita a senha').fill('curta');
  await page.getByRole('button', { name: 'Salvar senha e entrar' }).click();
  await page.getByText('Use ao menos 10 caracteres.').waitFor();
  await page.getByLabel('Nova senha').fill('SenhaNova2026ok');
  await page.getByLabel('Repita a senha').fill('Diferente2026ok');
  await page.getByRole('button', { name: 'Salvar senha e entrar' }).click();
  await page.getByText('As senhas não conferem.').waitFor();
  await page.getByLabel('Repita a senha').fill('SenhaNova2026ok');
  await page.getByRole('button', { name: 'Salvar senha e entrar' }).click();
  await page.waitForSelector('main#conteudo');
  ok(true, 'senha válida: entra no app');
  if (SH) await page.screenshot({ path: `${SH}/05-convite-ok.png` });
  await ctx.close();

  console.log('7. Link de convite expirado');
  page = await newPage('http://127.0.0.1:5174/#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired');
  await page.getByRole('heading', { name: 'Entrar' }).waitFor();
  ok(await page.getByText(/O link expirou ou já foi usado/).count() === 1, 'aviso claro para link expirado');
  await page.context().close();

  console.log('8. Conta desativada e conta sem vínculos');
  await control({ expire: false });
  page = await newPage('http://127.0.0.1:5174');
  await page.getByLabel('E-mail').fill('inativo@fake.test');
  await page.getByLabel('Senha').fill('Senha1234567');
  await page.getByRole('button', { name: 'Entrar' }).click();
  await page.getByText(/Sua conta está desativada ou ainda não foi liberada/).waitFor();
  ok(await page.getByRole('button', { name: 'Sair' }).count() === 1, 'conta desativada: erro claro e botão Sair (sem dados)');
  if (SH) await page.screenshot({ path: `${SH}/06-conta-desativada.png` });
  await page.context().close();
  page = await newPage('http://127.0.0.1:5174');
  await page.getByLabel('E-mail').fill('sem-loja@fake.test');
  await page.getByLabel('Senha').fill('Senha1234567');
  await page.getByRole('button', { name: 'Entrar' }).click();
  await page.getByText('Sem acesso a nenhuma loja').waitFor();
  ok(true, 'conta sem vínculos: tela de sem acesso');
  await page.context().close();

  console.log('9. Celular (390px)');
  page = await newPage('http://127.0.0.1:5174', { width: 390, height: 844 });
  await page.getByRole('heading', { name: 'Entrar' }).waitFor();
  ok(!(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)), 'login sem rolagem horizontal');
  if (SH) await page.screenshot({ path: `${SH}/07-login-mobile.png` });
  await page.context().close();

  ok(errors.length === 0, 'sem erros no console' + (errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''));
  console.log(`\nResultado: ${pass} ok, ${fail} falhas`);
  await browser.close();
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('ERRO NO ROTEIRO:', e.message); process.exit(2); });

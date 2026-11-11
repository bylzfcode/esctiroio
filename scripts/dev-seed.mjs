// Cria contas e vínculos FICTÍCIOS no Supabase LOCAL, para desenvolver/testar.
//
//   supabase start && supabase db reset     # aplica migrações + supabase/seed.sql
//   eval "$(supabase status -o env | sed 's/^/export /')"   # exporta API_URL, SERVICE_ROLE_KEY...
//   SUPABASE_URL=$API_URL SUPABASE_SERVICE_ROLE_KEY=$SERVICE_ROLE_KEY npm run dev:seed
//
// SEGURANÇA: recusa qualquer URL que não seja localhost. A chave de serviço vem do ambiente
// da sua máquina e nunca é gravada em arquivo.
import { createClient } from '@supabase/supabase-js';

const url = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const host = new URL(url).hostname;
if (!['localhost', '127.0.0.1', '[::1]', 'host.docker.internal'].includes(host)) {
  console.error(`Recusado: ${host} não é um ambiente local. Este script cria contas de exemplo e só roda em localhost.`);
  process.exit(1);
}
if (!key) {
  console.error('Defina SUPABASE_SERVICE_ROLE_KEY (veja o cabeçalho deste arquivo).');
  process.exit(1);
}

// Senha FICTÍCIA de desenvolvimento local (cumpre a política: 10+ com maiúscula, minúscula e número).
const DEV_PASSWORD = 'DevLocal2026x';
const admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

const FULL = {
  overview: ['view'],
  finance: ['view', 'create', 'edit', 'delete', 'export'],
  team: ['view', 'create', 'edit', 'delete', 'export'],
  calendar: ['view', 'create', 'edit', 'delete', 'export'],
  activity: ['view', 'export'],
  settings: ['view'],
};

// [chave, nome, admin?]
const PEOPLE = [
  ['ana', 'Ana Ribeiro', true],
  ['bruno', 'Bruno Almeida'],
  ['helena', 'Helena Prado'],
  ['carla', 'Carla Mendes'],
  ['diego', 'Diego Faria'],
  ['igor', 'Igor Lima'],
  ['julia', 'Júlia Nunes'],
  ['lucas', 'Lucas Rocha'],
];
// [pessoa, loja(código), perfil, cargo, permissões]
const LINKS = [
  ['bruno', 'A01', 'responsavel', 'Gerente', FULL],
  ['helena', 'A01', 'responsavel', 'Subgerente', FULL],
  ['carla', 'B02', 'responsavel', 'Gerente', FULL],
  ['diego', 'G03', 'responsavel', 'Gerente', FULL],
  ['diego', 'D04', 'responsavel', 'Gerente regional', FULL],
  ['igor', 'A01', 'funcionario', 'Caixa', { overview: ['view'], calendar: ['view', 'create', 'edit'], team: ['view'] }],
  ['igor', 'B02', 'funcionario', 'Apoio', { overview: ['view'], finance: ['view'] }],
  ['julia', 'A01', 'funcionario', 'Atendente', { overview: ['view'], activity: ['view'] }],
  ['lucas', 'B02', 'funcionario', 'Caixa', { overview: ['view'], calendar: ['view'] }],
  ['carla', 'G03', 'funcionario', 'Atendente', { overview: ['view'], calendar: ['view', 'create'] }],
];

const must = (r, what) => {
  if (r.error) throw new Error(`${what}: ${r.error.message}`);
  return r.data;
};

const ids = {};
for (const [k, name, isAdmin] of PEOPLE) {
  const email = `${k}@dev.example`;
  let id;
  const created = await admin.auth.admin.createUser({ email, password: DEV_PASSWORD, email_confirm: true, user_metadata: { full_name: name } });
  if (created.error) {
    // Já existe (execução repetida): reaproveita.
    const { data } = await admin.from('profiles').select('id').eq('email', email).maybeSingle();
    if (!data) throw new Error(`createUser ${email}: ${created.error.message}`);
    id = data.id;
  } else id = created.data.user.id;
  ids[k] = id;
  must(
    await admin.from('profiles').update({ full_name: name, active: true, activated_at: new Date().toISOString(), is_general_admin: !!isAdmin }).eq('id', id).is('activated_at', null),
    `ativar ${email}`,
  );
}

const stores = must(await admin.from('stores').select('id, code'), 'lojas');
const storeId = Object.fromEntries(stores.map((s) => [s.code, s.id]));
for (const [who, code, role, jobTitle, permissions] of LINKS) {
  must(
    await admin
      .from('memberships')
      .upsert({ person_id: ids[who], store_id: storeId[code], role, job_title: jobTitle, permissions }, { onConflict: 'person_id,store_id', ignoreDuplicates: true }),
    `vínculo ${who}/${code}`,
  );
}

console.log('Contas fictícias criadas (senha de desenvolvimento local para todas: %s):', DEV_PASSWORD);
for (const [k, name, isAdmin] of PEOPLE) console.log(`  ${k}@dev.example  ${isAdmin ? '[administrador geral] ' : ''}${name}`);

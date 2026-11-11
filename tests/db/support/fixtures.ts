import type { Db } from './harness';

// Identificadores fixos e legíveis nos testes. Todos fictícios.
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

export const S = { alfa: uuid(101), beta: uuid(102), gama: uuid(103) };
export const U = {
  ana: uuid(1), // administradora geral
  ada: uuid(2), // segunda administradora geral
  bruno: uuid(3), // responsável na Alfa
  helena: uuid(4), // responsável na Alfa (segunda)
  carla: uuid(5), // responsável na Beta e funcionária na Gama
  igor: uuid(6), // funcionário na Alfa e na Beta
  julia: uuid(7), // funcionária na Alfa (vê o histórico)
  lucas: uuid(8), // funcionário na Beta
  fabio: uuid(9), // funcionário na Gama que apenas consulta a equipe
  ines: uuid(10), // conta ativa sem nenhum vínculo
  paulo: uuid(11), // conta desativada
};

export const EMAIL = (key: keyof typeof U) => `${key}@demo.example`;

type Perms = Record<string, string[]>;
export const FULL: Perms = {
  overview: ['view'],
  finance: ['view', 'create', 'edit', 'delete', 'export'],
  team: ['view', 'create', 'edit', 'delete', 'export'],
  calendar: ['view', 'create', 'edit', 'delete', 'export'],
  activity: ['view', 'export'],
  settings: ['view'],
};

async function account(db: Db, key: keyof typeof U, opts: { admin?: boolean; active?: boolean } = {}) {
  const id = U[key];
  await db.query('insert into auth.users (id, email, raw_user_meta_data) values ($1, $2, $3)', [
    id,
    EMAIL(key),
    JSON.stringify({ full_name: key[0]!.toUpperCase() + key.slice(1) }),
  ]);
  if (opts.active !== false) {
    await db.query(
      'update public.profiles set active = true, activated_at = now(), is_general_admin = $2 where id = $1',
      [id, !!opts.admin],
    );
  }
}

async function link(db: Db, who: keyof typeof U, store: string, role: 'responsavel' | 'funcionario', perms: Perms, active = true) {
  await db.query(
    `insert into public.memberships (person_id, store_id, role, job_title, permissions, active, deactivated_at)
     values ($1, $2, $3, '', $4, $5, case when $5 then null else now() end)`,
    [U[who], store, role, JSON.stringify(perms), active],
  );
}

/** Cenário base, gravado como superusuário (equivale a migração/administração do projeto). */
export async function seedScenario(db: Db) {
  for (const [id, code, name] of [
    [S.alfa, 'A01', 'Loja Alfa'],
    [S.beta, 'B02', 'Loja Beta'],
    [S.gama, 'G03', 'Loja Gama'],
  ] as const) {
    await db.query('insert into public.stores (id, code, name) values ($1, $2, $3)', [id, code, name]);
  }
  await account(db, 'ana', { admin: true });
  await account(db, 'ada', { admin: true });
  for (const k of ['bruno', 'helena', 'carla', 'igor', 'julia', 'lucas', 'fabio', 'ines'] as const) await account(db, k);
  await account(db, 'paulo', { active: false });

  await link(db, 'bruno', S.alfa, 'responsavel', FULL);
  await link(db, 'helena', S.alfa, 'responsavel', FULL);
  await link(db, 'carla', S.beta, 'responsavel', FULL);
  await link(db, 'igor', S.alfa, 'funcionario', { overview: ['view'], calendar: ['view', 'create'], team: ['view'] });
  await link(db, 'igor', S.beta, 'funcionario', { overview: ['view'], finance: ['view'] });
  await link(db, 'julia', S.alfa, 'funcionario', { overview: ['view'], activity: ['view'] });
  await link(db, 'lucas', S.beta, 'funcionario', { overview: ['view'], calendar: ['view'] });
  await link(db, 'carla', S.gama, 'funcionario', { overview: ['view'], calendar: ['view'] });
  await link(db, 'fabio', S.gama, 'funcionario', { overview: ['view'], team: ['view'] });
  // Dados de auditoria do cenário são gerados pelos gatilhos; limpamos o ruído de "Sistema".
}

export const as_user = (key: keyof typeof U) => ({ user: U[key] });

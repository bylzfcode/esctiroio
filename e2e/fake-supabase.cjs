// Servidor FALSO que imita o protocolo do Supabase (Auth + REST) o suficiente para testar a
// FIAÇÃO DA INTERFACE no modo real: login, sessão expirada, convite, conta desativada.
// NÃO é o Supabase e NÃO valida segurança (isso é feito em tests/db contra o SQL real).
// Uso:  node e2e/fake-supabase.cjs   (porta 54399)
const http = require('http');
const PORT = 54399;
const state = { expire: false, log: [] };
const USERS = {
  'bruno@fake.test': { id: 'u-bruno', password: 'Senha1234567', name: 'Bruno Almeida', active: true },
  'inativo@fake.test': { id: 'u-inativo', password: 'Senha1234567', name: 'Conta Inativa', active: false },
  'sem-loja@fake.test': { id: 'u-semloja', password: 'Senha1234567', name: 'Sem Loja', active: true, stores: false },
};
const byId = (id) => Object.values(USERS).find((u) => u.id === id);
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const token = (u) => `${b64({ alg: 'HS256' })}.${b64({ sub: u.id, role: 'authenticated', exp: Math.floor(Date.now() / 1000) + 3600 })}.sig`;
const userJson = (u, email) => ({ id: u.id, aud: 'authenticated', role: 'authenticated', email, app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() });
const session = (email) => {
  const u = USERS[email];
  return { access_token: token(u), token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, refresh_token: `r-${u.id}`, user: userJson(u, email) };
};
const emailOf = (u) => Object.keys(USERS).find((k) => USERS[k] === u);
const uidFrom = (req) => {
  const a = req.headers.authorization || '';
  try { return JSON.parse(Buffer.from(a.replace(/^Bearer\s+/, '').split('.')[1], 'base64url').toString()).sub; } catch { return null; }
};
const ALFA = { id: '11111111-1111-4111-8111-111111111111', name: 'Loja Real Alfa', code: 'A01' };
const P = (id, name, email) => ({ id, email, full_name: name, is_general_admin: false, active: true, created_at: '2026-01-01T00:00:00Z' });
const M = (id, pid, role, perms) => ({ id, person_id: pid, store_id: ALFA.id, role, job_title: '', permissions: perms, active: true, created_at: '2026-01-01T00:00:00Z', deactivated_at: null });
const FULL = { overview: ['view'], finance: ['view', 'create', 'edit', 'delete', 'export'], team: ['view', 'create', 'edit', 'delete', 'export'], calendar: ['view', 'create', 'edit', 'delete', 'export'], activity: ['view', 'export'], settings: ['view'] };

const send = (res, status, body, extra = {}) => {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*', ...extra });
  res.end(body === undefined ? '' : JSON.stringify(body));
};
http.createServer((req, res) => {
  if (req.method === 'OPTIONS') return send(res, 204);
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
  let raw = '';
  req.on('data', (c) => (raw += c));
  req.on('end', () => {
    const body = raw ? JSON.parse(raw) : {};
    state.log.push(`${req.method} ${url.pathname}${url.search}`);
    const p = url.pathname;
    if (p === '/__control') { Object.assign(state, body); return send(res, 200, state); }
    if (p === '/__log') return send(res, 200, state.log);

    // ---------- Auth (GoTrue) ----------
    if (p === '/auth/v1/token' && url.searchParams.get('grant_type') === 'password') {
      const u = USERS[(body.email || '').toLowerCase()];
      if (!u || u.password !== body.password) return send(res, 400, { code: 'invalid_credentials', error_code: 'invalid_credentials', msg: 'Invalid login credentials' });
      return send(res, 200, session(body.email.toLowerCase()));
    }
    if (p === '/auth/v1/token' && url.searchParams.get('grant_type') === 'refresh_token') {
      if (state.expire) return send(res, 400, { code: 'refresh_token_not_found', error_code: 'refresh_token_not_found', msg: 'Invalid Refresh Token: Refresh Token Not Found' });
      const u = byId((body.refresh_token || '').replace(/^r-/, '')); if (!u) return send(res, 400, { code: 'refresh_token_not_found', msg: 'x' });
      return send(res, 200, session(emailOf(u)));
    }
    if (p === '/auth/v1/logout') return send(res, 204);
    if (p === '/auth/v1/recover') return send(res, 200, {});
    if (p === '/auth/v1/user') {
      const u = byId(uidFrom(req)) || USERS['bruno@fake.test'];
      if (req.method === 'PUT') { state.passwordUpdated = body.password ? true : state.passwordUpdated; }
      return send(res, 200, userJson(u, emailOf(u)));
    }

    // ---------- REST (PostgREST) ----------
    if (p.startsWith('/rest/v1/')) {
      if (state.expire) return send(res, 401, { code: 'PGRST301', message: 'JWT expired', details: null, hint: null });
      const u = byId(uidFrom(req));
      if (!u) return send(res, 401, { code: 'PGRST301', message: 'JWT invalid' });
      const t = p.replace('/rest/v1/', '');
      if (t === 'profiles') return send(res, 200, u.active ? [{ id: u.id, email: emailOf(u), full_name: u.name, is_general_admin: false, active: true, created_at: '2026-01-01T00:00:00Z' }] : []);
      if (t === 'stores') return send(res, 200, u.stores === false ? [] : [ALFA]);
      if (t === 'memberships') return send(res, 200, u.stores === false ? [] : [M('m-bruno', u.id, 'responsavel', FULL)]);
      if (t === 'audit_log') return send(res, 200, []);
      if (t === 'rpc/store_summary') return send(res, 200, { store: ALFA, team: { responsibles: ['Bruno Almeida'], active_employees: 1, inactive_links: 0 }, last_activity_at: null });
      if (t === 'rpc/list_store_members') return send(res, 200, [
        { membership: M('m-bruno', 'u-bruno', 'responsavel', FULL), person: P('u-bruno', 'Bruno Almeida', 'bruno@fake.test'), active_store_count: null },
        { membership: M('m-lucas', 'u-lucas', 'funcionario', { overview: ['view'] }), person: P('u-lucas', 'Lucas Rocha', 'lucas@fake.test'), active_store_count: null },
      ]);
      return send(res, 404, { code: 'PGRST202', message: 'rota não simulada' });
    }
    return send(res, 404, { message: 'não simulado' });
  });
}).listen(PORT, '127.0.0.1', () => console.log(`fake supabase em :${PORT}`));

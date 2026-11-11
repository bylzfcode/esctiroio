// Edge Function (Deno) "invite-member": liga a lógica de _shared/invite-member.ts ao Supabase.
// A chave de serviço (SUPABASE_SERVICE_ROLE_KEY) é fornecida pela plataforma ao ambiente da
// função e NUNCA sai daqui. Variáveis: SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY
// (automáticas) e, configuradas por você: APP_URL (destino do link do convite) e
// ALLOWED_ORIGINS (origens do app, separadas por vírgula).
import { createClient } from 'npm:@supabase/supabase-js@2';
import {
  RpcFailure,
  corsHeaders,
  handleInvite,
  type InviteDeps,
} from '../_shared/invite-member.ts';

const url = Deno.env.get('SUPABASE_URL')!;
const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const appUrl = Deno.env.get('APP_URL') ?? '';
const allowedOrigins = (Deno.env.get('ALLOWED_ORIGINS') ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

const noSession = { auth: { persistSession: false, autoRefreshToken: false } };
const admin = createClient(url, serviceKey, noSession);

/** Cliente com a identidade (JWT) de quem chamou: o banco aplica as regras DELE, não as da chave de serviço. */
const asCaller = (token: string) =>
  createClient(url, anonKey, { ...noSession, global: { headers: { Authorization: `Bearer ${token}` } } });

const rpcFailure = (e: { message: string; code?: string; hint?: string }) => new RpcFailure(e.message, e.code, e.hint);

const deps: InviteDeps = {
  async verifyCaller(token) {
    const { data, error } = await admin.auth.getUser(token);
    return error || !data.user ? null : data.user.id;
  },

  async precheck(token, a) {
    const { error } = await asCaller(token).rpc('precheck_member_invite', {
      p_store_id: a.storeId,
      p_email: a.email,
      p_role: a.role,
      p_permissions: a.permissions,
    });
    if (error) throw rpcFailure(error);
  },

  async findAccount(email) {
    const { data, error } = await admin.from('profiles').select('id, activated_at').eq('email', email).maybeSingle();
    if (error) throw new Error(error.message);
    return data ? { id: data.id as string, activated: data.activated_at !== null } : null;
  },

  async inviteAccount(email, name) {
    const { data, error } = await admin.auth.admin.inviteUserByEmail(email, {
      data: { full_name: name },
      redirectTo: appUrl || undefined,
    });
    if (error || !data.user) throw new Error(error?.message ?? 'convite sem usuário');
    return data.user.id;
  },

  async activateAccount(id, name, invitedBy) {
    const { error } = await admin.rpc('activate_profile', { p_id: id, p_name: name, p_invited_by: invitedBy });
    if (error) throw new Error(error.message);
  },

  async createMembership(token, a) {
    const { error } = await asCaller(token).rpc('create_membership', {
      p_store_id: a.storeId,
      p_person_id: a.personId,
      p_role: a.role,
      p_job_title: a.jobTitle,
      p_permissions: a.permissions,
    });
    if (error) throw rpcFailure(error);
  },
};

Deno.serve(async (req) => {
  const cors = corsHeaders(req.headers.get('Origin'), allowedOrigins);
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  if (req.method !== 'POST') return new Response('Método não permitido', { status: 405, headers: cors });

  let body: unknown = null;
  try {
    body = await req.json();
  } catch {
    /* corpo inválido: a validação devolve 422 */
  }
  const outcome = await handleInvite(req.headers.get('Authorization'), body, deps);
  return new Response(JSON.stringify(outcome.body), {
    status: outcome.status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  });
});

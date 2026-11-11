// Lógica da Edge Function "invite-member", SEM dependências do Deno (testável em Node).
//
// Por que existe: criar contas e enviar convites exige a chave privilegiada (service role),
// que nunca pode ir ao navegador. A função roda no servidor e segue esta ordem:
//   1. valida o JWT do chamador;
//   2. valida a entrada (nome é SEMPRE exigido, para não revelar se o e-mail já tem conta);
//   3. PRÉ-CHECA a autorização com a identidade do chamador (RPC precheck_member_invite):
//      quem não tem permissão nunca dispara convite nem consulta de e-mail;
//      e RESERVA uma vaga do limite por hora (RPC reserve_invite_slot, atômica) antes de qualquer envio;
//   4. reaproveita a conta existente ou convida uma nova e a ativa (activate_profile);
//   5. cria SOMENTE o vínculo, com a identidade do chamador (RPC create_membership), que
//      reaplica todas as regras no banco (defesa em profundidade).
// A resposta é a mesma para conta nova e existente: não permite descobrir e-mails.

export interface InviteRequest {
  storeId: string;
  email: string;
  name: string;
  jobTitle?: string;
  role: string;
  permissions: unknown;
}

export interface FailureBody {
  ok: false;
  code: 'unauthorized' | 'forbidden' | 'validation' | 'not_found' | 'conflict' | 'unavailable';
  message: string;
  fieldErrors?: Record<string, string>;
}
export type InviteOutcome = { status: number; body: { ok: true } | FailureBody };

/** Erro de uma RPC do banco: "code" é o SQLSTATE (PT401/PT403/PT404/PT409/PT422) e "hint" o campo. */
export class RpcFailure extends Error {
  constructor(
    message: string,
    readonly code?: string,
    readonly hint?: string,
  ) {
    super(message);
  }
}

export interface AccountRef {
  id: string;
  /** false = convite anterior que não chegou a ser ativado. */
  activated: boolean;
}

export interface InviteDeps {
  /** Valida o JWT e devolve o id do usuário, ou null. */
  verifyCaller(accessToken: string): Promise<string | null>;
  /** RPC com a identidade do chamador. Lança RpcFailure. */
  precheck(accessToken: string, args: { storeId: string; email: string; role: string; permissions: unknown }): Promise<void>;
  /** RPC com a identidade do chamador: reserva atomicamente uma vaga do limite por hora. Lança RpcFailure. */
  reserveSlot(accessToken: string): Promise<void>;
  /** Consulta com chave privilegiada. */
  findAccount(email: string): Promise<AccountRef | null>;
  /** Cria o usuário no Auth e envia o convite. Devolve o id do novo usuário. */
  inviteAccount(email: string, name: string): Promise<string>;
  /** RPC restrita ao service_role. */
  activateAccount(id: string, name: string, invitedBy: string): Promise<void>;
  /** RPC com a identidade do chamador. Lança RpcFailure. */
  createMembership(
    accessToken: string,
    args: { storeId: string; personId: string; role: string; jobTitle: string; permissions: unknown },
  ): Promise<void>;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const fail = (status: number, code: FailureBody['code'], message: string, fieldErrors?: Record<string, string>): InviteOutcome => ({
  status,
  body: { ok: false, code, message, ...(fieldErrors ? { fieldErrors } : {}) },
});

/** Traduz um erro do banco para a resposta HTTP. */
function fromRpc(e: unknown): InviteOutcome {
  const err = e as RpcFailure;
  const fields = err.hint ? { [err.hint]: err.message } : undefined;
  switch (err.code) {
    case 'PT401':
      return fail(401, 'unauthorized', err.message);
    case 'PT403':
      return fail(403, 'forbidden', err.message);
    case 'PT404':
      return fail(404, 'not_found', err.message);
    case 'PT429':
      return fail(429, 'unavailable', err.message);
    case 'PT409':
      return fail(409, 'conflict', err.message, fields);
    case 'PT422':
      return fail(422, 'validation', 'Revise os campos destacados.', fields ?? undefined);
    default:
      return fail(500, 'unavailable', 'Não foi possível concluir o cadastro agora. Tente novamente.');
  }
}

export function parseBearer(header: string | null): string | null {
  const m = /^Bearer\s+(.+)$/i.exec(header ?? '');
  return m?.[1]?.trim() || null;
}

function parseInput(raw: unknown): { ok: true; value: InviteRequest } | { ok: false; errors: Record<string, string> } {
  const errors: Record<string, string> = {};
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const storeId = typeof r.storeId === 'string' ? r.storeId : '';
  const email = typeof r.email === 'string' ? r.email.trim().toLowerCase() : '';
  const name = typeof r.name === 'string' ? r.name.trim() : '';
  const jobTitle = typeof r.jobTitle === 'string' ? r.jobTitle.trim() : '';
  const role = typeof r.role === 'string' ? r.role : '';

  if (!UUID_RE.test(storeId)) errors.storeId = 'Loja inválida.';
  if (!EMAIL_RE.test(email) || email.length > 254) errors.email = 'Informe um e-mail válido.';
  // Nome sempre exigido: se só fosse exigido para contas novas, a resposta revelaria quais e-mails existem.
  if (name.length < 2 || name.length > 120) errors.name = 'Informe o nome da pessoa.';
  if (jobTitle.length > 60) errors.jobTitle = 'Use no máximo 60 caracteres.';
  if (role !== 'funcionario' && role !== 'responsavel') errors.role = 'Perfil inválido.';
  if (!r.permissions || typeof r.permissions !== 'object' || Array.isArray(r.permissions)) errors.permissions = 'Permissões inválidas.';

  if (Object.keys(errors).length) return { ok: false, errors };
  return { ok: true, value: { storeId, email, name, jobTitle, role, permissions: r.permissions } };
}

export async function handleInvite(authorization: string | null, rawBody: unknown, deps: InviteDeps): Promise<InviteOutcome> {
  const token = parseBearer(authorization);
  if (!token) return fail(401, 'unauthorized', 'Sessão ausente. Entre novamente.');

  let callerId: string | null;
  try {
    callerId = await deps.verifyCaller(token);
  } catch {
    return fail(401, 'unauthorized', 'Sessão expirada. Entre novamente.');
  }
  if (!callerId) return fail(401, 'unauthorized', 'Sessão expirada. Entre novamente.');

  const parsed = parseInput(rawBody);
  if (!parsed.ok) return fail(422, 'validation', 'Revise os campos destacados.', parsed.errors);
  const input = parsed.value;

  // (3) Autorização ANTES de qualquer efeito colateral ou consulta de contas.
  try {
    await deps.precheck(token, { storeId: input.storeId, email: input.email, role: input.role, permissions: input.permissions });
  } catch (e) {
    return fromRpc(e);
  }

  // (3b) Reserva uma vaga do limite por hora ANTES de consultar contas ou enviar e-mail. A reserva é
  // atômica no banco, então chamadas simultâneas não ultrapassam o limite.
  try {
    await deps.reserveSlot(token);
  } catch (e) {
    return fromRpc(e);
  }

  // (4) Reaproveita a identidade existente; senão convida.
  let personId: string;
  try {
    const existing = await deps.findAccount(input.email);
    if (existing) {
      personId = existing.id;
      if (!existing.activated) await deps.activateAccount(existing.id, input.name, callerId);
    } else {
      personId = await deps.inviteAccount(input.email, input.name);
      await deps.activateAccount(personId, input.name, callerId);
    }
  } catch {
    return fail(502, 'unavailable', 'Não foi possível enviar o convite agora. Tente novamente em instantes.');
  }

  // (5) Somente o vínculo, com a identidade do chamador.
  try {
    await deps.createMembership(token, {
      storeId: input.storeId,
      personId,
      role: input.role,
      jobTitle: input.jobTitle ?? '',
      permissions: input.permissions,
    });
  } catch (e) {
    return fromRpc(e);
  }
  return { status: 200, body: { ok: true } };
}

/** CORS fail-closed: só origens listadas em ALLOWED_ORIGINS recebem cabeçalhos de permissão. */
export function corsHeaders(origin: string | null, allowed: string[]): Record<string, string> {
  const base: Record<string, string> = { Vary: 'Origin' };
  if (origin && allowed.includes(origin)) {
    base['Access-Control-Allow-Origin'] = origin;
    base['Access-Control-Allow-Headers'] = 'authorization, x-client-info, apikey, content-type';
    base['Access-Control-Allow-Methods'] = 'POST, OPTIONS';
  }
  return base;
}

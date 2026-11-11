// Tradução entre o formato do banco (snake_case) e o domínio da interface, e entre erros do
// Supabase e ServiceError (mensagens prontas em português, sem vazar detalhes internos).
import type { ActivityEntry, Membership, PermissionSet, Person, Store } from '@/domain/types';
import { ServiceError } from '../errors';
import type { StoreSummary, TeamStats } from '../types';

export interface PersonRow {
  id: string;
  email: string;
  full_name: string;
  is_general_admin: boolean;
  active?: boolean;
  created_at: string;
}
export interface MembershipRow {
  id: string;
  person_id: string;
  store_id: string;
  role: 'responsavel' | 'funcionario';
  job_title: string;
  permissions: PermissionSet;
  active: boolean;
  created_at: string;
  deactivated_at: string | null;
}
export interface StoreRow {
  id: string;
  name: string;
  code: string;
}
export interface ActivityRow {
  id: string;
  created_at: string;
  actor_id: string | null;
  actor_name: string;
  store_id: string | null;
  store_name: string | null;
  action: ActivityEntry['type'];
  target_person_id: string | null;
  target_person_name: string | null;
  summary: string;
}
export interface TeamStatsRow {
  responsibles: string[];
  active_employees: number;
  inactive_links: number;
}

export const toStore = (r: StoreRow): Store => ({ id: r.id, name: r.name, code: r.code });

export const toPerson = (r: PersonRow): Person => ({
  id: r.id,
  // Conta ainda sem nome (convite sem nome): mostra o e-mail em vez de um texto vazio.
  name: r.full_name?.trim() || r.email,
  email: r.email,
  isGeneralAdmin: r.is_general_admin,
  createdAt: r.created_at,
  active: r.active ?? true,
});

export const toMembership = (r: MembershipRow): Membership => ({
  id: r.id,
  personId: r.person_id,
  storeId: r.store_id,
  role: r.role,
  jobTitle: r.job_title,
  permissions: r.permissions ?? {},
  active: r.active,
  createdAt: r.created_at,
  deactivatedAt: r.deactivated_at,
});

export const toActivity = (r: ActivityRow): ActivityEntry => ({
  id: r.id,
  at: r.created_at,
  storeId: r.store_id,
  storeName: r.store_name,
  actorId: r.actor_id ?? '',
  actorName: r.actor_name,
  type: r.action,
  targetPersonId: r.target_person_id ?? '',
  targetPersonName: r.target_person_name ?? '',
  summary: r.summary,
});

export const toTeamStats = (r: TeamStatsRow): TeamStats => ({
  responsibles: r.responsibles,
  activeEmployees: Number(r.active_employees),
  inactiveLinks: Number(r.inactive_links),
});

export const toStoreSummary = (r: { store: StoreRow; team: TeamStatsRow | null; last_activity_at: string | null }): StoreSummary => ({
  store: toStore(r.store),
  team: r.team ? toTeamStats(r.team) : null,
  lastActivityAt: r.last_activity_at,
});

// ---------------------------------------------------------------------------------------------
// Erros
// ---------------------------------------------------------------------------------------------

export interface RemoteError {
  message?: string;
  code?: string;
  hint?: string | null;
  status?: number;
}

const NETWORK_RE = /failed to fetch|networkerror|load failed|network request failed|fetch failed/i;
const JWT_RE = /jwt (expired|invalid)|invalid jwt|token (is )?expired/i;

export const SESSION_EXPIRED = 'Sua sessão expirou. Entre novamente.';
export const NETWORK_DOWN = 'Sem conexão com o servidor. Verifique a internet e tente novamente.';
const GENERIC = 'Não foi possível concluir a operação. Tente novamente.';

/** Erro de uma chamada ao banco (PostgREST). Os códigos PT4xx são levantados pelas funções SQL. */
export function mapRemoteError(e: RemoteError): ServiceError {
  const code = e.code ?? '';
  const message = e.message ?? '';
  if (code === 'PT401' || code === 'PGRST301' || code === 'PGRST303' || e.status === 401 || JWT_RE.test(message)) {
    return new ServiceError('unauthorized', SESSION_EXPIRED);
  }
  if (code === 'PT403') return new ServiceError('forbidden', message);
  if (code === '42501' || e.status === 403) return new ServiceError('forbidden', 'Você não tem permissão para esta ação.');
  if (code === 'PT404') return new ServiceError('not_found', message);
  if (code === 'PT429') return new ServiceError('unavailable', message); // limite de cadastros por hora
  if (code === 'PT409') return new ServiceError('conflict', message, e.hint ? { [e.hint]: message } : undefined);
  if (code === 'PT422') {
    return e.hint
      ? new ServiceError('validation', 'Revise os campos destacados.', { [e.hint]: message })
      : new ServiceError('validation', message);
  }
  if (NETWORK_RE.test(message)) return new ServiceError('unavailable', NETWORK_DOWN);
  return new ServiceError('unavailable', GENERIC);
}

interface FunctionFailure {
  ok: false;
  code: ServiceError['code'];
  message: string;
  fieldErrors?: Record<string, string>;
}

/** Resposta de erro da Edge Function (mesmos códigos de ServiceError). */
export function fromFunctionBody(body: unknown, status?: number): ServiceError {
  const b = body as Partial<FunctionFailure> | null;
  const codes = ['unauthorized', 'forbidden', 'validation', 'not_found', 'conflict', 'unavailable'] as const;
  if (b && typeof b.message === 'string' && codes.includes(b.code as (typeof codes)[number])) {
    return new ServiceError(b.code as ServiceError['code'], b.message, b.fieldErrors);
  }
  if (status === 401) return new ServiceError('unauthorized', SESSION_EXPIRED);
  return new ServiceError('unavailable', GENERIC);
}

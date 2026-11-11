// Implementação REAL dos serviços sobre Supabase (PostgREST + Edge Functions).
//
// Segurança: nada aqui decide autorização. O servidor deriva a identidade do JWT da sessão
// (o parâmetro `actor` é ignorado de propósito) e aplica RLS + validações nas funções SQL.
// Escritas só ocorrem por RPC; criação de contas/convites só pela Edge Function "invite-member".
import type { SupabaseClient } from '@supabase/supabase-js';
import { ServiceError } from '../errors';
import type { ActivityService, ConsolidatedSummary, OverviewService, PersonOverview, Services, SessionService, TeamMemberRow, TeamService } from '../types';
import { createAuthService } from './auth';
import {
  SESSION_EXPIRED,
  fromFunctionBody,
  mapRemoteError,
  toActivity,
  toMembership,
  toPerson,
  toStore,
  toStoreSummary,
  toTeamStats,
  type ActivityRow,
  type MembershipRow,
  type PersonRow,
  type RemoteError,
  type StoreRow,
  type TeamStatsRow,
} from './mappers';

export interface LiveOptions {
  /** Chamado quando o servidor recusa o JWT (expirado/revogado). */
  onUnauthorized?: () => void;
  /**
   * Chamado quando o servidor responde "proibido". Pode indicar que as permissões da pessoa mudaram
   * (vínculo desativado) e que a interface está desatualizada: o app revalida a sessão.
   */
  onForbidden?: () => void;
}

export function createSupabaseServices(client: SupabaseClient, options: LiveOptions = {}): Services {
  /** Executa uma chamada, converte erros e avisa quando a sessão deixou de valer. */
  async function run<T>(call: () => PromiseLike<{ data: T | null; error: RemoteError | null; status?: number }>): Promise<T> {
    let result;
    try {
      result = await call();
    } catch (e) {
      throw mapThrown(e);
    }
    if (result.error) throw notify(mapRemoteError({ ...result.error, status: result.error.status ?? result.status }));
    return result.data as T;
  }
  function notify(err: ServiceError): ServiceError {
    if (err.code === 'unauthorized') options.onUnauthorized?.();
    else if (err.code === 'forbidden') options.onForbidden?.();
    return err;
  }
  const mapThrown = (e: unknown) => notify(mapRemoteError({ message: e instanceof Error ? e.message : String(e) }));
  const rpc = <T,>(fn: string, args?: Record<string, unknown>) => run<T>(() => client.rpc(fn, args) as unknown as PromiseLike<{ data: T | null; error: RemoteError | null }>);

  async function currentUserId(): Promise<string> {
    const { data } = await client.auth.getSession();
    if (!data.session) throw notify(new ServiceError('unauthorized', SESSION_EXPIRED));
    return data.session.user.id;
  }

  const session: SessionService = {
    async loadSnapshot() {
      const uid = await currentUserId();
      const profile = await run<PersonRow | null>(() => client.from('profiles').select('*').eq('id', uid).maybeSingle() as never);
      // RLS só devolve a própria conta quando ela está ATIVA.
      if (!profile) {
        throw new ServiceError('forbidden', 'Sua conta está desativada ou ainda não foi liberada. Procure o administrador geral.');
      }
      const [stores, memberships] = await Promise.all([
        run<StoreRow[]>(() => client.from('stores').select('id, name, code').order('name') as never),
        run<MembershipRow[]>(() => client.from('memberships').select('*').eq('person_id', uid).eq('active', true) as never),
      ]);
      return {
        person: toPerson(profile),
        stores: (stores ?? []).map(toStore),
        memberships: profile.is_general_admin ? [] : (memberships ?? []).map(toMembership),
      };
    },
  };

  const team: TeamService = {
    async listStoreMembers(_actor, storeId): Promise<TeamMemberRow[]> {
      const rows = await rpc<{ membership: MembershipRow; person: PersonRow; active_store_count: number | null }[]>('list_store_members', { p_store_id: storeId });
      return (rows ?? []).map((r) => ({
        membership: toMembership(r.membership),
        person: toPerson(r.person),
        ...(r.active_store_count !== null ? { activeStoreCount: Number(r.active_store_count) } : {}),
      }));
    },

    async listAllPeople(): Promise<PersonOverview[]> {
      const rows = await rpc<{ person: PersonRow; links: { membership: MembershipRow; store_name: string }[] }[]>('list_all_people');
      return (rows ?? []).map((r) => ({
        person: toPerson(r.person),
        links: r.links.map((l) => ({ membership: toMembership(l.membership), storeName: l.store_name })),
      }));
    },

    async createMember(_actor, storeId, input) {
      // Criação de conta/convite exige a chave privilegiada, que só existe na Edge Function.
      let result;
      try {
        result = await client.functions.invoke('invite-member', {
          body: { storeId, email: input.email, name: input.name, jobTitle: input.jobTitle, role: input.role, permissions: input.permissions },
        });
      } catch (e) {
        throw mapThrown(e);
      }
      if (!result.error) return;
      const ctx = (result.error as { context?: unknown }).context;
      if (ctx instanceof Response) {
        let body: unknown = null;
        try {
          body = await ctx.json();
        } catch {
          /* corpo ilegível */
        }
        throw notify(fromFunctionBody(body, ctx.status));
      }
      throw mapThrown(result.error);
    },

    async updateMember(_actor, membershipId, input) {
      await rpc('update_membership', {
        p_membership_id: membershipId,
        p_job_title: input.jobTitle,
        p_role: input.role,
        p_permissions: input.permissions,
        // O servidor só aceita nome vindo do administrador geral, na mesma transação.
        p_account_name: input.name ?? null,
      });
    },

    async setMemberActive(_actor, membershipId, active) {
      await rpc('set_membership_active', { p_membership_id: membershipId, p_active: active });
    },

    async setGeneralAdmin(_actor, personId, value) {
      await rpc('set_general_admin', { p_person_id: personId, p_value: value });
    },

    async setAccountActive(_actor, personId, active) {
      await rpc('set_account_active', { p_person_id: personId, p_active: active });
    },
  };

  const activity: ActivityService = {
    async list(_actor, query) {
      let q = client.from('audit_log').select('*').order('seq', { ascending: false }).limit(500);
      if (query.storeId !== null) q = q.eq('store_id', query.storeId);
      const rows = await run<ActivityRow[]>(() => q as never);
      return (rows ?? []).map(toActivity);
    },
  };

  const overview: OverviewService = {
    async storeSummary(_actor, storeId) {
      const r = await rpc<{ store: StoreRow; team: TeamStatsRow | null; last_activity_at: string | null }>('store_summary', { p_store_id: storeId });
      return toStoreSummary(r);
    },

    async consolidatedSummary(): Promise<ConsolidatedSummary> {
      const r = await rpc<{
        stores: { store: StoreRow; team: TeamStatsRow; last_activity_at: string | null }[];
        people_with_access: number;
        active_links: number;
        inactive_links: number;
      }>('consolidated_summary');
      return {
        stores: r.stores.map((s) => ({ store: toStore(s.store), team: toTeamStats(s.team), lastActivityAt: s.last_activity_at })),
        peopleWithAccess: Number(r.people_with_access),
        activeLinks: Number(r.active_links),
        inactiveLinks: Number(r.inactive_links),
      };
    },
  };

  return { session, team, activity, overview, auth: createAuthService(client) };
}

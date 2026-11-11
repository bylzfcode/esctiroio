// Implementação FICTÍCIA dos serviços: guarda tudo no localStorage do navegador.
// Substitui o backend nesta etapa. As regras de autorização estão aqui apenas para
// demonstrar o comportamento esperado; num backend real elas precisam rodar no servidor.

import {
  accessibleStores,
  can,
  canActOnMembership,
  canManageTeam,
  resolveAccess,
  type AccessContext,
} from '@/domain/access';
import { describeChange, changesBeyondActor, diffPermissions, normalizePermissions } from '@/domain/permissions';
import { ROLE_LABEL } from '@/domain/modules';
import type { ActivityEntry, ActivityType, Membership, Person, Store } from '@/domain/types';
import { ServiceError } from '../errors';
import type {
  AccountLookup,
  Actor,
  ConsolidatedSummary,
  DemoProfile,
  MemberInput,
  MemberUpdate,
  PersonOverview,
  Services,
  SessionSnapshot,
  StoreSummary,
  TeamMemberRow,
  TeamStats,
} from '../types';
import { createSeed, type DemoData } from './seed';

export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface MockBackendOptions {
  /** Onde guardar os dados fictícios. null = apenas em memória. */
  storage?: KeyValueStorage | null;
  /** Atraso simulado [mín, máx] em ms, para exercitar os estados de carregamento. */
  latencyMs?: [number, number];
  now?: () => Date;
}

export const DATA_KEY = 'esctiroio.demo.dados.v1';

const PROFILE_HINTS: Record<string, string> = {
  'p-ana': 'Alterne entre a visão consolidada e cada loja.',
  'p-bruno': 'Responsável em uma loja: gerencia os funcionários dela.',
  'p-diego': 'Responsável em duas lojas (Gama e Delta).',
  'p-carla': 'Responsável na Loja Beta e funcionária na Loja Gama: o menu muda ao trocar de loja.',
  'p-igor': 'Funcionário em duas lojas, com permissões diferentes em cada uma.',
  'p-marcos': 'Vínculo desativado na Loja Alfa: só a Loja Delta aparece.',
  'p-fabio': 'Funcionário que pode apenas consultar a equipe.',
  'p-patricia': 'Todos os vínculos desativados: sem acesso a nenhuma loja.',
};

const normEmail = (e: string) => e.trim().toLowerCase();
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const uid = (prefix: string) => `${prefix}-${Math.random().toString(36).slice(2, 8)}${Date.now().toString(36)}`;

function isDemoData(v: unknown): v is DemoData {
  const d = v as DemoData | null;
  return !!d && Array.isArray(d.stores) && Array.isArray(d.persons) && Array.isArray(d.memberships) && Array.isArray(d.activity);
}

export function createMockServices(options: MockBackendOptions = {}): Services {
  const storage = options.storage === undefined ? safeLocalStorage() : options.storage;
  const latency = options.latencyMs ?? [180, 420];
  const now = options.now ?? (() => new Date());
  let simulateFailure = false;

  function load(): DemoData {
    try {
      const raw = storage?.getItem(DATA_KEY);
      if (raw) {
        const parsed: unknown = JSON.parse(raw);
        if (isDemoData(parsed)) return parsed;
      }
    } catch {
      /* dados corrompidos ou storage indisponível: volta ao padrão */
    }
    return createSeed(now());
  }

  let data = load();

  function save() {
    try {
      storage?.setItem(DATA_KEY, JSON.stringify(data));
    } catch {
      /* sem persistência (modo privado, cota): o app segue funcionando em memória */
    }
  }

  const wait = () =>
    new Promise<void>((resolve) => {
      const [min, max] = latency;
      const ms = max <= 0 ? 0 : min + Math.random() * (max - min);
      setTimeout(resolve, ms);
    });

  async function begin(listing = false) {
    await wait();
    if (listing && simulateFailure) {
      throw new ServiceError('unavailable', 'Não foi possível carregar os dados. Verifique a conexão e tente novamente.');
    }
  }

  // ----- auxiliares de autorização (sempre a partir do estado do "servidor", nunca do cliente) -----

  function actorPerson(actor: Actor): Person {
    const p = data.persons.find((x) => x.id === actor.personId);
    if (!p) throw new ServiceError('forbidden', 'Sessão inválida. Escolha um perfil novamente.');
    return p;
  }

  function storeAccess(actor: Actor, storeId: string): { person: Person; access: AccessContext; store: Store } {
    const person = actorPerson(actor);
    const store = data.stores.find((s) => s.id === storeId);
    if (!store) throw new ServiceError('not_found', 'Loja não encontrada.');
    const access = resolveAccess(person, data.memberships, { kind: 'store', storeId });
    return { person, access, store };
  }

  function requireAdmin(actor: Actor): Person {
    const person = actorPerson(actor);
    if (!person.isGeneralAdmin) {
      throw new ServiceError('forbidden', 'Esta visão é exclusiva do administrador geral.');
    }
    return person;
  }

  function log(
    storeId: string,
    actor: Person,
    type: ActivityType,
    target: Person,
    summary: string,
  ) {
    const store = data.stores.find((s) => s.id === storeId);
    const entry: ActivityEntry = {
      id: uid('a'),
      at: now().toISOString(),
      storeId,
      storeName: store?.name ?? storeId,
      actorId: actor.id,
      actorName: actor.name,
      type,
      targetPersonId: target.id,
      targetPersonName: target.name,
      summary,
    };
    data.activity.push(entry);
  }

  const storeName = (id: string) => data.stores.find((s) => s.id === id)?.name ?? id;

  function teamStats(storeId: string): TeamStats {
    const links = data.memberships.filter((m) => m.storeId === storeId);
    const name = (id: string) => data.persons.find((p) => p.id === id)?.name ?? id;
    return {
      responsibles: links.filter((m) => m.active && m.role === 'responsavel').map((m) => name(m.personId)),
      activeEmployees: links.filter((m) => m.active && m.role === 'funcionario').length,
      inactiveLinks: links.filter((m) => !m.active).length,
    };
  }

  function lastActivity(storeId: string): string | null {
    return data.activity.filter((a) => a.storeId === storeId).map((a) => a.at).sort().pop() ?? null;
  }

  // ----- serviços -----

  const session: Services['session'] = {
    async listDemoProfiles() {
      await begin();
      const profiles: DemoProfile[] = data.persons.map((person) => {
        const links = data.memberships.filter((m) => m.personId === person.id && m.active);
        let kind: DemoProfile['kind'] = 'sem_acesso';
        if (person.isGeneralAdmin) kind = 'admin';
        else if (links.some((l) => l.role === 'responsavel')) kind = 'responsavel';
        else if (links.length) kind = 'funcionario';
        const summary = person.isGeneralAdmin
          ? 'Administrador geral · todas as lojas'
          : links.length
            ? links.map((l) => `${ROLE_LABEL[l.role]} · ${storeName(l.storeId)}`).join(' | ')
            : 'Sem vínculos ativos';
        return { person, kind, summary, hint: PROFILE_HINTS[person.id] ?? '', activeLinks: links.length };
      });
      return clone(profiles);
    },

    async loadSnapshot(actor): Promise<SessionSnapshot> {
      await begin();
      const person = actorPerson(actor);
      const stores = accessibleStores(person, data.memberships, data.stores);
      const memberships = person.isGeneralAdmin
        ? []
        : data.memberships.filter((m) => m.personId === person.id && m.active);
      return clone({ person, stores, memberships });
    },
  };

  const team: Services['team'] = {
    async listStoreMembers(actor, storeId): Promise<TeamMemberRow[]> {
      await begin(true);
      const { person, access } = storeAccess(actor, storeId);
      if (!can(access, 'team', 'view')) throw new ServiceError('forbidden', 'Você não tem permissão para ver a equipe desta loja.');
      const rows = data.memberships
        .filter((m) => m.storeId === storeId)
        .map((membership) => {
          const p = data.persons.find((x) => x.id === membership.personId)!;
          const row: TeamMemberRow = { membership, person: p };
          if (person.isGeneralAdmin) {
            row.activeStoreCount = data.memberships.filter((m) => m.personId === p.id && m.active).length;
          }
          return row;
        })
        .sort(
          (a, b) =>
            Number(b.membership.active) - Number(a.membership.active) ||
            (a.membership.role === b.membership.role ? 0 : a.membership.role === 'responsavel' ? -1 : 1) ||
            a.person.name.localeCompare(b.person.name, 'pt-BR'),
        );
      return clone(rows);
    },

    async listAllPeople(actor): Promise<PersonOverview[]> {
      await begin(true);
      requireAdmin(actor);
      return clone(
        data.persons
          .map((person) => ({
            person,
            links: data.memberships
              .filter((m) => m.personId === person.id)
              .map((membership) => ({ membership, storeName: storeName(membership.storeId) })),
          }))
          .sort((a, b) => a.person.name.localeCompare(b.person.name, 'pt-BR')),
      );
    },

    async lookupAccount(actor, storeId, email): Promise<AccountLookup> {
      await begin();
      const { access } = storeAccess(actor, storeId);
      if (!canManageTeam(access, 'create')) throw new ServiceError('forbidden', 'Você não pode cadastrar pessoas nesta loja.');
      const found = data.persons.find((p) => normEmail(p.email) === normEmail(email));
      if (!found) return { exists: false };
      const link = data.memberships.find((m) => m.personId === found.id && m.storeId === storeId);
      return {
        exists: true,
        name: found.name,
        isGeneralAdmin: found.isGeneralAdmin,
        linkStatus: link ? (link.active ? 'ativo' : 'inativo') : undefined,
      };
    },

    async createMember(actor, storeId, input: MemberInput): Promise<Membership> {
      await begin();
      const { person: actorP, access, store } = storeAccess(actor, storeId);
      if (!canManageTeam(access, 'create')) {
        throw new ServiceError('forbidden', 'Você não tem permissão para cadastrar pessoas nesta loja.');
      }
      if (input.role !== 'funcionario' && access.role !== 'admin_geral') {
        throw new ServiceError('forbidden', 'Responsáveis só podem cadastrar funcionários.');
      }

      const email = normEmail(input.email);
      const errors: Record<string, string> = {};
      if (!EMAIL_RE.test(email)) errors.email = 'Informe um e-mail válido.';
      if (input.jobTitle.trim().length > 60) errors.jobTitle = 'Use no máximo 60 caracteres.';

      const existing = data.persons.find((p) => normEmail(p.email) === email);
      if (existing?.isGeneralAdmin) {
        errors.email = 'Administradores gerais já acessam todas as lojas e não precisam de vínculo.';
      }
      const link = existing && data.memberships.find((m) => m.personId === existing.id && m.storeId === storeId);
      if (link?.active) errors.email = 'Esta pessoa já está vinculada à loja.';
      else if (link) errors.email = 'Esta pessoa tem um vínculo desativado nesta loja. Reative-o na lista de inativos.';
      if (!existing && (input.name ?? '').trim().length < 2) errors.name = 'Informe o nome da pessoa.';

      const permissions = normalizePermissions(input.permissions, input.role);
      if (!Object.keys(permissions).length) {
        errors.permissions = 'Libere ao menos um módulo (visualizar) para que a pessoa consiga acessar a loja.';
      } else if (changesBeyondActor(access.permissions, {}, permissions).length) {
        throw new ServiceError('forbidden', 'Você não pode conceder permissões que você mesmo não possui.');
      }
      if (Object.keys(errors).length) throw new ServiceError('validation', 'Revise os campos destacados.', errors);

      const stamp = now().toISOString();
      let target = existing;
      if (!target) {
        target = { id: uid('p'), name: (input.name ?? '').trim(), email, isGeneralAdmin: false, createdAt: stamp };
        data.persons.push(target);
        log(storeId, actorP, 'conta_criada', target, `Conta de ${target.name} criada durante o cadastro na ${store.name}.`);
      }
      const membership: Membership = {
        id: uid('v'),
        personId: target.id,
        storeId,
        role: input.role,
        jobTitle: input.jobTitle.trim(),
        permissions,
        active: true,
        createdAt: stamp,
        deactivatedAt: null,
      };
      data.memberships.push(membership);
      const cargo = membership.jobTitle ? ` (${membership.jobTitle})` : '';
      log(
        storeId,
        actorP,
        'vinculo_criado',
        target,
        `Vínculo de ${target.name} com a ${store.name} criado como ${ROLE_LABEL[input.role].toLowerCase()}${cargo}.`,
      );
      save();
      return clone(membership);
    },

    async updateMember(actor, membershipId, input: MemberUpdate): Promise<Membership> {
      await begin();
      const target = data.memberships.find((m) => m.id === membershipId);
      if (!target) throw new ServiceError('not_found', 'Vínculo não encontrado.');
      const { person: actorP, access } = storeAccess(actor, target.storeId);
      assertCanActOn(access, actorP, target, 'edit');
      if (!target.active) throw new ServiceError('conflict', 'Reative o vínculo antes de editá-lo.');
      if (input.role !== target.role && access.role !== 'admin_geral') {
        throw new ServiceError('forbidden', 'Somente o administrador geral pode alterar o perfil de um vínculo.');
      }
      if (input.jobTitle.trim().length > 60) {
        throw new ServiceError('validation', 'Revise os campos destacados.', { jobTitle: 'Use no máximo 60 caracteres.' });
      }

      const permissions = normalizePermissions(input.permissions, input.role);
      if (!Object.keys(permissions).length) {
        throw new ServiceError('validation', 'Revise os campos destacados.', {
          permissions: 'Libere ao menos um módulo (visualizar) para que a pessoa consiga acessar a loja.',
        });
      }
      if (changesBeyondActor(access.permissions, target.permissions, permissions).length) {
        throw new ServiceError('forbidden', 'Você não pode conceder nem retirar permissões que você mesmo não possui.');
      }

      const person = data.persons.find((p) => p.id === target.personId)!;
      const newName = input.name?.trim();
      if (newName !== undefined && newName !== person.name) {
        if (access.role !== 'admin_geral') {
          throw new ServiceError('forbidden', 'Somente o administrador geral pode alterar dados da conta.');
        }
        if (newName.length < 2) throw new ServiceError('validation', 'Revise os campos destacados.', { name: 'Informe o nome da pessoa.' });
      }

      const changes = diffPermissions(target.permissions, permissions);
      const jobTitle = input.jobTitle.trim();
      const profileChanges: string[] = [];
      if (jobTitle !== target.jobTitle) profileChanges.push(jobTitle ? `cargo alterado para ${jobTitle}` : 'cargo removido');
      if (input.role !== target.role) profileChanges.push(`perfil alterado para ${ROLE_LABEL[input.role].toLowerCase()}`);
      const previousName = person.name;
      if (newName && newName !== previousName) {
        person.name = newName;
        profileChanges.push(`nome da conta alterado de ${previousName} para ${newName}`);
      }

      target.jobTitle = jobTitle;
      target.role = input.role;
      target.permissions = permissions;

      if (profileChanges.length) {
        const text = profileChanges.join('; ');
        log(target.storeId, actorP, 'vinculo_editado', person, text.charAt(0).toUpperCase() + text.slice(1) + '.');
      }
      if (changes.length) {
        log(target.storeId, actorP, 'permissoes_alteradas', person, changes.map(describeChange).join('; ') + '.');
      }
      if (profileChanges.length || changes.length) save();
      return clone(target);
    },

    async setMemberActive(actor, membershipId, active): Promise<Membership> {
      await begin();
      const target = data.memberships.find((m) => m.id === membershipId);
      if (!target) throw new ServiceError('not_found', 'Vínculo não encontrado.');
      const { person: actorP, access, store } = storeAccess(actor, target.storeId);
      assertCanActOn(access, actorP, target, active ? 'edit' : 'delete');
      if (target.active === active) return clone(target);

      const person = data.persons.find((p) => p.id === target.personId)!;
      target.active = active;
      target.deactivatedAt = active ? null : now().toISOString();
      // Somente este vínculo muda: a conta e os vínculos com outras lojas permanecem intactos.
      log(
        target.storeId,
        actorP,
        active ? 'vinculo_reativado' : 'vinculo_desativado',
        person,
        `Vínculo de ${person.name} com a ${store.name} ${active ? 'reativado' : 'desativado'}.`,
      );
      save();
      return clone(target);
    },
  };

  function assertCanActOn(access: AccessContext, actorP: Person, target: Membership, action: 'edit' | 'delete') {
    if (!canManageTeam(access, action)) {
      throw new ServiceError('forbidden', 'Você não tem permissão para esta ação na equipe desta loja.');
    }
    if (!canActOnMembership(access, actorP.id, target)) {
      throw new ServiceError(
        'forbidden',
        target.personId === actorP.id
          ? 'Você não pode alterar o seu próprio vínculo.'
          : 'Responsáveis não podem alterar outros responsáveis.',
      );
    }
  }

  const activity: Services['activity'] = {
    async list(actor, query) {
      await begin(true);
      let entries: ActivityEntry[];
      if (query.storeId === null) {
        requireAdmin(actor);
        entries = data.activity;
      } else {
        const { access } = storeAccess(actor, query.storeId);
        if (!can(access, 'activity', 'view')) {
          throw new ServiceError('forbidden', 'Você não tem permissão para ver o histórico desta loja.');
        }
        entries = data.activity.filter((a) => a.storeId === query.storeId);
      }
      return clone([...entries].sort((a, b) => b.at.localeCompare(a.at)));
    },
  };

  const overview: Services['overview'] = {
    async storeSummary(actor, storeId): Promise<StoreSummary> {
      await begin(true);
      const { access, store } = storeAccess(actor, storeId);
      if (!can(access, 'overview', 'view')) throw new ServiceError('forbidden', 'Você não tem acesso à visão geral desta loja.');
      return clone({
        store,
        team: can(access, 'team', 'view') ? teamStats(storeId) : null,
        lastActivityAt: can(access, 'activity', 'view') ? lastActivity(storeId) : null,
      });
    },

    async consolidatedSummary(actor): Promise<ConsolidatedSummary> {
      await begin(true);
      requireAdmin(actor);
      const links = data.memberships;
      return clone({
        stores: data.stores.map((store) => ({
          store,
          team: teamStats(store.id),
          lastActivityAt: lastActivity(store.id),
        })),
        peopleWithAccess: new Set(links.filter((m) => m.active).map((m) => m.personId)).size,
        activeLinks: links.filter((m) => m.active).length,
        inactiveLinks: links.filter((m) => !m.active).length,
      });
    },
  };

  const demo: Services['demo'] = {
    async resetData() {
      await wait();
      data = createSeed(now());
      try {
        storage?.removeItem(DATA_KEY);
      } catch {
        /* ignorar */
      }
    },
    setSimulateFailure(enabled) {
      simulateFailure = enabled;
    },
    isSimulatingFailure: () => simulateFailure,
  };

  return { session, team, activity, overview, demo };
}

function safeLocalStorage(): KeyValueStorage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

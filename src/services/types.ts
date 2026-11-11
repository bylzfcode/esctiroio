// Contratos da camada de serviços.
// A interface do app só conhece estes contratos. Para ligar um backend real, crie uma
// implementação de `Services` (por exemplo com fetch) e troque-a em `services/index.ts`.
// Toda regra de autorização precisa ser reaplicada NO SERVIDOR: as verificações feitas
// no navegador servem apenas para orientar a interface.

import type { ActivityEntry, Membership, PermissionSet, Person, Store, StoreRole } from '@/domain/types';

/** Quem está agindo. Na demonstração vem do seletor de perfil; em produção virá da sessão autenticada. */
export interface Actor {
  personId: string;
}

export interface DemoProfile {
  person: Person;
  kind: 'admin' | 'responsavel' | 'funcionario' | 'sem_acesso';
  /** Resumo textual dos vínculos, apenas para o seletor de demonstração. */
  summary: string;
  /** Sugestão do que testar com este perfil. */
  hint: string;
  activeLinks: number;
}

export interface SessionSnapshot {
  person: Person;
  /** Lojas selecionáveis (todas para o administrador geral). */
  stores: Store[];
  /** Vínculos ATIVOS da própria pessoa (vazio para o administrador geral). */
  memberships: Membership[];
}

export interface TeamMemberRow {
  membership: Membership;
  person: Person;
  /** Só preenchido para o administrador geral. */
  activeStoreCount?: number;
}

export interface PersonOverview {
  person: Person;
  links: { membership: Membership; storeName: string }[];
}

export interface MemberInput {
  email: string;
  /** Obrigatório apenas quando a conta ainda não existe. */
  name?: string;
  jobTitle: string;
  role: StoreRole;
  permissions: PermissionSet;
}

export interface MemberUpdate {
  jobTitle: string;
  role: StoreRole;
  permissions: PermissionSet;
  /** Somente administrador geral pode alterar o nome da conta. */
  name?: string;
}

export interface AccountLookup {
  exists: boolean;
  name?: string;
  isGeneralAdmin?: boolean;
  /** Já existe vínculo (ativo ou inativo) com a loja informada. */
  linkStatus?: 'ativo' | 'inativo';
}

export interface TeamStats {
  responsibles: string[];
  activeEmployees: number;
  inactiveLinks: number;
}

export interface StoreSummary {
  store: Store;
  /** null quando quem consulta não tem "visualizar" em Equipe e permissões. */
  team: TeamStats | null;
  /** null quando não há registros ou quem consulta não pode ver o histórico. */
  lastActivityAt: string | null;
}

export interface ConsolidatedStoreSummary extends Omit<StoreSummary, 'team'> {
  team: TeamStats;
}

export interface ConsolidatedSummary {
  stores: ConsolidatedStoreSummary[];
  peopleWithAccess: number;
  activeLinks: number;
  inactiveLinks: number;
}

export interface ActivityQuery {
  /** null = todas as lojas (somente administrador geral). */
  storeId: string | null;
}

export interface SessionService {
  listDemoProfiles(): Promise<DemoProfile[]>;
  loadSnapshot(actor: Actor): Promise<SessionSnapshot>;
}

export interface TeamService {
  listStoreMembers(actor: Actor, storeId: string): Promise<TeamMemberRow[]>;
  listAllPeople(actor: Actor): Promise<PersonOverview[]>;
  lookupAccount(actor: Actor, storeId: string, email: string): Promise<AccountLookup>;
  createMember(actor: Actor, storeId: string, input: MemberInput): Promise<Membership>;
  updateMember(actor: Actor, membershipId: string, input: MemberUpdate): Promise<Membership>;
  setMemberActive(actor: Actor, membershipId: string, active: boolean): Promise<Membership>;
}

export interface ActivityService {
  list(actor: Actor, query: ActivityQuery): Promise<ActivityEntry[]>;
}

export interface OverviewService {
  storeSummary(actor: Actor, storeId: string): Promise<StoreSummary>;
  consolidatedSummary(actor: Actor): Promise<ConsolidatedSummary>;
}

/** Utilidades que só existem na demonstração. Um backend real não implementa isto. */
export interface DemoControls {
  resetData(): Promise<void>;
  setSimulateFailure(enabled: boolean): void;
  isSimulatingFailure(): boolean;
}

export interface Services {
  session: SessionService;
  team: TeamService;
  activity: ActivityService;
  overview: OverviewService;
  demo: DemoControls;
}

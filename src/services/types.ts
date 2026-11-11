// Contratos da camada de serviços.
// A interface do app só conhece estes contratos. Existem duas implementações:
//  * services/supabase: backend real (Supabase Auth + PostgreSQL com RLS);
//  * services/mock: demonstração com dados fictícios no navegador (somente no modo "demo").
//
// Toda regra de autorização é aplicada NO SERVIDOR (RLS e funções do banco). As verificações
// feitas no navegador (menus, botões desabilitados) servem apenas para orientar a interface.

import type { ActivityEntry, Membership, PermissionSet, Person, Store, StoreRole } from '@/domain/types';

/**
 * Quem está agindo. No modo demo vem do seletor de perfil. No backend real é IGNORADO:
 * o servidor usa a identidade do JWT da sessão autenticada (um cliente nunca escolhe quem é).
 */
export interface Actor {
  personId: string;
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
  /** Sempre exigido. Só é usado se a pessoa ainda não tiver conta (não revelamos se tem). */
  name: string;
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
  loadSnapshot(actor: Actor): Promise<SessionSnapshot>;
}

export interface TeamService {
  listStoreMembers(actor: Actor, storeId: string): Promise<TeamMemberRow[]>;
  /** Somente administrador geral. */
  listAllPeople(actor: Actor): Promise<PersonOverview[]>;
  /**
   * Vincula uma pessoa à loja. Se o e-mail já tiver conta, a identidade é reaproveitada e só o
   * vínculo é criado; senão a pessoa recebe um convite. O resultado é o mesmo nos dois casos.
   */
  createMember(actor: Actor, storeId: string, input: MemberInput): Promise<void>;
  updateMember(actor: Actor, membershipId: string, input: MemberUpdate): Promise<void>;
  setMemberActive(actor: Actor, membershipId: string, active: boolean): Promise<void>;
  /** Somente administrador geral. O servidor impede remover o último administrador ativo. */
  setGeneralAdmin(actor: Actor, personId: string, value: boolean): Promise<void>;
  /** Somente administrador geral. Conta desativada perde o acesso a todas as lojas. */
  setAccountActive(actor: Actor, personId: string, active: boolean): Promise<void>;
}

export interface ActivityService {
  list(actor: Actor, query: ActivityQuery): Promise<ActivityEntry[]>;
}

export interface OverviewService {
  storeSummary(actor: Actor, storeId: string): Promise<StoreSummary>;
  consolidatedSummary(actor: Actor): Promise<ConsolidatedSummary>;
}

export interface AuthSession {
  userId: string;
  email: string;
}

export type AuthEvent =
  | { type: 'signed_in'; userId: string }
  | { type: 'signed_out'; reason: 'user' | 'expired' }
  | { type: 'password_recovery' };

/** Autenticação real. Não existe cadastro público: contas nascem por convite. */
export interface AuthService {
  getSession(): Promise<AuthSession | null>;
  subscribe(listener: (event: AuthEvent) => void): () => void;
  signIn(email: string, password: string): Promise<void>;
  signOut(): Promise<void>;
  /** Resposta sempre genérica: nunca revela se o e-mail existe. */
  requestPasswordReset(email: string): Promise<void>;
  /** Define a senha (após convite ou recuperação) da sessão atual. */
  updatePassword(newPassword: string): Promise<void>;
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

/** Utilidades que só existem no modo demo. O backend real NÃO as implementa. */
export interface DemoControls {
  listProfiles(): Promise<DemoProfile[]>;
  resetData(): Promise<void>;
  setSimulateFailure(enabled: boolean): void;
  isSimulatingFailure(): boolean;
}

export interface Services {
  session: SessionService;
  team: TeamService;
  activity: ActivityService;
  overview: OverviewService;
  /** Presente apenas no backend real. */
  auth?: AuthService;
  /** Presente apenas no modo demo. */
  demo?: DemoControls;
}

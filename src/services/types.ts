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

// ---------------------------------------------------------------------------------------------
// Financeiro (contas exclusivas de uma loja e suas liquidações). Valores em CENTAVOS (BRL), datas 'AAAA-MM-DD'
// sem fuso. Saldo, situação e atraso são calculados no SERVIDOR. A identidade é a da sessão autenticada.
// ---------------------------------------------------------------------------------------------
export type FinanceKind = 'payable' | 'receivable';
export type FinanceSituation = 'pending' | 'partial' | 'paid' | 'canceled';
export type PaymentMethod = 'pix' | 'dinheiro' | 'transferencia' | 'boleto' | 'cartao_debito' | 'cartao_credito' | 'cheque' | 'outro';

export interface FinanceAccount {
  id: string;
  storeId: string;
  storeName: string;
  kind: FinanceKind;
  description: string;
  category: string;
  counterparty: string;
  amountCents: number;
  currency: 'BRL';
  competenceDate: string;
  dueDate: string;
  notes: string;
  status: 'open' | 'canceled';
  situation: FinanceSituation;
  /** Vencimento anterior a hoje (America/Sao_Paulo) E saldo em aberto. Calculado no servidor. */
  isOverdue: boolean;
  settledCents: number;
  balanceCents: number;
  paymentsCount: number;
  /** Comprovantes anexados cujo envio ainda não foi confirmado. */
  receiptsPending: number;
  createdByName: string | null;
  createdAt: string;
}

export interface FinancePayment {
  id: string;
  amountCents: number;
  paidOn: string;
  method: PaymentMethod;
  notes: string;
  createdByName: string;
  createdAt: string;
  reversedAt: string | null;
  reversedByName: string | null;
  reversalReason: string | null;
  receipt: { path: string; name: string; mime: string; size: number; attachedAt: string; attachedByName: string | null } | null;
  /** Confirmação MANUAL de envio do comprovante (o sistema não envia mensagens). */
  receiptSent: { at: string; byName: string | null; note: string | null } | null;
}

export interface FinanceAccountDetail {
  account: FinanceAccount & { canceledAt: string | null; canceledByName: string | null; cancelReason: string | null; updatedAt: string };
  payments: FinancePayment[];
}

export interface FinanceFilters {
  kind?: FinanceKind;
  /** 'open' = pendente + parcial. */
  status?: 'open' | FinanceSituation;
  competenceFrom?: string;
  competenceTo?: string;
  dueFrom?: string;
  dueTo?: string;
  search?: string;
  overdueOnly?: boolean;
  receiptPending?: boolean;
}

export interface FinanceBucket {
  count: number;
  amountCents: number;
  settledCents: number;
  /** Saldo das contas pendentes ou parciais. */
  openCents: number;
  /** Saldo em atraso. */
  overdueCents: number;
  overdueCount: number;
}

export interface FinanceSummary {
  /** Dia civil de São Paulo usado no cálculo de atraso. */
  today: string;
  payable: FinanceBucket;
  receivable: FinanceBucket;
  canceledCount: number;
  receiptsPendingCount: number;
  /** Só na visão consolidada. O total é a soma destas linhas: cada conta é contada uma vez. */
  byStore: { storeId: string; storeName: string; payable: FinanceBucket; receivable: FinanceBucket }[] | null;
}

export interface FinanceHistoryEntry {
  id: string;
  at: string;
  actorName: string;
  action: string;
  summary: string;
}

export interface FinanceAccountInput {
  kind: FinanceKind;
  description: string;
  category: string;
  counterparty: string;
  amountCents: number;
  competenceDate: string;
  dueDate: string;
  notes: string;
  /** Mesma chave = mesma requisição: repetir não duplica a conta. */
  idempotencyKey?: string;
}

export interface PaymentInput {
  amountCents: number;
  paidOn: string;
  method: PaymentMethod;
  notes: string;
  /** Gerada uma vez por tentativa de confirmação; repetir/clicar duas vezes não duplica o pagamento. */
  idempotencyKey: string;
}

/** Erro ao enviar/vincular o comprovante DEPOIS de o pagamento já estar salvo (não repetir o pagamento). */
export class ReceiptUploadError extends Error {
  constructor(
    message: string,
    readonly stage: 'upload' | 'attach',
  ) {
    super(message);
    this.name = 'ReceiptUploadError';
  }
}

export interface FinanceService {
  /** storeId nulo = visão consolidada (somente administrador geral). */
  list(storeId: string | null, filters: FinanceFilters, page: { limit: number; offset: number }): Promise<{ rows: FinanceAccount[]; total: number }>;
  summary(storeId: string | null, filters: FinanceFilters): Promise<FinanceSummary>;
  get(accountId: string): Promise<FinanceAccountDetail>;
  history(accountId: string): Promise<FinanceHistoryEntry[]>;
  createAccount(storeId: string, input: FinanceAccountInput): Promise<string>;
  updateAccount(accountId: string, input: Omit<FinanceAccountInput, 'kind' | 'idempotencyKey'>): Promise<void>;
  cancelAccount(accountId: string, reason: string): Promise<void>;
  confirmPayment(accountId: string, input: PaymentInput): Promise<string>;
  reversePayment(paymentId: string, reason: string): Promise<void>;
  /** Envia o arquivo ao armazenamento privado e o vincula à liquidação. Lança ReceiptUploadError. NÃO confirma envio. */
  attachReceipt(payment: { id: string; storeId: string; accountId: string }, file: File): Promise<void>;
  /** Link temporário (assinado) para ver ou baixar; só para quem pode visualizar o financeiro da loja. */
  receiptUrl(path: string, opts?: { download?: string }): Promise<string>;
  confirmReceiptSent(paymentId: string, note?: string): Promise<void>;
}

export interface Services {
  session: SessionService;
  team: TeamService;
  activity: ActivityService;
  overview: OverviewService;
  /** Presente apenas no backend real. O financeiro NÃO é simulado na demonstração. */
  finance?: FinanceService;
  /** Presente apenas no backend real. */
  auth?: AuthService;
  /** Presente apenas no modo demo. */
  demo?: DemoControls;
}

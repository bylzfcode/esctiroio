// Tipos centrais do domínio. Conta da pessoa (Person) e vínculo com a loja
// (Membership) são entidades separadas: a conta é única, os vínculos variam por loja.

export type ModuleId = 'overview' | 'finance' | 'team' | 'calendar' | 'activity' | 'settings';
export type ActionId = 'view' | 'create' | 'edit' | 'delete' | 'export';

/** Ações liberadas por módulo. Módulo ausente = sem acesso. */
export type PermissionSet = Partial<Record<ModuleId, ActionId[]>>;

/** Perfil que a pessoa pode ter dentro de UMA loja. */
export type StoreRole = 'responsavel' | 'funcionario';
/** Perfil efetivo na sessão: administrador geral vale para todas as lojas. */
export type EffectiveRole = 'admin_geral' | StoreRole;

export interface Store {
  id: string;
  name: string;
  code: string;
}

/** Conta individual. Não carrega perfil de loja nem permissões. */
export interface Person {
  id: string;
  name: string;
  email: string;
  /** Único atributo de nível de conta que dá acesso global. Nunca editável pela interface. */
  isGeneralAdmin: boolean;
  createdAt: string;
}

/** Vínculo de uma pessoa com uma loja: perfil, cargo e permissões valem só para esta loja. */
export interface Membership {
  id: string;
  personId: string;
  storeId: string;
  role: StoreRole;
  jobTitle: string;
  permissions: PermissionSet;
  active: boolean;
  createdAt: string;
  deactivatedAt: string | null;
}

export type Scope = { kind: 'consolidated' } | { kind: 'store'; storeId: string };

export type ActivityType =
  | 'conta_criada'
  | 'vinculo_criado'
  | 'vinculo_editado'
  | 'permissoes_alteradas'
  | 'vinculo_desativado'
  | 'vinculo_reativado';

/** Registro de histórico. Guarda nomes (snapshot) para sobreviver a desativações. */
export interface ActivityEntry {
  id: string;
  at: string;
  storeId: string;
  storeName: string;
  actorId: string;
  actorName: string;
  type: ActivityType;
  targetPersonId: string;
  targetPersonName: string;
  summary: string;
}

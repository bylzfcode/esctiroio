// Tipos centrais do domínio. Conta da pessoa (Person) e vínculo com a loja
// (Membership) são entidades separadas: a conta é única, os vínculos variam por loja.

export type ModuleId = 'overview' | 'finance' | 'team' | 'calendar' | 'activity' | 'settings';
/**
 * Ações de permissão. `settle`, `reverse` e `confirm_send` existem SOMENTE no módulo Financeiro
 * (confirmar liquidação e anexar comprovante, estornar, registrar envio do comprovante).
 * No Financeiro, `delete` significa CANCELAR conta: nada financeiro é apagado.
 */
export type ActionId = 'view' | 'create' | 'edit' | 'delete' | 'export' | 'settle' | 'reverse' | 'confirm_send';

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
  /** Conta habilitada. Ausente = habilitada. Conta desativada perde o acesso a todas as lojas. */
  active?: boolean;
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
  | 'conta_editada'
  | 'conta_desativada'
  | 'conta_reativada'
  | 'admin_concedido'
  | 'admin_removido'
  | 'vinculo_criado'
  | 'vinculo_editado'
  | 'permissoes_alteradas'
  | 'vinculo_desativado'
  | 'vinculo_reativado';

/** Registro de histórico. Guarda nomes (snapshot) para sobreviver a desativações. */
export interface ActivityEntry {
  id: string;
  at: string;
  /** null = evento global (ex.: papel de administrador geral). */
  storeId: string | null;
  storeName: string | null;
  actorId: string;
  actorName: string;
  type: ActivityType;
  targetPersonId: string;
  targetPersonName: string;
  summary: string;
}

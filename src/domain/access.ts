import { MODULES } from './modules';
import { fullPermissions, hasPermission, normalizePermissions } from './permissions';
import type { ActionId, EffectiveRole, Membership, ModuleId, PermissionSet, Person, Scope, Store } from './types';

/** Resultado de "o que esta pessoa pode fazer neste escopo". Dados puros, sem funções. */
export interface AccessContext {
  scope: Scope;
  role: EffectiveRole | null;
  permissions: PermissionSet;
  membership: Membership | null;
}

export const NO_ACCESS: AccessContext = {
  scope: { kind: 'consolidated' },
  role: null,
  permissions: {},
  membership: null,
};

export function activeMemberships(memberships: Membership[], personId: string): Membership[] {
  return memberships.filter((m) => m.personId === personId && m.active);
}

/** Lojas que a pessoa pode selecionar: todas para o administrador geral, só as vinculadas e ativas para os demais. */
export function accessibleStores(person: Person, memberships: Membership[], stores: Store[]): Store[] {
  if (person.isGeneralAdmin) return [...stores].sort(byName);
  const ids = new Set(activeMemberships(memberships, person.id).map((m) => m.storeId));
  return stores.filter((s) => ids.has(s.id)).sort(byName);
}

const byName = (a: Store, b: Store) => a.name.localeCompare(b.name, 'pt-BR');

/** O escopo só é válido se a pessoa realmente tiver acesso a ele. */
export function isScopeAllowed(person: Person, memberships: Membership[], stores: Store[], scope: Scope): boolean {
  if (scope.kind === 'consolidated') return person.isGeneralAdmin;
  return accessibleStores(person, memberships, stores).some((s) => s.id === scope.storeId);
}

export function defaultScope(person: Person, memberships: Membership[], stores: Store[]): Scope | null {
  if (person.isGeneralAdmin) return { kind: 'consolidated' };
  const first = accessibleStores(person, memberships, stores)[0];
  return first ? { kind: 'store', storeId: first.id } : null;
}

export function resolveAccess(person: Person, memberships: Membership[], scope: Scope): AccessContext {
  if (person.isGeneralAdmin) {
    return { scope, role: 'admin_geral', permissions: fullPermissions('responsavel'), membership: null };
  }
  if (scope.kind === 'consolidated') return { ...NO_ACCESS, scope }; // visão consolidada é exclusiva
  const membership = memberships.find((m) => m.personId === person.id && m.storeId === scope.storeId && m.active);
  if (!membership) return { ...NO_ACCESS, scope };
  return {
    scope,
    role: membership.role,
    permissions: normalizePermissions(membership.permissions, membership.role),
    membership,
  };
}

export function can(access: AccessContext, module: ModuleId, action: ActionId = 'view'): boolean {
  if (!access.role) return false;
  return hasPermission(access.permissions, module, action);
}

export function allowedModules(access: AccessContext): ModuleId[] {
  return MODULES.filter((m) => can(access, m.id, 'view')).map((m) => m.id);
}

export function firstAllowedModule(access: AccessContext): ModuleId | null {
  return allowedModules(access)[0] ?? null;
}

/** Gerenciar equipe exige perfil de responsável (ou administrador geral) E a ação liberada no módulo. */
export function canManageTeam(access: AccessContext, action: 'create' | 'edit' | 'delete'): boolean {
  if (access.role !== 'admin_geral' && access.role !== 'responsavel') return false;
  return can(access, 'team', action);
}

/**
 * Regras sobre o alvo da ação:
 * - administrador geral gerencia qualquer vínculo;
 * - responsável gerencia apenas funcionários, nunca outros responsáveis nem o próprio vínculo.
 */
export function canActOnMembership(access: AccessContext, actorPersonId: string, target: Membership): boolean {
  if (access.role === 'admin_geral') return true;
  if (access.role !== 'responsavel') return false;
  return target.role === 'funcionario' && target.personId !== actorPersonId;
}

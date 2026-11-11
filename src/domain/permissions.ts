import { ACTIONS, MODULES, MODULE_BY_ID } from './modules';
import type { ActionId, ModuleId, PermissionSet, StoreRole } from './types';

const ACTION_ORDER = ACTIONS.map((a) => a.id);

/** Teto de permissões do perfil: funcionários não recebem ações administrativas. */
export function roleCeiling(role: StoreRole): PermissionSet {
  const out: PermissionSet = {};
  for (const m of MODULES) {
    out[m.id] = role === 'funcionario' && m.employeeMaxActions ? [...m.employeeMaxActions] : [...m.actions];
  }
  return out;
}

/** Todas as permissões possíveis para o perfil (padrão de responsável). */
export function fullPermissions(role: StoreRole = 'responsavel'): PermissionSet {
  return roleCeiling(role);
}

export function hasPermission(perms: PermissionSet, module: ModuleId, action: ActionId): boolean {
  return perms[module]?.includes(action) ?? false;
}

/**
 * Normaliza um conjunto: remove módulos/ações inexistentes, ordena e aplica a regra
 * "sem visualizar não há ações". Se `role` for informado, aplica também o teto do perfil.
 */
export function normalizePermissions(perms: PermissionSet, role?: StoreRole): PermissionSet {
  const ceiling = role ? roleCeiling(role) : null;
  const out: PermissionSet = {};
  for (const m of MODULES) {
    const requested = perms[m.id] ?? [];
    const allowedHere = (a: ActionId) =>
      m.actions.includes(a) && (!ceiling || (ceiling[m.id] ?? []).includes(a));
    const kept = ACTION_ORDER.filter((a) => requested.includes(a) && allowedHere(a));
    if (kept.includes('view')) out[m.id] = kept;
  }
  return out;
}

export function setAction(perms: PermissionSet, module: ModuleId, action: ActionId, enabled: boolean): PermissionSet {
  const current = new Set(perms[module] ?? []);
  if (enabled) {
    // Qualquer ação exige "visualizar" marcado.
    if (action !== 'view' && !current.has('view')) return perms;
    current.add(action);
  } else if (action === 'view') {
    current.clear(); // desmarcar "visualizar" limpa todas as ações do módulo
  } else {
    current.delete(action);
  }
  const next: PermissionSet = { ...perms };
  if (current.size === 0) delete next[module];
  else next[module] = ACTION_ORDER.filter((a) => current.has(a));
  return next;
}

export interface PermissionChange {
  module: ModuleId;
  action: ActionId;
  granted: boolean;
}

export function diffPermissions(before: PermissionSet, after: PermissionSet): PermissionChange[] {
  const changes: PermissionChange[] = [];
  for (const m of MODULES) {
    for (const a of ACTION_ORDER) {
      const was = hasPermission(before, m.id, a);
      const is = hasPermission(after, m.id, a);
      if (was !== is) changes.push({ module: m.id, action: a, granted: is });
    }
  }
  return changes;
}

/**
 * Quem concede não pode ir além do que possui: toda mudança (conceder ou retirar)
 * precisa estar dentro das permissões de quem altera. Retorna as mudanças proibidas.
 */
export function changesBeyondActor(actor: PermissionSet, before: PermissionSet, after: PermissionSet): PermissionChange[] {
  return diffPermissions(before, after).filter((c) => !hasPermission(actor, c.module, c.action));
}

export function countViewableModules(perms: PermissionSet): number {
  return MODULES.filter((m) => hasPermission(perms, m.id, 'view')).length;
}

export function describeChange(c: PermissionChange): string {
  const module = MODULE_BY_ID[c.module].label;
  const action = ACTIONS.find((a) => a.id === c.action)?.label.toLowerCase() ?? c.action;
  return `${module}: ${c.granted ? 'liberou' : 'retirou'} ${action}`;
}

/** Permissões presentes nos dois conjuntos (ex.: o que um responsável pode conceder a um novo perfil). */
export function intersectPermissions(a: PermissionSet, b: PermissionSet): PermissionSet {
  const out: PermissionSet = {};
  for (const m of MODULES) {
    const kept = (a[m.id] ?? []).filter((act) => b[m.id]?.includes(act));
    if (kept.length) out[m.id] = kept;
  }
  return out;
}

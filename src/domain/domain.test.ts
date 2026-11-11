import { describe, expect, it } from 'vitest';
import { accessibleStores, allowedModules, can, canActOnMembership, canManageTeam, defaultScope, firstAllowedModule, isScopeAllowed, resolveAccess } from './access';
import { changesBeyondActor, fullPermissions, normalizePermissions, setAction } from './permissions';
import { createSeed } from '@/services/mock/seed';

const seed = createSeed(new Date('2026-01-10T12:00:00Z'));
const person = (id: string) => seed.persons.find((p) => p.id === id)!;
const store = (storeId: string) => ({ kind: 'store', storeId }) as const;

describe('permissões', () => {
  it('desmarcar "visualizar" limpa as demais ações do módulo', () => {
    const p = { calendar: ['view', 'create', 'edit'] as const };
    const next = setAction({ calendar: [...p.calendar] }, 'calendar', 'view', false);
    expect(next.calendar).toBeUndefined();
  });

  it('não permite marcar ação sem "visualizar"', () => {
    expect(setAction({}, 'calendar', 'edit', true)).toEqual({});
  });

  it('normalizar descarta ações sem "visualizar", módulos e ações inexistentes', () => {
    const out = normalizePermissions({ finance: ['edit', 'export'], overview: ['view', 'delete'], calendar: ['view', 'create'] });
    expect(out.finance).toBeUndefined();
    expect(out.overview).toEqual(['view']); // "excluir" não se aplica à visão geral
    expect(out.calendar).toEqual(['view', 'create']);
  });

  it('funcionário nunca recebe ações administrativas em Equipe', () => {
    const out = normalizePermissions({ team: ['view', 'create', 'delete'] }, 'funcionario');
    expect(out.team).toEqual(['view']);
  });

  it('detecta concessões e retiradas acima das permissões de quem altera', () => {
    const actor = { calendar: ['view' as const, 'create' as const] };
    expect(changesBeyondActor(actor, {}, { calendar: ['view', 'create'] })).toEqual([]);
    expect(changesBeyondActor(actor, {}, { calendar: ['view', 'create', 'edit'] })).toHaveLength(1);
    expect(changesBeyondActor(actor, {}, { finance: ['view'] })).toHaveLength(1);
    // retirar algo que o ator não possui também é proibido
    expect(changesBeyondActor(actor, { finance: ['view'] }, {})).toHaveLength(1);
  });
});

describe('acesso por loja', () => {
  it('administrador geral acessa todas as lojas e a visão consolidada', () => {
    const ana = person('p-ana');
    expect(accessibleStores(ana, seed.memberships, seed.stores)).toHaveLength(4);
    expect(isScopeAllowed(ana, seed.memberships, seed.stores, { kind: 'consolidated' })).toBe(true);
    expect(defaultScope(ana, seed.memberships, seed.stores)).toEqual({ kind: 'consolidated' });
  });

  it('visão consolidada é exclusiva do administrador geral', () => {
    for (const id of ['p-bruno', 'p-carla', 'p-igor']) {
      const p = person(id);
      expect(isScopeAllowed(p, seed.memberships, seed.stores, { kind: 'consolidated' })).toBe(false);
      expect(resolveAccess(p, seed.memberships, { kind: 'consolidated' }).role).toBeNull();
    }
  });

  it('seletor mostra somente lojas autorizadas e ativas', () => {
    expect(accessibleStores(person('p-bruno'), seed.memberships, seed.stores).map((s) => s.id)).toEqual(['loja-alfa']);
    expect(accessibleStores(person('p-diego'), seed.memberships, seed.stores).map((s) => s.id)).toEqual(['loja-delta', 'loja-gama']);
    // Marcos: vínculo desativado na Alfa, ativo na Delta
    expect(accessibleStores(person('p-marcos'), seed.memberships, seed.stores).map((s) => s.id)).toEqual(['loja-delta']);
    expect(accessibleStores(person('p-patricia'), seed.memberships, seed.stores)).toEqual([]);
  });

  it('Carla é responsável na Beta e funcionária na Gama, com permissões distintas', () => {
    const carla = person('p-carla');
    const beta = resolveAccess(carla, seed.memberships, store('loja-beta'));
    const gama = resolveAccess(carla, seed.memberships, store('loja-gama'));
    expect(beta.role).toBe('responsavel');
    expect(gama.role).toBe('funcionario');
    expect(can(beta, 'team', 'edit')).toBe(true);
    expect(can(gama, 'team', 'view')).toBe(false);
    expect(allowedModules(gama)).toEqual(['overview', 'calendar']);
    expect(canManageTeam(gama, 'create')).toBe(false);
    // sem vínculo ativo na loja = sem acesso
    expect(resolveAccess(carla, seed.memberships, store('loja-alfa')).role).toBeNull();
  });

  it('Igor tem módulos diferentes em cada loja', () => {
    const igor = person('p-igor');
    const alfa = resolveAccess(igor, seed.memberships, store('loja-alfa'));
    const beta = resolveAccess(igor, seed.memberships, store('loja-beta'));
    expect(can(alfa, 'calendar', 'view')).toBe(true);
    expect(can(beta, 'calendar', 'view')).toBe(false);
    expect(firstAllowedModule(beta)).toBe('overview');
  });

  it('responsável não altera responsáveis nem o próprio vínculo; administrador altera qualquer um', () => {
    const helena = person('p-helena');
    const acc = resolveAccess(helena, seed.memberships, store('loja-alfa'));
    const bruno = seed.memberships.find((m) => m.id === 'v-bruno-alfa')!;
    const own = seed.memberships.find((m) => m.id === 'v-helena-alfa')!;
    const igor = seed.memberships.find((m) => m.id === 'v-igor-alfa')!;
    expect(canActOnMembership(acc, helena.id, bruno)).toBe(false);
    expect(canActOnMembership(acc, helena.id, own)).toBe(false);
    expect(canActOnMembership(acc, helena.id, igor)).toBe(true);
    const admin = resolveAccess(person('p-ana'), seed.memberships, store('loja-alfa'));
    expect(canActOnMembership(admin, 'p-ana', bruno)).toBe(true);
  });

  it('responsáveis têm todas as permissões aplicáveis por padrão', () => {
    const acc = resolveAccess(person('p-bruno'), seed.memberships, store('loja-alfa'));
    expect(acc.permissions).toEqual(fullPermissions('responsavel'));
  });
});

// DADOS FICTÍCIOS para demonstração. Nenhuma pessoa, e-mail ou loja é real.
// Os e-mails usam o domínio reservado "demo.example".

import { fullPermissions, normalizePermissions } from '@/domain/permissions';
import type { ActivityEntry, Membership, PermissionSet, Person, Store, StoreRole } from '@/domain/types';

export interface DemoData {
  stores: Store[];
  persons: Person[];
  memberships: Membership[];
  activity: ActivityEntry[];
}

const HOUR = 3_600_000;

export function createSeed(now: Date = new Date()): DemoData {
  const ago = (hours: number) => new Date(now.getTime() - hours * HOUR).toISOString();

  const stores: Store[] = [
    { id: 'loja-alfa', name: 'Loja Alfa', code: 'A01' },
    { id: 'loja-beta', name: 'Loja Beta', code: 'B02' },
    { id: 'loja-gama', name: 'Loja Gama', code: 'G03' },
    { id: 'loja-delta', name: 'Loja Delta', code: 'D04' },
  ];

  const person = (id: string, name: string, isGeneralAdmin = false): Person => ({
    id,
    name,
    email: `${id.replace('p-', '')}@demo.example`,
    isGeneralAdmin,
    createdAt: ago(24 * 60),
  });

  const persons: Person[] = [
    person('p-ana', 'Ana Ribeiro', true),
    person('p-bruno', 'Bruno Almeida'),
    person('p-helena', 'Helena Prado'),
    person('p-carla', 'Carla Mendes'),
    person('p-diego', 'Diego Faria'),
    person('p-eduardo', 'Eduardo Costa'),
    person('p-igor', 'Igor Lima'),
    person('p-julia', 'Júlia Nunes'),
    person('p-marcos', 'Marcos Teixeira'),
    person('p-lucas', 'Lucas Rocha'),
    person('p-renata', 'Renata Souza'),
    person('p-fabio', 'Fábio Santos'),
    person('p-patricia', 'Patrícia Gomes'),
  ];

  const link = (
    personId: string,
    storeId: string,
    role: StoreRole,
    jobTitle: string,
    permissions: PermissionSet,
    active = true,
  ): Membership => ({
    id: `v-${personId.replace('p-', '')}-${storeId.replace('loja-', '')}`,
    personId,
    storeId,
    role,
    jobTitle,
    permissions: normalizePermissions(permissions, role),
    active,
    createdAt: ago(24 * 45),
    deactivatedAt: active ? null : ago(24 * 6),
  });

  const resp = (personId: string, storeId: string, jobTitle: string) =>
    link(personId, storeId, 'responsavel', jobTitle, fullPermissions('responsavel'));
  const func = (personId: string, storeId: string, jobTitle: string, p: PermissionSet, active = true) =>
    link(personId, storeId, 'funcionario', jobTitle, p, active);

  const memberships: Membership[] = [
    // Loja Alfa
    resp('p-bruno', 'loja-alfa', 'Gerente'),
    resp('p-helena', 'loja-alfa', 'Subgerente'),
    func('p-igor', 'loja-alfa', 'Caixa', {
      overview: ['view'],
      finance: ['view'],
      calendar: ['view', 'create', 'edit'],
      team: ['view'],
    }),
    func('p-julia', 'loja-alfa', 'Atendente', { overview: ['view'], calendar: ['view'], activity: ['view'] }),
    func('p-marcos', 'loja-alfa', 'Estoquista', { overview: ['view'], calendar: ['view'] }, false),
    func('p-patricia', 'loja-alfa', 'Atendente', { overview: ['view'] }, false),
    // Loja Beta
    resp('p-carla', 'loja-beta', 'Gerente'),
    func('p-igor', 'loja-beta', 'Apoio', { overview: ['view'], finance: ['view', 'export'] }),
    func('p-lucas', 'loja-beta', 'Caixa', { overview: ['view'], calendar: ['view'] }),
    // Loja Gama
    resp('p-diego', 'loja-gama', 'Gerente'),
    func('p-carla', 'loja-gama', 'Atendente', { overview: ['view'], calendar: ['view', 'create'] }),
    func('p-renata', 'loja-gama', 'Estoquista', { overview: ['view'], finance: ['view'], activity: ['view'] }),
    func('p-patricia', 'loja-gama', 'Atendente', { overview: ['view'] }, false),
    // Loja Delta
    resp('p-diego', 'loja-delta', 'Gerente regional'),
    resp('p-eduardo', 'loja-delta', 'Gerente'),
    func('p-marcos', 'loja-delta', 'Estoquista', {
      overview: ['view'],
      finance: ['view', 'export'],
      calendar: ['view'],
    }),
    func('p-fabio', 'loja-delta', 'Atendente', { overview: ['view'], team: ['view'], activity: ['view'] }),
  ];

  const storeName = (id: string) => stores.find((s) => s.id === id)?.name ?? id;
  const personName = (id: string) => persons.find((p) => p.id === id)?.name ?? id;
  let n = 0;
  const entry = (
    hours: number,
    storeId: string,
    actorId: string,
    type: ActivityEntry['type'],
    targetId: string,
    summary: string,
  ): ActivityEntry => ({
    id: `a-seed-${++n}`,
    at: ago(hours),
    storeId,
    storeName: storeName(storeId),
    actorId,
    actorName: personName(actorId),
    type,
    targetPersonId: targetId,
    targetPersonName: personName(targetId),
    summary,
  });

  const activity: ActivityEntry[] = [
    entry(24 * 6, 'loja-alfa', 'p-bruno', 'vinculo_desativado', 'p-marcos', 'Vínculo de Marcos Teixeira com a Loja Alfa desativado.'),
    entry(24 * 6, 'loja-alfa', 'p-bruno', 'vinculo_desativado', 'p-patricia', 'Vínculo de Patrícia Gomes com a Loja Alfa desativado.'),
    entry(24 * 5, 'loja-gama', 'p-diego', 'vinculo_desativado', 'p-patricia', 'Vínculo de Patrícia Gomes com a Loja Gama desativado.'),
    entry(24 * 4, 'loja-delta', 'p-eduardo', 'permissoes_alteradas', 'p-marcos', 'Financeiro: liberou exportar.'),
    entry(24 * 3, 'loja-beta', 'p-carla', 'vinculo_criado', 'p-lucas', 'Vínculo de Lucas Rocha com a Loja Beta criado como funcionário (Caixa).'),
    entry(24 * 3, 'loja-beta', 'p-ana', 'vinculo_criado', 'p-igor', 'Vínculo de Igor Lima com a Loja Beta criado como funcionário (Apoio).'),
    entry(24 * 2, 'loja-alfa', 'p-helena', 'permissoes_alteradas', 'p-igor', 'Calendário: liberou editar.'),
    entry(30, 'loja-gama', 'p-diego', 'vinculo_editado', 'p-renata', 'Cargo alterado para Estoquista.'),
    entry(20, 'loja-delta', 'p-diego', 'vinculo_criado', 'p-fabio', 'Vínculo de Fábio Santos com a Loja Delta criado como funcionário (Atendente).'),
    entry(5, 'loja-alfa', 'p-bruno', 'permissoes_alteradas', 'p-julia', 'Histórico de atividades: liberou visualizar.'),
  ];

  return { stores, persons, memberships, activity };
}

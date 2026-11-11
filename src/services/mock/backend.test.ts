import { beforeEach, describe, expect, it } from 'vitest';
import { ServiceError } from '../errors';
import type { Services } from '../types';
import { createMockServices, DATA_KEY, type KeyValueStorage } from './backend';

function memoryStorage(): KeyValueStorage & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
  };
}

const fail = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    if (e instanceof ServiceError) return e;
    throw e;
  }
  throw new Error('Era esperado um ServiceError');
};

let svc: Services;
let storage: ReturnType<typeof memoryStorage>;
const make = () => {
  storage = memoryStorage();
  svc = createMockServices({ storage, latencyMs: [0, 0] });
};
const bruno = { personId: 'p-bruno' };
const ana = { personId: 'p-ana' };
const carla = { personId: 'p-carla' };
const igor = { personId: 'p-igor' };

beforeEach(make);

describe('cadastro de funcionários', () => {
  it('cria conta nova e vínculo, registrando o histórico', async () => {
    await svc.team.createMember(bruno, 'loja-alfa', {
      email: 'Nova.Pessoa@demo.example',
      name: 'Nova Pessoa',
      jobTitle: 'Caixa',
      role: 'funcionario',
      permissions: { overview: ['view'], calendar: ['view'] },
    });
    const rows = await svc.team.listStoreMembers(bruno, 'loja-alfa');
    expect(rows.find((r) => r.person.email === 'nova.pessoa@demo.example')?.membership.active).toBe(true);
    const log = await svc.activity.list(bruno, { storeId: 'loja-alfa' });
    expect(log.map((l) => l.type)).toContain('vinculo_criado');
    // Criação de conta é evento global (sem loja): só o administrador geral o vê, como no servidor.
    expect(log.map((l) => l.type)).not.toContain('conta_criada');
    const all = await svc.activity.list(ana, { storeId: null });
    expect(all.find((l) => l.type === 'conta_criada')).toMatchObject({ storeId: null });
    expect(storage.map.has(DATA_KEY)).toBe(true);
  });

  it('reaproveita a conta existente em vez de duplicar (conta separada do vínculo)', async () => {
    await svc.team.createMember(bruno, 'loja-alfa', {
      email: 'LUCAS@demo.example',
      name: 'Nome ignorado: a conta já existe',
      jobTitle: '',
      role: 'funcionario',
      permissions: { overview: ['view'] },
    });
    const people = await svc.team.listAllPeople(ana);
    expect(people.filter((p) => p.person.email === 'lucas@demo.example')).toHaveLength(1);
    expect(people.find((p) => p.person.id === 'p-lucas')!.links.filter((l) => l.membership.active)).toHaveLength(2);
    expect(people.find((p) => p.person.id === 'p-lucas')!.person.name).toBe('Lucas Rocha'); // conta intacta
  });

  it('rejeita e-mail inválido, vínculo duplicado e administrador geral', async () => {
    const base = { name: 'Pessoa Teste', jobTitle: '', role: 'funcionario' as const, permissions: { overview: ['view' as const] } };
    expect((await fail(svc.team.createMember(bruno, 'loja-alfa', { ...base, email: 'x', name: 'X' }))).fieldErrors?.email).toBeTruthy();
    expect((await fail(svc.team.createMember(bruno, 'loja-alfa', { ...base, email: 'igor@demo.example' }))).fieldErrors?.email).toMatch(/já está vinculada/);
    expect((await fail(svc.team.createMember(bruno, 'loja-alfa', { ...base, email: 'marcos@demo.example' }))).fieldErrors?.email).toMatch(/desativado/);
    expect((await fail(svc.team.createMember(bruno, 'loja-alfa', { ...base, email: 'ana@demo.example' }))).fieldErrors?.email).toBe('Este e-mail não pode ser vinculado a esta loja.');
  });

  it('exige ao menos um módulo visível', async () => {
    const e = await fail(
      svc.team.createMember(bruno, 'loja-alfa', {
        email: 'a@demo.example',
        name: 'Pessoa A',
        jobTitle: '',
        role: 'funcionario',
        permissions: { calendar: ['create'] },
      }),
    );
    expect(e.fieldErrors?.permissions).toBeTruthy();
  });
});

describe('limites do responsável', () => {
  it('não cria responsável nem administrador; administrador geral pode criar responsável', async () => {
    const input = { email: 'r@demo.example', name: 'Resp Nova', jobTitle: '', role: 'responsavel' as const, permissions: { overview: ['view' as const] } };
    expect((await fail(svc.team.createMember(bruno, 'loja-alfa', input))).code).toBe('forbidden');
    await svc.team.createMember(ana, 'loja-alfa', input);
    const rows = await svc.team.listStoreMembers(ana, 'loja-alfa');
    expect(rows.find((r) => r.person.email === 'r@demo.example')?.membership.role).toBe('responsavel');
  });

  it('não altera nem desativa outro responsável, nem o próprio vínculo', async () => {
    const edit = { jobTitle: 'X', role: 'responsavel' as const, permissions: { overview: ['view' as const] } };
    expect((await fail(svc.team.updateMember(bruno, 'v-helena-alfa', edit))).code).toBe('forbidden');
    expect((await fail(svc.team.setMemberActive(bruno, 'v-helena-alfa', false))).code).toBe('forbidden');
    expect((await fail(svc.team.setMemberActive(bruno, 'v-bruno-alfa', false))).code).toBe('forbidden');
  });

  it('não promove funcionário a responsável', async () => {
    const e = await fail(
      svc.team.updateMember(bruno, 'v-igor-alfa', { jobTitle: 'Caixa', role: 'responsavel', permissions: { overview: ['view'] } }),
    );
    expect(e.code).toBe('forbidden');
  });

  it('não concede permissões que o próprio responsável não possui', async () => {
    // Administrador restringe a Helena: sem "excluir" em Calendário.
    await svc.team.updateMember(ana, 'v-helena-alfa', {
      jobTitle: 'Subgerente',
      role: 'responsavel',
      permissions: { overview: ['view'], team: ['view', 'create', 'edit', 'delete'], calendar: ['view', 'create', 'edit'] },
    });
    const helena = { personId: 'p-helena' };
    const e = await fail(
      svc.team.updateMember(helena, 'v-igor-alfa', {
        jobTitle: 'Caixa',
        role: 'funcionario',
        permissions: { overview: ['view'], calendar: ['view', 'create', 'edit', 'delete'] },
      }),
    );
    expect(e.code).toBe('forbidden');
    // retirar uma permissão que a própria Helena não tem (Financeiro) também é bloqueado
    const e2 = await fail(
      svc.team.updateMember(helena, 'v-igor-alfa', {
        jobTitle: 'Caixa',
        role: 'funcionario',
        permissions: { overview: ['view'], team: ['view'], calendar: ['view', 'create'] },
      }),
    );
    expect(e2.code).toBe('forbidden');
    // mantendo o que está fora do alcance dela e mexendo só no que ela possui, funciona
    await svc.team.updateMember(helena, 'v-igor-alfa', {
      jobTitle: 'Caixa',
      role: 'funcionario',
      permissions: { overview: ['view'], finance: ['view'], team: ['view'], calendar: ['view', 'create'] },
    });
  });

  it('funcionário (inclusive com "visualizar equipe") não gerencia ninguém', async () => {
    const fabio = { personId: 'p-fabio' };
    expect((await svc.team.listStoreMembers(fabio, 'loja-delta')).length).toBeGreaterThan(0);
    expect((await fail(svc.team.setMemberActive(fabio, 'v-marcos-delta', false))).code).toBe('forbidden');
    expect(
      (await fail(svc.team.createMember(fabio, 'loja-delta', { email: 'x@demo.example', name: 'X Y', jobTitle: '', role: 'funcionario', permissions: { overview: ['view'] } }))).code,
    ).toBe('forbidden');
  });

  it('não acessa lojas sem vínculo', async () => {
    expect((await fail(svc.team.listStoreMembers(bruno, 'loja-beta'))).code).toBe('forbidden');
    expect((await fail(svc.activity.list(bruno, { storeId: null }))).code).toBe('forbidden');
    expect((await fail(svc.overview.consolidatedSummary(bruno))).code).toBe('forbidden');
    // Carla é funcionária na Gama sem acesso a Equipe
    expect((await fail(svc.team.listStoreMembers(carla, 'loja-gama'))).code).toBe('forbidden');
  });
});

describe('desativação de vínculo', () => {
  it('desativa só o vínculo da loja, preserva a conta, os outros vínculos e o histórico', async () => {
    await svc.team.setMemberActive(bruno, 'v-igor-alfa', false);
    const snap = await svc.session.loadSnapshot(igor);
    expect(snap.stores.map((s) => s.id)).toEqual(['loja-beta']);
    expect(snap.memberships).toHaveLength(1);
    const rows = await svc.team.listStoreMembers(bruno, 'loja-alfa');
    const row = rows.find((r) => r.person.id === 'p-igor')!;
    expect(row.membership.active).toBe(false);
    expect(row.membership.deactivatedAt).not.toBeNull();
    // permissões do vínculo desativado são preservadas para uma eventual reativação
    expect(row.membership.permissions.calendar).toContain('edit');
    const log = await svc.activity.list(bruno, { storeId: 'loja-alfa' });
    expect(log[0]).toMatchObject({ type: 'vinculo_desativado', targetPersonName: 'Igor Lima' });
    // reativar
    await svc.team.setMemberActive(bruno, 'v-igor-alfa', true);
    expect((await svc.session.loadSnapshot(igor)).stores).toHaveLength(2);
  });

  it('não edita vínculo desativado', async () => {
    const e = await fail(
      svc.team.updateMember(bruno, 'v-marcos-alfa', { jobTitle: '', role: 'funcionario', permissions: { overview: ['view'] } }),
    );
    expect(e.code).toBe('conflict');
  });
});

describe('persistência e simulações', () => {
  it('registra alteração de permissões no histórico e persiste entre instâncias', async () => {
    await svc.team.updateMember(bruno, 'v-julia-alfa', {
      jobTitle: 'Atendente',
      role: 'funcionario',
      permissions: { overview: ['view'], calendar: ['view', 'edit'], activity: ['view'] },
    });
    const svc2 = createMockServices({ storage, latencyMs: [0, 0] });
    const log = await svc2.activity.list(bruno, { storeId: 'loja-alfa' });
    expect(log[0]?.type).toBe('permissoes_alteradas');
    expect(log[0]?.summary).toMatch(/Calendário: liberou editar/);
  });

  it('restaura os dados de demonstração e simula falha de carregamento', async () => {
    await svc.team.setMemberActive(bruno, 'v-igor-alfa', false);
    await svc.demo!.resetData();
    expect((await svc.session.loadSnapshot(igor)).stores).toHaveLength(2);
    svc.demo!.setSimulateFailure(true);
    expect((await fail(svc.team.listStoreMembers(bruno, 'loja-alfa'))).code).toBe('unavailable');
    svc.demo!.setSimulateFailure(false);
    expect(await svc.team.listStoreMembers(bruno, 'loja-alfa')).not.toHaveLength(0);
  });

  it('dados corrompidos no storage voltam ao padrão', async () => {
    storage.map.set(DATA_KEY, '{quebrado');
    const s = createMockServices({ storage, latencyMs: [0, 0] });
    expect((await s.demo!.listProfiles()).length).toBeGreaterThan(5);
  });

  it('perfis de demonstração: todos os tipos presentes e sem vínculos para Patrícia', async () => {
    const profiles = await svc.demo!.listProfiles();
    expect(new Set(profiles.map((p) => p.kind))).toEqual(new Set(['admin', 'responsavel', 'funcionario', 'sem_acesso']));
    expect(profiles.find((p) => p.person.id === 'p-patricia')!.activeLinks).toBe(0);
  });
});

describe('administração de contas (modo demonstração, espelha o servidor)', () => {
  it('somente o administrador geral concede/remove o papel e desativa contas', async () => {
    for (const a of [bruno, carla, igor]) {
      expect((await fail(svc.team.setGeneralAdmin(a, 'p-lucas', true))).code).toBe('forbidden');
      expect((await fail(svc.team.setAccountActive(a, 'p-lucas', false))).code).toBe('forbidden');
    }
    await svc.team.setGeneralAdmin(ana, 'p-lucas', true);
    expect((await svc.session.loadSnapshot({ personId: 'p-lucas' })).stores).toHaveLength(4);
  });

  it('o último administrador geral ativo não pode ser removido nem desativado', async () => {
    expect((await fail(svc.team.setGeneralAdmin(ana, 'p-ana', false))).code).toBe('conflict');
    expect((await fail(svc.team.setAccountActive(ana, 'p-ana', false))).code).toBe('conflict');
    await svc.team.setGeneralAdmin(ana, 'p-lucas', true); // surge um segundo administrador
    await svc.team.setGeneralAdmin(ana, 'p-ana', false); // agora é possível
  });

  it('conta desativada: sem acesso a lojas, mas vínculos e histórico ficam; reativar restaura', async () => {
    await svc.team.setAccountActive(ana, 'p-igor', false);
    const people = await svc.team.listAllPeople(ana);
    const igorRow = people.find((p) => p.person.id === 'p-igor')!;
    expect(igorRow.person.active).toBe(false);
    expect(igorRow.links.filter((l) => l.membership.active)).toHaveLength(2); // vínculos preservados
    const log = await svc.activity.list(ana, { storeId: null });
    expect(log[0]).toMatchObject({ type: 'conta_desativada', storeId: null });
    await svc.team.setAccountActive(ana, 'p-igor', true);
    expect((await svc.team.listAllPeople(ana)).find((p) => p.person.id === 'p-igor')!.person.active).toBe(true);
  });
});

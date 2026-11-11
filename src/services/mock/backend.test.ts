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
    const m = await svc.team.createMember(bruno, 'loja-alfa', {
      email: 'Nova.Pessoa@demo.example',
      name: 'Nova Pessoa',
      jobTitle: 'Caixa',
      role: 'funcionario',
      permissions: { overview: ['view'], calendar: ['view'] },
    });
    expect(m.active).toBe(true);
    const log = await svc.activity.list(bruno, { storeId: 'loja-alfa' });
    expect(log.map((l) => l.type)).toEqual(expect.arrayContaining(['conta_criada', 'vinculo_criado']));
    expect(storage.map.has(DATA_KEY)).toBe(true);
  });

  it('reaproveita a conta existente em vez de duplicar (conta separada do vínculo)', async () => {
    const lookup = await svc.team.lookupAccount(bruno, 'loja-alfa', 'LUCAS@demo.example');
    expect(lookup).toMatchObject({ exists: true, name: 'Lucas Rocha' });
    await svc.team.createMember(bruno, 'loja-alfa', {
      email: 'lucas@demo.example',
      jobTitle: '',
      role: 'funcionario',
      permissions: { overview: ['view'] },
    });
    const people = await svc.team.listAllPeople(ana);
    expect(people.filter((p) => p.person.email === 'lucas@demo.example')).toHaveLength(1);
    expect(people.find((p) => p.person.id === 'p-lucas')!.links.filter((l) => l.membership.active)).toHaveLength(2);
  });

  it('rejeita e-mail inválido, vínculo duplicado e administrador geral', async () => {
    const base = { jobTitle: '', role: 'funcionario' as const, permissions: { overview: ['view' as const] } };
    expect((await fail(svc.team.createMember(bruno, 'loja-alfa', { ...base, email: 'x', name: 'X' }))).fieldErrors?.email).toBeTruthy();
    expect((await fail(svc.team.createMember(bruno, 'loja-alfa', { ...base, email: 'igor@demo.example' }))).fieldErrors?.email).toMatch(/já está vinculada/);
    expect((await fail(svc.team.createMember(bruno, 'loja-alfa', { ...base, email: 'marcos@demo.example' }))).fieldErrors?.email).toMatch(/desativado/);
    expect((await fail(svc.team.createMember(bruno, 'loja-alfa', { ...base, email: 'ana@demo.example' }))).fieldErrors?.email).toMatch(/Administradores gerais/);
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
    const m = await svc.team.createMember(ana, 'loja-alfa', input);
    expect(m.role).toBe('responsavel');
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
    expect((await fail(svc.team.lookupAccount(fabio, 'loja-delta', 'x@demo.example'))).code).toBe('forbidden');
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
    await svc.demo.resetData();
    expect((await svc.session.loadSnapshot(igor)).stores).toHaveLength(2);
    svc.demo.setSimulateFailure(true);
    expect((await fail(svc.team.listStoreMembers(bruno, 'loja-alfa'))).code).toBe('unavailable');
    svc.demo.setSimulateFailure(false);
    expect(await svc.team.listStoreMembers(bruno, 'loja-alfa')).not.toHaveLength(0);
  });

  it('dados corrompidos no storage voltam ao padrão', async () => {
    storage.map.set(DATA_KEY, '{quebrado');
    const s = createMockServices({ storage, latencyMs: [0, 0] });
    expect((await s.session.listDemoProfiles()).length).toBeGreaterThan(5);
  });

  it('perfis de demonstração: todos os tipos presentes e sem vínculos para Patrícia', async () => {
    const profiles = await svc.session.listDemoProfiles();
    expect(new Set(profiles.map((p) => p.kind))).toEqual(new Set(['admin', 'responsavel', 'funcionario', 'sem_acesso']));
    expect(profiles.find((p) => p.person.id === 'p-patricia')!.activeLinks).toBe(0);
  });
});

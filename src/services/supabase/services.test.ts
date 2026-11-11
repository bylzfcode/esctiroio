import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';
import { ServiceError } from '../errors';
import { createSupabaseServices } from './services';

type Result = { data: unknown; error: unknown; status?: number };
const ok = (data: unknown = null): Result => ({ data, error: null });
const err = (e: Record<string, unknown>, status?: number): Result => ({ data: null, error: e, status });

interface Fake {
  session?: { user: { id: string } } | null;
  rpc?: (fn: string, args: unknown) => Result;
  tables?: Record<string, Result>;
  invoke?: (name: string, body: unknown) => Result;
}

/** Cliente falso que registra TODAS as chamadas e só oferece leitura em tabelas (sem insert/update/delete). */
function fake(f: Fake = {}) {
  const calls: string[] = [];
  const rpcArgs: Record<string, unknown> = {};
  const filters: Record<string, [string, unknown][]> = {};
  const client = {
    auth: {
      getSession: async () => ({ data: { session: f.session === undefined ? { user: { id: 'u1' } } : f.session }, error: null }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
    },
    rpc: (fn: string, args: unknown) => {
      calls.push(`rpc:${fn}`);
      rpcArgs[fn] = args;
      return Promise.resolve(f.rpc ? f.rpc(fn, args) : ok());
    },
    from: (table: string) => {
      calls.push(`from:${table}`);
      filters[table] = [];
      const result = f.tables?.[table] ?? ok([]);
      const b: Record<string, unknown> = {
        select: () => b,
        eq: (c: string, v: unknown) => (filters[table]!.push([c, v]), b),
        order: (c: string, o: unknown) => (filters[table]!.push(['order', `${c}:${JSON.stringify(o)}`]), b),
        limit: () => b,
        maybeSingle: () => Promise.resolve(result),
        then: (res: (r: Result) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve(result).then(res, rej),
      };
      return b;
    },
    functions: {
      invoke: async (name: string, opts: { body: unknown }) => {
        calls.push(`fn:${name}`);
        rpcArgs[`fn:${name}`] = opts.body;
        return f.invoke ? f.invoke(name, opts.body) : ok({ ok: true });
      },
    },
  } as unknown as SupabaseClient;
  return { client, calls, rpcArgs, filters };
}

const MEMBER = { email: 'nova@demo.example', name: 'Nova Pessoa', jobTitle: 'Caixa', role: 'funcionario' as const, permissions: { overview: ['view' as const] } };
const actor = { personId: 'ignorado-pelo-servidor' };

describe('sessão', () => {
  it('carrega conta, lojas e vínculos ativos da PRÓPRIA sessão (o actor do cliente é ignorado)', async () => {
    const f = fake({
      tables: {
        profiles: ok({ id: 'u1', email: 'b@x.zz', full_name: 'Bruno', is_general_admin: false, created_at: 't' }),
        stores: ok([{ id: 's1', name: 'Loja Alfa', code: 'A01' }]),
        memberships: ok([{ id: 'm1', person_id: 'u1', store_id: 's1', role: 'responsavel', job_title: '', permissions: { overview: ['view'] }, active: true, created_at: 't', deactivated_at: null }]),
      },
    });
    const snap = await createSupabaseServices(f.client).session.loadSnapshot(actor);
    expect(snap.person.name).toBe('Bruno');
    expect(snap.stores.map((s) => s.name)).toEqual(['Loja Alfa']);
    expect(snap.memberships).toHaveLength(1);
    expect(f.filters.profiles).toContainEqual(['id', 'u1']); // id vem da sessão, não do parâmetro
    expect(f.filters.memberships).toContainEqual(['person_id', 'u1']);
    expect(f.filters.memberships).toContainEqual(['active', true]);
  });

  it('conta desativada (RLS não devolve o perfil): erro claro, sem dados', async () => {
    const f = fake({ tables: { profiles: ok(null) } });
    await expect(createSupabaseServices(f.client).session.loadSnapshot(actor)).rejects.toMatchObject({ code: 'forbidden', message: expect.stringMatching(/desativada/) });
  });

  it('sem sessão: unauthorized e o app é avisado', async () => {
    const onUnauthorized = vi.fn();
    const f = fake({ session: null });
    await expect(createSupabaseServices(f.client, { onUnauthorized }).session.loadSnapshot(actor)).rejects.toMatchObject({ code: 'unauthorized' });
    expect(onUnauthorized).toHaveBeenCalledOnce();
    expect(f.calls).toEqual([]); // nenhuma consulta sem sessão
  });

  it('administrador geral: vínculos próprios não entram no snapshot', async () => {
    const f = fake({
      tables: {
        profiles: ok({ id: 'u1', email: 'a@x.zz', full_name: 'Ana', is_general_admin: true, created_at: 't' }),
        memberships: ok([{ id: 'm', person_id: 'u1', store_id: 's', role: 'funcionario', job_title: '', permissions: {}, active: true, created_at: 't', deactivated_at: null }]),
      },
    });
    expect((await createSupabaseServices(f.client).session.loadSnapshot(actor)).memberships).toEqual([]);
  });
});

describe('convite e cadastro (operação protegida no servidor)', () => {
  it('createMember chama SOMENTE a Edge Function, sem consultar contas por e-mail', async () => {
    const f = fake();
    await createSupabaseServices(f.client).team.createMember(actor, 'loja-1', MEMBER);
    expect(f.calls).toEqual(['fn:invite-member']);
    expect(f.rpcArgs['fn:invite-member']).toEqual({
      storeId: 'loja-1',
      email: 'nova@demo.example',
      name: 'Nova Pessoa',
      jobTitle: 'Caixa',
      role: 'funcionario',
      permissions: { overview: ['view'] },
    });
    expect(f.calls.some((c) => c.startsWith('from:profiles'))).toBe(false);
  });

  it('erros da função chegam ao formulário com o campo', async () => {
    const body = { ok: false, code: 'conflict', message: 'Esta pessoa já está vinculada à loja.', fieldErrors: { email: 'Esta pessoa já está vinculada à loja.' } };
    const f = fake({ invoke: () => err({ name: 'FunctionsHttpError', context: new Response(JSON.stringify(body), { status: 409 }) }) });
    const e = await createSupabaseServices(f.client).team.createMember(actor, 's', MEMBER).catch((x) => x);
    expect(e).toBeInstanceOf(ServiceError);
    expect(e).toMatchObject({ code: 'conflict', fieldErrors: { email: 'Esta pessoa já está vinculada à loja.' } });
  });

  it('401 da função (sessão expirada) avisa o app', async () => {
    const onUnauthorized = vi.fn();
    const f = fake({ invoke: () => err({ context: new Response('{}', { status: 401 }) }) });
    await expect(createSupabaseServices(f.client, { onUnauthorized }).team.createMember(actor, 's', MEMBER)).rejects.toMatchObject({ code: 'unauthorized' });
    expect(onUnauthorized).toHaveBeenCalledOnce();
  });

  it('falha de rede ao chamar a função vira "indisponível"', async () => {
    const f = fake({ invoke: () => err({ name: 'FunctionsFetchError', message: 'Failed to fetch' }) });
    await expect(createSupabaseServices(f.client).team.createMember(actor, 's', MEMBER)).rejects.toMatchObject({ code: 'unavailable' });
  });
});

describe('escritas passam apenas por RPC (nunca INSERT/UPDATE/DELETE direto)', () => {
  it('cada operação chama a função SQL correta com a identidade do servidor', async () => {
    const f = fake();
    const s = createSupabaseServices(f.client);
    await s.team.updateMember(actor, 'm1', { jobTitle: 'X', role: 'funcionario', permissions: { overview: ['view'] } });
    await s.team.updateMember(actor, 'm1', { jobTitle: 'X', role: 'funcionario', permissions: { overview: ['view'] }, name: 'Novo Nome' });
    await s.team.setMemberActive(actor, 'm1', false);
    await s.team.setGeneralAdmin(actor, 'p1', true);
    await s.team.setAccountActive(actor, 'p1', false);
    expect(f.calls).toEqual(['rpc:update_membership', 'rpc:update_membership', 'rpc:set_membership_active', 'rpc:set_general_admin', 'rpc:set_account_active']);
    expect(f.rpcArgs.set_membership_active).toEqual({ p_membership_id: 'm1', p_active: false });
    expect(f.rpcArgs.set_general_admin).toEqual({ p_person_id: 'p1', p_value: true });
    // Nenhum argumento carrega o "actor": o servidor usa o JWT
    expect(JSON.stringify(f.rpcArgs)).not.toContain('ignorado-pelo-servidor');
  });

  it('sem nome informado, nenhuma alteração de conta é enviada (p_account_name nulo)', async () => {
    const f = fake();
    await createSupabaseServices(f.client).team.updateMember(actor, 'm1', { jobTitle: '', role: 'funcionario', permissions: { overview: ['view'] } });
    expect(f.rpcArgs.update_membership).toMatchObject({ p_account_name: null });
  });

  it('o servidor decide: negativa vira "forbidden" com a mensagem dele', async () => {
    const f = fake({ rpc: () => err({ code: 'PT403', message: 'Responsáveis não podem alterar outros responsáveis.' }) });
    await expect(createSupabaseServices(f.client).team.setMemberActive(actor, 'm1', false)).rejects.toMatchObject({
      code: 'forbidden',
      message: 'Responsáveis não podem alterar outros responsáveis.',
    });
  });

  it('"proibido" avisa o app para revalidar a sessão; erros de validação não', async () => {
    const onForbidden = vi.fn();
    const denied = fake({ rpc: () => err({ code: 'PT403', message: 'Você não tem permissão.' }) });
    await expect(createSupabaseServices(denied.client, { onForbidden }).team.setMemberActive(actor, 'm1', false)).rejects.toMatchObject({ code: 'forbidden' });
    const rls = fake({ rpc: () => err({ code: '42501', message: 'permission denied' }) });
    await expect(createSupabaseServices(rls.client, { onForbidden }).team.setMemberActive(actor, 'm1', false)).rejects.toMatchObject({ code: 'forbidden' });
    expect(onForbidden).toHaveBeenCalledTimes(2);
    const invalid = fake({ rpc: () => err({ code: 'PT422', message: 'x', hint: 'name' }) });
    await expect(createSupabaseServices(invalid.client, { onForbidden }).team.setMemberActive(actor, 'm1', false)).rejects.toMatchObject({ code: 'validation' });
    expect(onForbidden).toHaveBeenCalledTimes(2);
  });

  it('JWT expirado em qualquer chamada encerra a sessão local (uma vez) e vira "unauthorized"', async () => {
    const onUnauthorized = vi.fn();
    const f = fake({ rpc: () => err({ code: 'PGRST301', message: 'JWT expired' }, 401) });
    await expect(createSupabaseServices(f.client, { onUnauthorized }).team.listStoreMembers(actor, 's')).rejects.toMatchObject({ code: 'unauthorized' });
    expect(onUnauthorized).toHaveBeenCalledOnce();
  });
});

describe('leituras', () => {
  it('equipe da loja: mapeia vínculos e contagem de lojas (só administrador recebe)', async () => {
    const f = fake({
      rpc: () =>
        ok([
          {
            membership: { id: 'm1', person_id: 'p1', store_id: 's', role: 'funcionario', job_title: 'Caixa', permissions: { overview: ['view'] }, active: true, created_at: 't', deactivated_at: null },
            person: { id: 'p1', email: 'p@x.zz', full_name: 'Pessoa', is_general_admin: false, active: true, created_at: 't' },
            active_store_count: 2,
          },
          {
            membership: { id: 'm2', person_id: 'p2', store_id: 's', role: 'funcionario', job_title: '', permissions: { overview: ['view'] }, active: false, created_at: 't', deactivated_at: 'd' },
            person: { id: 'p2', email: 'q@x.zz', full_name: '', is_general_admin: false, created_at: 't' },
            active_store_count: null,
          },
        ]),
    });
    const rows = await createSupabaseServices(f.client).team.listStoreMembers(actor, 's');
    expect(rows[0]).toMatchObject({ activeStoreCount: 2, person: { name: 'Pessoa' } });
    expect(rows[1]).not.toHaveProperty('activeStoreCount');
    expect(rows[1]!.person.name).toBe('q@x.zz');
    expect(f.rpcArgs.list_store_members).toEqual({ p_store_id: 's' });
  });

  it('histórico: filtra por loja, ordem estrita e mapeia evento global', async () => {
    const f = fake({
      tables: {
        audit_log: ok([{ id: 'a', created_at: 't', actor_id: null, actor_name: 'Sistema', store_id: null, store_name: null, action: 'conta_criada', target_person_id: 'p', target_person_name: 'Ana', summary: 'Conta de Ana criada.' }]),
      },
    });
    const s = createSupabaseServices(f.client);
    const all = await s.activity.list(actor, { storeId: null });
    expect(all[0]).toMatchObject({ storeId: null, actorName: 'Sistema' });
    expect(f.filters.audit_log).not.toContainEqual(['store_id', expect.anything()]);
    await s.activity.list(actor, { storeId: 'loja-9' });
    expect(f.filters.audit_log).toContainEqual(['store_id', 'loja-9']);
    expect(f.filters.audit_log).toContainEqual(['order', 'seq:{"ascending":false}']);
  });

  it('resumos usam as funções do servidor', async () => {
    const f = fake({
      rpc: (fn) =>
        fn === 'store_summary'
          ? ok({ store: { id: 's', name: 'Loja', code: 'A' }, team: null, last_activity_at: null })
          : ok({ stores: [], people_with_access: '3', active_links: 5, inactive_links: 1 }),
    });
    const s = createSupabaseServices(f.client);
    expect(await s.overview.storeSummary(actor, 's')).toMatchObject({ team: null, lastActivityAt: null });
    expect(await s.overview.consolidatedSummary(actor)).toMatchObject({ peopleWithAccess: 3, activeLinks: 5 });
  });
});

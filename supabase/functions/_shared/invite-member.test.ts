import { describe, expect, it } from 'vitest';
import { RpcFailure, corsHeaders, handleInvite, parseBearer, type InviteDeps } from './invite-member.ts';

const STORE = '11111111-1111-4111-8111-111111111111';
const CALLER = '22222222-2222-4222-8222-222222222222';
const TOKEN = 'jwt-do-chamador';
const body = (over: Record<string, unknown> = {}) => ({
  storeId: STORE,
  email: 'Nova.Pessoa@Demo.Example',
  name: 'Nova Pessoa',
  jobTitle: 'Caixa',
  role: 'funcionario',
  permissions: { overview: ['view'] },
  ...over,
});

/** Fake com registro de chamadas: permite afirmar o que NÃO aconteceu. */
function fakeDeps(over: Partial<InviteDeps> = {}) {
  const calls: string[] = [];
  const log = <T,>(name: string, value: T) => async (...a: unknown[]) => {
    calls.push(`${name}:${JSON.stringify(a)}`);
    return value;
  };
  const deps: InviteDeps = {
    verifyCaller: log('verifyCaller', CALLER) as InviteDeps['verifyCaller'],
    precheck: log('precheck', undefined) as InviteDeps['precheck'],
    findAccount: log('findAccount', null) as InviteDeps['findAccount'],
    inviteAccount: log('inviteAccount', 'novo-id') as InviteDeps['inviteAccount'],
    activateAccount: log('activateAccount', undefined) as InviteDeps['activateAccount'],
    createMembership: log('createMembership', undefined) as InviteDeps['createMembership'],
    ...over,
  };
  return { deps, calls, names: () => calls.map((c) => c.split(':')[0]) };
}

describe('autenticação do chamador', () => {
  it('sem cabeçalho Authorization: 401 e nenhuma chamada ao servidor', async () => {
    const { deps, calls } = fakeDeps();
    const r = await handleInvite(null, body(), deps);
    expect(r.status).toBe(401);
    expect(calls).toEqual([]);
  });

  it('JWT inválido/expirado: 401 e nenhum convite', async () => {
    for (const verifyCaller of [async () => null, async () => Promise.reject(new Error('jwt expired'))]) {
      const { deps, names } = fakeDeps({ verifyCaller });
      const r = await handleInvite(`Bearer ${TOKEN}`, body(), deps);
      expect(r.status).toBe(401);
      expect(names()).toEqual([]);
    }
  });

  it('extrai o token Bearer', () => {
    expect(parseBearer('Bearer abc')).toBe('abc');
    expect(parseBearer('bearer abc')).toBe('abc');
    expect(parseBearer('Basic abc')).toBeNull();
    expect(parseBearer(null)).toBeNull();
  });
});

describe('autorização antes de qualquer efeito', () => {
  it('sem permissão: 403, e NÃO consulta contas, NÃO convida, NÃO cria vínculo', async () => {
    const { deps, names } = fakeDeps({
      precheck: async () => {
        throw new RpcFailure('Você não tem permissão para cadastrar pessoas nesta loja.', 'PT403');
      },
    });
    const r = await handleInvite(`Bearer ${TOKEN}`, body(), deps);
    expect(r.status).toBe(403);
    expect(names()).toEqual(['verifyCaller']);
  });

  it('responsável tentando conceder papel de responsável: 403 do banco, sem convite', async () => {
    const { deps, names } = fakeDeps({
      precheck: async () => {
        throw new RpcFailure('Somente o administrador geral pode conceder o papel de responsável.', 'PT403');
      },
    });
    const r = await handleInvite(`Bearer ${TOKEN}`, body({ role: 'responsavel' }), deps);
    expect(r.status).toBe(403);
    expect(names()).not.toContain('inviteAccount');
    expect(names()).not.toContain('findAccount');
  });

  it('o pré-check e a criação usam o token do CHAMADOR (não a chave de serviço)', async () => {
    const seen: string[] = [];
    const { deps } = fakeDeps({
      precheck: async (t) => void seen.push(t),
      createMembership: async (t) => void seen.push(t),
    });
    await handleInvite(`Bearer ${TOKEN}`, body(), deps);
    expect(seen).toEqual([TOKEN, TOKEN]);
  });
});

describe('convite e reaproveitamento de conta', () => {
  it('e-mail novo: convida, ativa registrando o ator e cria só o vínculo', async () => {
    const { deps, calls, names } = fakeDeps();
    const r = await handleInvite(`Bearer ${TOKEN}`, body(), deps);
    expect(r).toEqual({ status: 200, body: { ok: true } });
    expect(names()).toEqual(['verifyCaller', 'precheck', 'findAccount', 'inviteAccount', 'activateAccount', 'createMembership']);
    expect(calls.find((c) => c.startsWith('inviteAccount'))).toContain('nova.pessoa@demo.example'); // normalizado
    expect(calls.find((c) => c.startsWith('activateAccount'))).toBe(`activateAccount:["novo-id","Nova Pessoa","${CALLER}"]`);
  });

  it('conta existente: reaproveita a identidade, NÃO convida e NÃO reativa nada', async () => {
    const { deps, calls, names } = fakeDeps({ findAccount: async () => ({ id: 'existente', activated: true }) });
    const r = await handleInvite(`Bearer ${TOKEN}`, body(), deps);
    expect(r.status).toBe(200);
    expect(names()).toEqual(['verifyCaller', 'precheck', 'createMembership']);
    expect(calls.find((c) => c.startsWith('createMembership'))).toContain('"personId":"existente"');
  });

  it('a resposta é IDÊNTICA para conta nova e existente (não permite descobrir e-mails)', async () => {
    const novo = await handleInvite(`Bearer ${TOKEN}`, body(), fakeDeps().deps);
    const existente = await handleInvite(`Bearer ${TOKEN}`, body(), fakeDeps({ findAccount: async () => ({ id: 'x', activated: true }) }).deps);
    expect(novo).toEqual(existente);
  });

  it('o nome é exigido sempre, para que a validação não vaze quais e-mails existem', async () => {
    for (const findAccount of [async () => null, async () => ({ id: 'x', activated: true })]) {
      const { deps, names } = fakeDeps({ findAccount });
      const r = await handleInvite(`Bearer ${TOKEN}`, body({ name: '' }), deps);
      expect(r.status).toBe(422);
      expect(r.body).toMatchObject({ fieldErrors: { name: expect.any(String) } });
      expect(names()).toEqual(['verifyCaller']);
    }
  });

  it('convite anterior nunca ativado: ativa e segue com o vínculo', async () => {
    const { deps, names } = fakeDeps({ findAccount: async () => ({ id: 'pendente', activated: false }) });
    const r = await handleInvite(`Bearer ${TOKEN}`, body(), deps);
    expect(r.status).toBe(200);
    expect(names()).toEqual(['verifyCaller', 'precheck', 'activateAccount', 'createMembership']);
  });

  it('falha ao enviar o convite: 502 genérico e nenhum vínculo criado', async () => {
    const { deps, names } = fakeDeps({
      inviteAccount: async () => {
        throw new Error('rate limit: detalhes internos do provedor');
      },
    });
    const r = await handleInvite(`Bearer ${TOKEN}`, body(), deps);
    expect(r.status).toBe(502);
    expect(JSON.stringify(r.body)).not.toMatch(/rate limit|provedor/); // não vaza detalhes internos
    expect(names()).not.toContain('createMembership');
  });
});

describe('erros do banco chegam ao formulário', () => {
  it('conflito e validação indicam o campo', async () => {
    const dup = fakeDeps({
      precheck: async () => {
        throw new RpcFailure('Esta pessoa já está vinculada à loja.', 'PT409', 'email');
      },
    });
    expect(await handleInvite(`Bearer ${TOKEN}`, body(), dup.deps)).toMatchObject({
      status: 409,
      body: { code: 'conflict', fieldErrors: { email: 'Esta pessoa já está vinculada à loja.' } },
    });
    const val = fakeDeps({
      createMembership: async () => {
        throw new RpcFailure('Use no máximo 60 caracteres.', 'PT422', 'jobTitle');
      },
    });
    expect(await handleInvite(`Bearer ${TOKEN}`, body(), val.deps)).toMatchObject({ status: 422, body: { fieldErrors: { jobTitle: expect.any(String) } } });
  });

  it('limite de cadastros por hora vira 429 e não convida', async () => {
    const { deps, names } = fakeDeps({
      precheck: async () => {
        throw new RpcFailure('Limite de cadastros por hora atingido. Tente novamente mais tarde.', 'PT429');
      },
    });
    const r = await handleInvite(`Bearer ${TOKEN}`, body(), deps);
    expect(r.status).toBe(429);
    expect(names()).not.toContain('inviteAccount');
  });

  it('erro inesperado do banco vira 500 genérico', async () => {
    const { deps } = fakeDeps({
      createMembership: async () => {
        throw new RpcFailure('relation "x" does not exist', '42P01');
      },
    });
    const r = await handleInvite(`Bearer ${TOKEN}`, body(), deps);
    expect(r.status).toBe(500);
    expect(JSON.stringify(r.body)).not.toMatch(/relation/);
  });
});

describe('validação de entrada', () => {
  it.each([
    ['storeId', { storeId: 'nao-e-uuid' }],
    ['email', { email: 'invalido' }],
    ['role', { role: 'admin_geral' }],
    ['permissions', { permissions: 'tudo' }],
    ['jobTitle', { jobTitle: 'x'.repeat(61) }],
  ])('rejeita %s inválido sem tocar no servidor', async (field, over) => {
    const { deps, names } = fakeDeps();
    const r = await handleInvite(`Bearer ${TOKEN}`, body(over), deps);
    expect(r.status).toBe(422);
    expect(r.body).toMatchObject({ fieldErrors: { [field]: expect.any(String) } });
    expect(names()).toEqual(['verifyCaller']);
  });

  it('corpo vazio ou não-objeto: 422', async () => {
    for (const raw of [null, 'texto', 42, []]) {
      expect((await handleInvite(`Bearer ${TOKEN}`, raw, fakeDeps().deps)).status).toBe(422);
    }
  });
});

describe('CORS fail-closed', () => {
  it('só origens listadas recebem permissão', () => {
    const allowed = ['https://app.exemplo.test'];
    expect(corsHeaders('https://app.exemplo.test', allowed)['Access-Control-Allow-Origin']).toBe('https://app.exemplo.test');
    expect(corsHeaders('https://malicioso.test', allowed)['Access-Control-Allow-Origin']).toBeUndefined();
    expect(corsHeaders(null, allowed)['Access-Control-Allow-Origin']).toBeUndefined();
    expect(corsHeaders('https://app.exemplo.test', [])['Access-Control-Allow-Origin']).toBeUndefined();
  });
});

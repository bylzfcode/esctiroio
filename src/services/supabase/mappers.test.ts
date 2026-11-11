import { describe, expect, it } from 'vitest';
import { ServiceError } from '../errors';
import { fromFunctionBody, mapRemoteError, toActivity, toMembership, toPerson } from './mappers';

describe('mapRemoteError (erros das funções SQL)', () => {
  it('PT401, JWT expirado e HTTP 401 viram "unauthorized"', () => {
    for (const e of [{ code: 'PT401', message: 'x' }, { code: 'PGRST301', message: 'x' }, { message: 'JWT expired' }, { status: 401, message: 'x' }]) {
      expect(mapRemoteError(e)).toMatchObject({ code: 'unauthorized', message: 'Sua sessão expirou. Entre novamente.' });
    }
  });

  it('PT403 mantém a mensagem do servidor; 42501 usa texto genérico (sem vazar detalhes do banco)', () => {
    expect(mapRemoteError({ code: 'PT403', message: 'Responsáveis não podem alterar outros responsáveis.' })).toMatchObject({
      code: 'forbidden',
      message: 'Responsáveis não podem alterar outros responsáveis.',
    });
    const denied = mapRemoteError({ code: '42501', message: 'permission denied for table memberships' });
    expect(denied.code).toBe('forbidden');
    expect(denied.message).not.toMatch(/memberships/);
  });

  it('PT422 com "hint" vira erro no campo; PT409 também', () => {
    expect(mapRemoteError({ code: 'PT422', message: 'Use no máximo 60 caracteres.', hint: 'jobTitle' })).toMatchObject({
      code: 'validation',
      fieldErrors: { jobTitle: 'Use no máximo 60 caracteres.' },
    });
    expect(mapRemoteError({ code: 'PT409', message: 'Esta pessoa já está vinculada à loja.', hint: 'email' })).toMatchObject({
      code: 'conflict',
      fieldErrors: { email: 'Esta pessoa já está vinculada à loja.' },
    });
    expect(mapRemoteError({ code: 'PT409', message: 'Não é possível remover ou desativar o último administrador geral ativo.' }).fieldErrors).toBeUndefined();
  });

  it('PT429 (limite de cadastros por hora) mostra a mensagem do servidor', () => {
    expect(mapRemoteError({ code: 'PT429', message: 'Limite de cadastros por hora atingido. Tente novamente mais tarde.' })).toMatchObject({
      code: 'unavailable',
      message: expect.stringMatching(/Limite de cadastros/),
    });
  });

  it('falha de rede e erros desconhecidos não expõem detalhes internos', () => {
    expect(mapRemoteError({ message: 'TypeError: Failed to fetch' })).toMatchObject({ code: 'unavailable', message: expect.stringMatching(/Sem conexão/) });
    const unknown = mapRemoteError({ code: '42P01', message: 'relation "public.secret" does not exist' });
    expect(unknown.code).toBe('unavailable');
    expect(unknown.message).not.toMatch(/secret|relation/);
  });
});

describe('fromFunctionBody (Edge Function)', () => {
  it('preserva código, mensagem e erros de campo', () => {
    const e = fromFunctionBody({ ok: false, code: 'validation', message: 'Revise os campos destacados.', fieldErrors: { name: 'Informe o nome da pessoa.' } });
    expect(e).toBeInstanceOf(ServiceError);
    expect(e).toMatchObject({ code: 'validation', fieldErrors: { name: 'Informe o nome da pessoa.' } });
  });

  it('corpo ilegível: 401 vira sessão expirada, o resto vira indisponível', () => {
    expect(fromFunctionBody(null, 401).code).toBe('unauthorized');
    expect(fromFunctionBody('<html>502</html>', 502).code).toBe('unavailable');
    expect(fromFunctionBody({ code: 'inventado', message: 'x' }).code).toBe('unavailable');
  });
});

describe('mapeamento de linhas', () => {
  it('conta sem nome mostra o e-mail; conta ausente de "active" vale como ativa', () => {
    expect(toPerson({ id: '1', email: 'a@x.zz', full_name: '', is_general_admin: false, created_at: 't' })).toMatchObject({ name: 'a@x.zz', active: true });
    expect(toPerson({ id: '1', email: 'a@x.zz', full_name: 'Ana', is_general_admin: true, active: false, created_at: 't' })).toMatchObject({
      name: 'Ana',
      isGeneralAdmin: true,
      active: false,
    });
  });

  it('vínculo e auditoria viram o domínio (evento global sem loja)', () => {
    expect(
      toMembership({ id: 'm', person_id: 'p', store_id: 's', role: 'funcionario', job_title: 'Caixa', permissions: { overview: ['view'] }, active: false, created_at: 'c', deactivated_at: 'd' }),
    ).toMatchObject({ personId: 'p', storeId: 's', jobTitle: 'Caixa', active: false, deactivatedAt: 'd' });
    expect(
      toActivity({ id: 'a', created_at: 't', actor_id: null, actor_name: 'Sistema', store_id: null, store_name: null, action: 'admin_concedido', target_person_id: 'p', target_person_name: 'Ana', summary: 's' }),
    ).toMatchObject({ storeId: null, storeName: null, actorName: 'Sistema', type: 'admin_concedido' });
  });
});

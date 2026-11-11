// Integração contra a pilha REAL do Supabase (GoTrue + PostgREST + Edge Function), com sessões
// de verdade (JWT emitido pelo Auth) de identidades distintas.
//
// NÃO roda por padrão: depende de configuração externa (Docker + Supabase CLI). Para executar:
//   supabase start && supabase db reset
//   (exporte SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY como em scripts/dev-seed.mjs) && npm run dev:seed
//   supabase functions serve invite-member --env-file <arquivo local sem segredos versionados>
//   LIVE_SUPABASE_URL=http://127.0.0.1:54321 LIVE_SUPABASE_ANON_KEY=<anon local> npx vitest run tests/live
//
// ATENÇÃO: este arquivo foi escrito sem acesso a uma pilha Supabase em execução; ele ainda não foi
// executado. As garantias equivalentes de SQL/RLS/funções são provadas em tests/db (executados).
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it } from 'vitest';

const URL = process.env.LIVE_SUPABASE_URL;
const ANON = process.env.LIVE_SUPABASE_ANON_KEY;
const PASSWORD = 'DevLocal2026x'; // senha FICTÍCIA criada por scripts/dev-seed.mjs (somente local)

const newClient = () => createClient(URL!, ANON!, { auth: { persistSession: false, autoRefreshToken: false } });
async function login(who: string): Promise<SupabaseClient> {
  const c = newClient();
  const { error } = await c.auth.signInWithPassword({ email: `${who}@dev.example`, password: PASSWORD });
  if (error) throw new Error(`login ${who}: ${error.message}`);
  return c;
}
const CALENDAR = { overview: ['view'], calendar: ['view'] };

describe.runIf(!!URL && !!ANON)('pilha Supabase local (identidades reais)', () => {
  it('anônimo não lê nenhuma tabela nem executa funções', async () => {
    const c = newClient();
    expect((await c.from('stores').select('id')).error).not.toBeNull();
    expect((await c.from('memberships').select('id')).error).not.toBeNull();
    expect((await c.rpc('list_all_people')).error).not.toBeNull();
  });

  it('funcionário da Beta vê só a Beta e não lista a equipe da Alfa', async () => {
    const lucas = await login('lucas');
    const { data: stores } = await lucas.from('stores').select('code');
    expect(stores?.map((s) => s.code)).toEqual(['B02']);
    const { data: alfa } = await lucas.from('stores').select('id').eq('code', 'A01');
    const denied = await lucas.rpc('list_store_members', { p_store_id: (alfa ?? [])[0]?.id ?? '00000000-0000-4000-8000-000000000000' });
    expect(denied.error).not.toBeNull();
    expect(denied.status).toBe(403);
  });

  it('responsável não escala privilégios: sem papel de responsável, sem escrita direta', async () => {
    const bruno = await login('bruno');
    const { data: stores } = await bruno.from('stores').select('id, code');
    expect(stores?.map((s) => s.code)).toEqual(['A01']);
    const alfa = stores![0]!.id;
    const { data: profile } = await bruno.from('profiles').select('id').eq('email', 'ana@dev.example');
    expect(profile).toEqual([]); // não enxerga contas de terceiros
    const asResp = await bruno.rpc('create_membership', {
      p_store_id: alfa,
      p_person_id: '00000000-0000-4000-8000-000000000000',
      p_role: 'responsavel',
      p_job_title: '',
      p_permissions: CALENDAR,
    });
    expect(asResp.error?.code).toBe('PT403');
    expect(asResp.status).toBe(403);
    const direct = await bruno.from('memberships').update({ role: 'responsavel' }).eq('store_id', alfa);
    expect(direct.error).not.toBeNull(); // sem privilégio de UPDATE
    expect((await bruno.from('audit_log').delete().eq('store_id', alfa)).error).not.toBeNull();
  });

  it('Edge Function: funcionário não convida; a chave de serviço nunca é exposta ao navegador', async () => {
    const julia = await login('julia');
    const { data: stores } = await julia.from('stores').select('id');
    const res = await julia.functions.invoke('invite-member', {
      body: { storeId: stores![0]!.id, email: `intruso-${Date.now()}@dev.example`, name: 'Intruso Teste', jobTitle: '', role: 'funcionario', permissions: CALENDAR },
    });
    expect(res.error).not.toBeNull();
    expect(JSON.stringify(res)).not.toMatch(/service_role/i);
  });

  it('desativar o vínculo corta o acesso daquela loja imediatamente, com o mesmo JWT', async () => {
    const bruno = await login('bruno');
    const julia = await login('julia');
    const { data: stores } = await julia.from('stores').select('id');
    const alfa = stores![0]!.id;
    expect((await julia.rpc('store_summary', { p_store_id: alfa })).error).toBeNull();
    const { data: members } = await bruno.rpc('list_store_members', { p_store_id: alfa });
    const membership = (members as { membership: { id: string }; person: { email: string } }[]).find((m) => m.person.email === 'julia@dev.example')!.membership.id;
    try {
      expect((await bruno.rpc('set_membership_active', { p_membership_id: membership, p_active: false })).error).toBeNull();
      const after = await julia.rpc('store_summary', { p_store_id: alfa }); // mesma sessão, sem novo login
      expect(after.error).not.toBeNull();
      expect((await julia.from('stores').select('id')).data).toEqual([]);
    } finally {
      await bruno.rpc('set_membership_active', { p_membership_id: membership, p_active: true });
    }
  });

  it('o último administrador geral não pode ser removido nem desativado', async () => {
    const ana = await login('ana');
    const { data: me } = await ana.from('profiles').select('id').eq('email', 'ana@dev.example').single();
    const r1 = await ana.rpc('set_general_admin', { p_person_id: me!.id, p_value: false });
    const r2 = await ana.rpc('set_account_active', { p_person_id: me!.id, p_active: false });
    expect(r1.error?.code).toBe('PT409');
    expect(r2.error?.code).toBe('PT409');
  });
});

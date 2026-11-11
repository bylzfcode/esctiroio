# Backend, autenticação e segurança (etapa 2)

Este documento descreve a arquitetura, como configurar o Supabase (local e hospedado), como criar o
**primeiro administrador com segurança**, onde cada regra de acesso é aplicada e o que foi (e o que
não foi) verificado.

> Nada aqui foi executado contra um projeto Supabase remoto. As migrações **não** são aplicadas
> automaticamente: você decide quando rodar `supabase db push`.

## Arquitetura

```
Navegador (React)                       Supabase
─────────────────                       ──────────────────────────────────────────
chave PÚBLICA (anon)  ── login ───────► Auth (GoTrue): e-mail + senha, convite, recuperação
JWT da sessão         ── RPC/SELECT ──► PostgREST ► PostgreSQL
                                          · RLS nas 4 tabelas (leitura filtrada)
                                          · funções RPC SECURITY DEFINER (única via de escrita)
                                          · gatilhos: invariantes + auditoria na mesma transação
                      ── convite ─────► Edge Function "invite-member"
                                          · valida o JWT e PRÉ-CHECA a autorização com a identidade
                                            do chamador antes de qualquer efeito
                                          · só ela usa a chave de serviço (ambiente do servidor)
```

Princípios:

- **O navegador nunca decide autorização.** Menus escondidos são conveniência. O servidor deriva a
  identidade de `auth.uid()` (JWT) e ignora qualquer "quem sou eu" enviado pelo cliente.
- **Nenhum papel de API escreve nas tabelas.** `anon` e `authenticated` só têm `SELECT` (filtrado por
  RLS); toda escrita passa por funções RPC que conferem autorização e validam.
- **Conta e vínculo são separados.** `profiles` (uma por pessoa) × `memberships` (uma por pessoa e loja,
  com perfil, cargo, permissões e situação próprios).
- **Chave privilegiada só no servidor.** O app recusa iniciar se detectar `service_role`/`sb_secret_`.

## Estrutura

| Caminho | Conteúdo |
| --- | --- |
| `supabase/migrations/` | Migrações versionadas: esquema, helpers, RLS, gatilhos/auditoria, RPC, bootstrap |
| `supabase/functions/invite-member/` | Edge Function (Deno): ligação com o Supabase |
| `supabase/functions/_shared/invite-member.ts` | Lógica da função, sem APIs do Deno (testada em Node) |
| `supabase/seed.sql` | Lojas fictícias **só para desenvolvimento local**, com trava contra bancos reais |
| `supabase/config.toml` | Configuração do Supabase local (sem cadastro público, senha forte) |
| `scripts/dev-seed.mjs` | Contas fictícias no Supabase **local** (recusa qualquer URL que não seja localhost) |
| `src/services/supabase/` | Implementação real dos serviços (RPC, Edge Function, Auth) |
| `src/config/` | Validação de ambiente e escolha explícita do modo (real × demonstração) |
| `tests/db/` | Testes de SQL/RLS/funções com identidades distintas |

## Rodando localmente

Requer Docker e a [Supabase CLI](https://supabase.com/docs/guides/local-development).

```bash
supabase start                 # sobe Postgres, Auth, API e Inbucket (e-mails de teste)
supabase db reset              # aplica as migrações e o supabase/seed.sql (lojas fictícias)
```

Crie as contas fictícias locais (a chave de serviço vem do **seu** terminal; nada é gravado em arquivo):

```bash
eval "$(supabase status -o env | sed 's/^/export /')"
SUPABASE_URL=$API_URL SUPABASE_SERVICE_ROLE_KEY=$SERVICE_ROLE_KEY npm run dev:seed
```

Configure o app com a chave **pública** do projeto local e inicie:

```bash
cp .env.example .env.local     # preencha VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY (ANON_KEY do status)
supabase functions serve invite-member    # em outro terminal
npm run dev
```

Entre com `bruno@dev.example` (responsável), `ana@dev.example` (administradora geral) etc. A senha de
desenvolvimento aparece na saída do `dev:seed`. Convites enviados localmente chegam no Inbucket
(endereço mostrado por `supabase status`).

## Projeto hospedado (checklist)

Faça no painel do Supabase, **antes** de usar com dados reais:

1. **Authentication → Sign In / Providers → Email:** desative *Allow new users to sign up* (sem cadastro
   público). Mantenha *Confirm email* ligado.
2. **Authentication → Policies/Passwords:** mínimo de **10** caracteres, exigindo maiúsculas, minúsculas e
   números (a tela de definir senha do app espelha essa regra).
3. **Authentication → URL Configuration:** *Site URL* = endereço do app; adicione-o também em
   *Redirect URLs* (convites e recuperação de senha voltam para ele).
4. **E-mail:** configure um SMTP próprio para produção (o remetente padrão tem limite baixo e é só para testes).
5. **Project Settings → API:** confirme que o schema `private` **não** está em *Exposed schemas*
   (só `public`).
6. **Aplicar migrações** (por sua conta, quando decidir): `supabase link --project-ref <ref>` e
   `supabase db push`. Isso **não** executa `seed.sql`.
7. **Edge Function:**
   ```bash
   supabase secrets set APP_URL=https://app.exemplo.com ALLOWED_ORIGINS=https://app.exemplo.com
   supabase functions deploy invite-member
   ```
   `SUPABASE_URL`, `SUPABASE_ANON_KEY` e `SUPABASE_SERVICE_ROLE_KEY` são fornecidas pela plataforma ao
   ambiente da função. **Não** as copie para nenhum arquivo do repositório nem para o host do front-end.
   `ALLOWED_ORIGINS` é *fail-closed*: origem fora da lista não recebe cabeçalhos CORS.
8. **Front-end:** no host (ex.: variáveis do provedor) defina apenas `VITE_SUPABASE_URL` e
   `VITE_SUPABASE_ANON_KEY` (chave pública). O build normal (`npm run build`) usa o backend real e não
   contém dados nem código de demonstração.
9. **Cabeçalhos HTTP** no host do front-end: configure uma *Content-Security-Policy* restritiva e
   `X-Content-Type-Options`/`Referrer-Policy`. O token de sessão fica no `localStorage` (padrão do
   Supabase), então reduzir risco de XSS importa.

## Criando o primeiro administrador geral (com segurança)

Não há cadastro público nem rota de API para isso. O dono do projeto, com acesso ao painel do Supabase:

1. **Authentication → Users → Add user → Create new user.** Informe o e-mail e uma senha forte e marque
   *Auto Confirm User*. (Alternativa: *Send invitation*; a pessoa define a senha pelo link.)
2. No **SQL Editor** (papel `postgres`), execute:
   ```sql
   select private.bootstrap_first_general_admin('seu-email@dominio.com');
   ```
3. Entre no app com esse e-mail. A conta nasce **inativa** por padrão e só o passo 2 a ativa como administrador.
4. Crie as lojas (por SQL, pelo mesmo editor — o app ainda não tem tela de lojas):
   ```sql
   insert into public.stores (code, name) values ('A01', 'Nome da loja');
   ```
5. Pelo app (visão consolidada → Equipe e permissões) conceda o papel de administrador a outra pessoa de
   confiança: o sistema **impede remover ou desativar o último administrador ativo**.

Garantias: a função só funciona **enquanto não existir nenhum administrador**; não é executável por
`anon`, `authenticated` nem `service_role` (verificado em `tests/db/bootstrap.test.ts`); o evento é
auditado como operação de "Sistema". Depois disso, o papel só é concedido por outro administrador.

**Perdeu o acesso do único administrador?** A senha se recupera pelo fluxo normal "Esqueci minha senha".
Se a conta foi desativada por alguém com acesso direto ao banco, reative-a como `postgres`
(`update public.profiles set active = true where email = '...'`).

## Modelo de segurança: regra → onde é aplicada → como foi testado

| Regra | Aplicação no servidor | Teste |
| --- | --- | --- |
| Sem cadastro público; contas nascem inativas | `config.toml`/painel + trigger `handle_new_user` (`active=false`) + `activate_profile` só `service_role` | `security.test.ts` (contas novas nascem inativas…; `activate_profile` exclusivo…) |
| Isolamento por loja | RLS em `stores`/`memberships`/`audit_log` + `private.has_permission` em todas as RPC | `security.test.ts` (isolamento e leitura; responsável de uma loja não gerencia vínculos de outra) |
| Não expor contas de outras lojas | `profiles`: só a própria (ou admin); demais dados só por RPC filtrada por loja/permissão | `security.test.ts` (não expõe contas de outras lojas) |
| Só o admin concede/remove papel de responsável e de admin geral | `create_membership`/`update_membership` (papel ≠ funcionário exige admin), `set_general_admin` | `security.test.ts` (escalada de privilégios) |
| Responsável gerencia só funcionários, não a si mesmo | `authorize_membership_target` | idem |
| Ninguém concede permissão superior à própria | `permissions_beyond` (concessões **e** retiradas) | `security.test.ts`, `parity.test.ts` |
| Funcionário nunca recebe ação administrativa em Equipe | `role_ceiling` + CHECK `valid_permissions` | `security.test.ts` |
| Último administrador não é removido nem desativado | trigger `guard_last_general_admin` + trava de concorrência | `security.test.ts`, `concurrency.test.ts` (Postgres real) |
| Desativar vínculo corta o acesso na hora | helpers leem o estado atual a cada consulta; vínculo/permissões/histórico preservados | `security.test.ts` (vínculos desativados e contas inativas) |
| Escritas diretas negadas | `REVOKE` + ausência de políticas de escrita | `security.test.ts` (escrita direta é negada) |
| Auditoria: ator, data, loja, alteração; append-only | triggers + `audit_immutable` (vale até para `service_role`) | `security.test.ts` (auditoria) |
| Operações relacionadas são transacionais | RPC/triggers na mesma transação; se a auditoria falha, nada é gravado | `security.test.ts` (atômicas) |
| Convites/contas só em operação protegida | Edge Function com chave de serviço; pré-check com a identidade do chamador | `invite-member.test.ts` |
| Convite não revela contas existentes | resposta idêntica; nome sempre exigido; sem rota de consulta de e-mail | `invite-member.test.ts`, `security.test.ts` (precheck…) |
| Freio a convites em massa | 30 cadastros/hora por pessoa (exceto admin geral) | `security.test.ts` (freio contra abuso) |
| Chave privilegiada fora do navegador | validação em `src/config/env.ts`; guarda estática | `env.test.ts`, `tests/static/no-secrets.test.ts` |

As regras de permissão existem em TypeScript (interface/demo) e em SQL (servidor). `parity.test.ts`
compara as duas com centenas de casos para que não divirjam.

### Auditoria

`audit_log` registra: `actor_id`/`actor_name` (quem), `created_at` (quando), `store_id`/`store_name` (onde,
nulo para eventos globais), `action`, `target_person_*`, `summary` legível e `details` (antes/depois das
permissões). Tem `seq` para ordem estrita. Nomes ficam copiados no registro, então o histórico sobrevive
a qualquer desativação. Leitura: administrador geral vê tudo; os demais, a auditoria das lojas onde têm
"visualizar" em Histórico. Ninguém altera ou apaga (trigger), nem pelo serviço.

### Convites

1. O responsável preenche e-mail, nome e permissões (o nome é sempre exigido para não revelar quem tem conta).
2. A Edge Function valida o JWT e chama `precheck_member_invite` **com a identidade dele**: sem permissão,
   nada acontece (nem consulta de contas).
3. Se o e-mail já tem conta, a identidade é **reaproveitada** (sem e-mail novo); senão a conta é
   convidada e ativada.
4. `create_membership` (de novo com a identidade do chamador) cria **somente o vínculo**, reaplicando todas as regras.
5. A resposta é a mesma nos dois casos. A pessoa convidada define a senha pelo link do e-mail.

## O que foi verificado (e o que não foi)

**Executado neste ambiente**

| Verificação | Como |
| --- | --- |
| Migrações aplicam do zero | PGlite e **PostgreSQL 16 real** |
| RLS, RPC, gatilhos, auditoria, bootstrap com identidades distintas (`anon`, funcionário, responsável, administrador, serviço, dono do banco) | `SET ROLE` + claims JWT, nos dois motores |
| Paridade das regras de permissão TS × SQL | 600 casos pseudoaleatórios determinísticos |
| Concorrência do "último administrador" | duas conexões reais (somente Postgres real) |
| Testes "mordem": afrouxar uma política RLS e remover a trava do último admin fazem a suíte falhar | mutações temporárias |
| Lógica da Edge Function | 22 testes com dependências falsas (autorização antes de qualquer efeito, resposta idêntica, CORS) |
| Serviços Supabase, mapeamento de erros, validação de ambiente, retorno de links de e-mail | testes unitários com cliente falso |
| Nenhum dado fictício no bundle de produção; demo sem cliente Supabase | inspeção dos arquivos gerados |
| Interface do modo real (login, erros neutros, recuperação, sessão expirada, convite→senha, conta desativada) | Playwright contra um **servidor falso** (`e2e/fake-supabase.cjs`) |
| Regressão do modo demonstração | Playwright (`e2e/fluxos.cjs`) |

**Depende de configuração externa (NÃO executado aqui)**

| Item | Por quê | Como verificar |
| --- | --- | --- |
| GoTrue real (login, convite, recuperação, e-mails, expiração real de JWT) | sem Docker/Supabase no ambiente | `npm run dev` com Supabase local + Inbucket |
| PostgREST real: status HTTP dos erros `PT4xx`, expansão de `auth.uid()` a partir do JWT real | idem; o harness emula `auth.uid()` e os papéis | `tests/live/stack.test.ts` (escrito, **ainda não executado**) |
| Edge Function no runtime Deno (`index.ts`) | sem Deno | `supabase functions serve` + `tests/live` |
| `supabase/config.toml` | CLI indisponível para validar | `supabase start` |
| `scripts/dev-seed.mjs` | exige a API de administração do Auth | `npm run dev:seed` local |
| Configurações do painel hospedado (checklist acima) | exigem seu projeto e credenciais | revisão manual do checklist |

## Limitações conhecidas e passos restantes

- **Resíduos de enumeração** (aceitos, documentados): um responsável vê erro específico para e-mails já
  vinculados à **própria** loja e para contas de administrador geral (recusa genérica); a diferença de
  tempo entre conta nova (envia e-mail) e existente pode ser medida.
- **Convite não aceito:** não há botão "reenviar convite"; a pessoa usa "Esqueci minha senha". Se algo falhar
  entre convidar e criar o vínculo, pode sobrar uma conta ativa sem vínculos (inofensiva; um novo cadastro a reaproveita).
- **Reativar um vínculo** restaura as permissões que ele já tinha; não valida de novo se o responsável que
  reativa as possuiria.
- **Contas do Auth não podem ser apagadas** (FK `restrict` para preservar histórico): use desativar conta.
- **Sem telas** para criar/editar lojas, reenviar convites ou exportar auditoria. Lojas: SQL (acima).
- **Sem MFA**, limitação de tentativas de login além da do Supabase, nem CSP aplicada pelo repositório
  (depende do host).
- **Financeiro, calendário e exportação** continuam não implementados (as permissões já existem no modelo).
- Falta executar `tests/live` e o roteiro hospedado, e revisar o painel conforme o checklist.

# Backend, autenticação e segurança (etapa 2)

Este documento descreve a arquitetura, como configurar o Supabase (local e hospedado), como criar o
**primeiro administrador com segurança**, onde cada regra de acesso é aplicada e o que foi (e o que
não foi) verificado.

> A validação foi feita contra uma pilha **local** (Docker + Supabase CLI). Nada foi executado contra um projeto Supabase remoto. As migrações **não** são aplicadas
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

Requer Docker e a [Supabase CLI](https://supabase.com/docs/guides/local-development) (validado com a 3.1.0).

```bash
supabase start      # Postgres, Auth (GoTrue), API (PostgREST), Edge Runtime e Mailpit (captura de e-mails)
supabase db reset   # aplica as 7 migrações e o supabase/seed.sql (lojas fictícias) SOMENTE no banco local
```

Crie as contas fictícias locais (a chave de serviço vem do **seu** terminal; nada é gravado em arquivo):

```bash
eval "$(supabase status -o env | sed 's/^/export /')"
SUPABASE_URL=$API_URL SUPABASE_SERVICE_ROLE_KEY=$SERVICE_ROLE_KEY npm run dev:seed
```

Configure o app com a chave **pública** e a função com as origens permitidas (valores não secretos):

```bash
cp .env.example .env.local                         # VITE_SUPABASE_URL=$API_URL  VITE_SUPABASE_ANON_KEY=$ANON_KEY
cp supabase/functions/.env.example supabase/functions/.env
supabase functions serve invite-member --env-file supabase/functions/.env   # em outro terminal
npm run dev                                        # em http://127.0.0.1:5173 (endereço usado nos redirecionamentos)
```

Entre com `bruno@dev.example` (responsável), `ana@dev.example` (administradora geral) etc. A senha de
desenvolvimento aparece na saída do `dev:seed`. **Os e-mails (convite, recuperação) não saem da sua máquina**:
ficam no Mailpit (`MAILPIT_URL` em `supabase status`), onde você abre os links.

> Mailpit confere o **conteúdo e os links** dos e-mails. Ele **não** valida a entrega por um SMTP hospedado
> (autenticação do remetente, SPF/DKIM, caixa de spam, limites do provedor). Veja o checklist do projeto hospedado.

### Verificando contra a pilha real

```bash
# 1) SQL/RLS/funções (Postgres embutido; com TEST_DATABASE_URL usa um Postgres real e roda a concorrência)
npm test

# 2) API real: Auth + PostgREST + Edge Function + Mailpit, com identidades reais
export LIVE_SUPABASE_URL=$API_URL LIVE_SUPABASE_ANON_KEY=$ANON_KEY LIVE_SERVICE_ROLE_KEY=$SERVICE_ROLE_KEY \
       LIVE_DB_URL=$DB_URL LIVE_MAIL_URL=$MAILPIT_URL
npx vitest run tests/live

# 3) Interface (build de produção) conectada à pilha, sem servidor falso (requer o pacote "playwright")
VITE_SUPABASE_URL=$API_URL VITE_SUPABASE_ANON_KEY=$ANON_KEY npm run build
npx vite preview --port 5173 --strictPort &
node e2e/stack-ui.cjs
```

`tests/live` e `e2e/stack-ui.cjs` usam a chave de serviço **apenas** para preparar/conferir casos no banco local e
recusam-se a rodar sem as variáveis `LIVE_*`. Ambos limpam as contas que criam.

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
| Freio a convites em massa | `reserve_invite_slot`: 30 reservas/hora por pessoa (exceto admin geral), atômica e **antes** do envio do e-mail | `security.test.ts`, `concurrency.test.ts`, `tests/live` (40 simultâneos) |
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
   nada acontece (nem consulta de contas, nem vaga consumida).
3. Reserva uma vaga do limite por hora (`reserve_invite_slot`, atômica) **antes** de consultar contas ou enviar e-mail.
4. Se o e-mail já tem conta, a identidade é **reaproveitada** (sem e-mail novo); senão a conta é convidada e
   ativada (`activate_profile`, só `service_role`).
5. `create_membership` (de novo com a identidade do chamador) cria **somente o vínculo**, reaplicando todas as regras.
6. A resposta é a mesma nos dois casos. A pessoa convidada define a senha pelo link do e-mail.

## O que foi verificado (e o que não foi)

Ambiente de validação: Supabase CLI 3.1.0 + Docker, pilha **local** (PostgreSQL 17.11, GoTrue v2.197, PostgREST
v16.5, Edge Runtime 1.78, Mailpit), além do PostgreSQL 16 e do PGlite para os testes de banco. Nada remoto.

| Fluxo | Ambiente | Resultado |
| --- | --- | --- |
| `config.toml` aceito pela CLI; `signup` público recusado; senha 10+ com maiúscula/minúscula/número; e-mail ativo | CLI 3.1.0 + GoTrue real | OK, após corrigir um defeito (abaixo) |
| Migrações do zero (`db reset`) + seed + `dev:seed` | Postgres 17 da pilha local | OK (7 migrações) |
| Login, senha errada (mensagem idêntica para e-mail inexistente), logout revogando a sessão | GoTrue real | OK |
| Recuperação de senha, definição de senha, link de uso único, e-mail desconhecido sem envio | GoTrue + Mailpit | OK |
| Convite de pessoa nova (conta ativada, só o vínculo, e-mail, definir senha, entrar) | Edge Function real + Mailpit + UI | OK |
| Vínculo de conta existente (uma identidade, dois vínculos, sem novo e-mail, resposta idêntica, nome intacto) | Edge Function real + UI | OK |
| Convite sem autorização (funcionário, responsável de outra loja, anônimo, token inválido, papel de responsável): nada criado, nenhum e-mail, nenhuma vaga consumida | Edge Function real | OK (403/401) |
| Permissões superiores às próprias (convite, RPC, edição, escrita REST direta) | PostgREST + Edge Function reais | OK (403) |
| Funcionário tentando outra loja por chamada direta (REST e RPC) | PostgREST real | OK (listas vazias / 403) |
| Desativar vínculo e conta com token já emitido | PostgREST real + UI | OK: a próxima chamada já é negada; interface converge sozinha |
| Último administrador (remoção, desativação, dois ao mesmo tempo) | PostgREST real + Postgres real | OK (409; nunca zero administradores) |
| Auditoria (ator, loja, texto, filtro por permissão, append-only inclusive para `service_role`) | PostgREST real | OK |
| Falha parcial (conta criada, vínculo falha / ativação falha) e repetição do convite | Edge Function real + falhas injetadas | OK: sem duplicação, sem novo e-mail |
| Dois responsáveis convidando o mesmo e-mail novo ao mesmo tempo | Edge Function real | OK: uma conta, um vínculo por loja |
| Limite de convites (40 simultâneos): no máximo 30 contas/e-mails | Edge Function real | OK; sem a trava o teste falha (mutação) |
| Bootstrap do primeiro administrador (procedimento documentado, do zero) | GoTrue + Postgres reais | OK; não repete; API não executa; schema `private` não exposto (406) |
| Sessão expirada (renovação do token recusada pelo servidor) | GoTrue real + UI | OK: volta ao login com aviso |
| Build de produção sem demonstração e sem chave privilegiada | arquivos gerados + UI servida do build | OK |
| Regressão do modo demonstração | Playwright | 46/46 |

**Contagem de testes:** 148 passam no PGlite e 150 no PostgreSQL 16 real (24 de integração live e 2 de concorrência
são pulados sem as variáveis de ambiente); `tests/live` 24/24 e interface 31/31 contra a pilha real, repetidos a
partir de um banco zerado.

### Defeitos encontrados na validação real (e corrigidos)

1. **`config.toml` desligava o login.** `[auth.email] enable_signup = false` foi lido pela CLI 3.1 como "provedor de
   e-mail desativado": ninguém entrava (`Email logins are disabled`). Removido; o cadastro público continua bloqueado
   por `[auth] enable_signup = false` (`signup_disabled` verificado).
2. **Falso positivo no teste da Edge Function.** A função não iniciava (503) e o teste passava porque exigia apenas
   "algum erro". Agora todos os testes exigem status e código exatos, e há um teste de que a função inicia.
3. **Limite de convites não era atômico.** Contava vínculos já criados e era checado antes do envio do e-mail; com
   chamadas simultâneas, todas enviavam e-mail. Substituído por `reserve_invite_slot` (migração `…000700`): reserva
   serializada por pessoa **antes** de consultar contas ou enviar e-mail. Verificado com 40 chamadas simultâneas.
4. **Interface desatualizada após desativação.** Com o token ainda válido o servidor já negava os dados, mas o menu
   e as permissões antigas ficavam na tela. A resposta "proibido" agora dispara a revalidação da sessão.
5. **Build de produção ainda trazia o código da demonstração** (componentes e textos, desligados só em execução).
   Agora uma constante de build (`__DEMO_BUILD__`) elimina tudo: nenhum arquivo, texto ou dado de demonstração.

### Ativação de contas: quem pode ativar, e como

Contas nascem **inativas** (`active=false`, `activated_at=null`) e não enxergam nada. Só existem dois caminhos:

| Caminho | Quem | Verificação |
| --- | --- | --- |
| Convite: `activate_profile` (execução restrita ao `service_role`) | Edge Function, **depois** de validar o JWT, conferir a autorização e reservar a vaga; registra o convidante na auditoria | `tests/live` (convites), `security.test.ts` |
| `private.bootstrap_first_general_admin` | Dono do banco, pelo SQL Editor, só se não houver administrador | `bootstrap.test.ts`, procedimento real do zero |

Usuário criado direto no painel/Admin API, ou por cadastro público acidental, continua **inativo e sem acesso** até
um desses caminhos (verificado). `activate_profile` só age em contas nunca ativadas: não reativa uma conta que o
administrador desativou.

### Se o Auth cria a conta mas o vínculo falha

Resultado observado (falha injetada no banco local): o convite devolve erro genérico (sem detalhes internos); a conta
fica **ativa e sem vínculos** (vê "Sem acesso a nenhuma loja", inofensiva) e um e-mail de convite já foi enviado.
**Repetir o convite** reaproveita a conta, cria o vínculo, **não duplica** nada e **não reenvia** e-mail. Se a falha foi
na ativação, a conta fica inativa e a repetição a ativa. Cada tentativa consome uma vaga do limite por hora.

### Ainda depende de configuração externa (NÃO executado)

| Item | Por quê | Como verificar |
| --- | --- | --- |
| Entrega real de e-mails por SMTP hospedado (remetente, SPF/DKIM, spam) | a validação usou o Mailpit local | enviar um convite de teste no projeto hospedado com SMTP próprio |
| Ajustes do painel hospedado (signup, senha, redirects, schemas expostos) | exigem seu projeto | checklist acima; repetir `signup` e login contra a URL hospedada |
| `supabase db push` e `functions deploy` no projeto hospedado; `supabase functions serve --env-file` na sua máquina | não executei nada remoto; usei o runtime local com as variáveis injetadas no contêiner | seguir "Rodando localmente" e o checklist |
| Limites de e-mail/tentativas do Auth hospedado | são globais e vêm do painel; o local foi elevado só para testar | revisar no painel conforme o SMTP |

> Observação de ambiente: nesta sandbox o proxy reassina o TLS e o runtime de Edge Functions não confiava na CA dele
> para baixar `@supabase/supabase-js`. Para validar a função **real** sem mudar seu código, o contêiner do runtime foi
> recriado com as mesmas configurações da CLI, apontando para um espelho local do registro npm. Isso é
> específico desta sandbox e **não é necessário** em uma máquina comum.

## Módulo financeiro (parte 1: contas e liquidações de uma loja)

**Migrações** (aditivas; as anteriores não foram alteradas): `20261112000100_finance_permissions`,
`…000200_finance_schema`, `…000300_finance_rpc`, `…000400_finance_receipts_storage`.

- **Modelo.** `finance_accounts` (a pagar/receber, exclusiva de **uma** loja, valor em centavos `bigint`,
  competência/vencimento como `date` sem fuso) e `finance_payments` (liquidações). Situação, saldo e atraso
  vêm da view `finance_accounts_v` (`security_invoker`): `pendente`, `parcial`, `quitada`, `cancelada`; atraso =
  vencimento < hoje em America/Sao_Paulo **e** saldo em aberto > 0. Nada é gravado como "situação".
- **Invariantes no banco (gatilhos, valem para qualquer escritor):** liquidação > 0 e ≤ saldo; loja, tipo e
  moeda imutáveis; valor da conta nunca abaixo do já liquidado; sem DELETE/TRUNCATE; pagamento imutável exceto
  estorno, anexo e confirmação de envio. `FOR UPDATE` na conta serializa liquidações concorrentes.
- **Idempotência:** `(conta, chave)` e `(loja, chave)`. Repetir a mesma requisição devolve a mesma liquidação.
- **Estorno** exige motivo, preserva a linha e devolve o saldo. Conta com liquidações ativas só é cancelada
  depois de estorná-las.
- **Comprovantes:** bucket privado `receipts` (5 MiB; jpeg/png/webp/pdf), caminho
  `{loja}/{conta}/{pagamento}/{arquivo}`. Ver/baixar exige `finance.view` na loja; enviar exige
  `finance.settle` e pagamento existente, não estornado e sem comprovante; sem update/delete. A RPC
  `attach_payment_receipt` lê os metadados do próprio Storage. **Anexar não confirma envio:** a
  confirmação (`confirm_receipt_sent`, quem/quando) é separada e exige a ação `confirm_send`; o sistema não envia nada.
- **Permissões** (módulo `finance`): `view`, `create`, `edit`, `delete` (= **cancelar conta**), `export`, e as
  novas `settle`, `reverse`, `confirm_send`. **A migração não altera `memberships.permissions`**: ninguém ganha
  ação nova automaticamente (nem responsáveis existentes); um administrador geral ou responsável concede pela matriz.
  Consolidado (todas as lojas) é somente leitura e exclusivo de administrador geral.
- **Auditoria:** gatilhos gravam `financeiro_*` em `audit_log`; o histórico por conta vem da RPC
  `finance_account_history` (exige `finance.view`).

**Verificação (local, pilha real, sem nada remoto):** `supabase db reset` aplica as 11 migrações do zero;
testes de banco (PGlite 84+, PostgreSQL 16 real 93/93, incluindo 10 liquidações simultâneas disputando o mesmo
saldo — removendo o `FOR UPDATE` o teste falha); `tests/live` 44/44 contra Auth/PostgREST/Storage/Edge reais
(permissões por HTTP com identidades distintas, parciais, estorno, repetição, acesso a anexos, concorrência,
filtros/resumos); UI com navegador contra a pilha real: `e2e/finance-ui.cjs` 39/39, `e2e/stack-ui.cjs` 31/31,
`e2e/fluxos.cjs` (demo) 46/46.

**Limitações do financeiro:** o tipo real do arquivo é conferido por mime/tamanho no Storage e por *magic bytes*
no cliente (sem varredura de conteúdo no servidor); comprovante não pode ser trocado depois de anexado e a
confirmação de envio não pode ser desfeita (corrija estornando e relançando); um upload que falha após o
pagamento salvo pode deixar objeto órfão no Storage (a liquidação não duplica ao repetir); o modo demonstração
não simula o financeiro; sem rateio, reembolso entre lojas, recorrência, exportação nem transferências bancárias.

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
- **Calendário e exportação** continuam não implementados; o financeiro cobre só contas e liquidações (ver seção acima).
- Falta a verificação do projeto **hospedado** (painel, SMTP, `db push`, deploy da função): veja a tabela acima.

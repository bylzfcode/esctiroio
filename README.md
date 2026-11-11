# Painel de Lojas

Sistema administrativo para quatro ou mais lojas: **autenticação, lojas, equipe, permissões e auditoria**.
Financeiro (contas e liquidações por loja) existe só no backend real; calendário ainda não (estado vazio).

O app tem **dois modos, sempre explícitos e separados**:

| Modo | Como ligar | O que é |
| --- | --- | --- |
| **Real** (padrão) | `npm run dev` / `npm run build` | Supabase Auth + PostgreSQL com RLS. Login por e-mail e senha, convite, recuperação de senha. **Exige configuração**; sem ela o app mostra uma orientação e **nunca** cai no mock. |
| **Demonstração** | `npm run dev:demo` / `npm run build:demo` | Dados fictícios no navegador, sem backend e **sem login real** (seletor de perfis). Faixa amarela permanente. O build de produção normal não contém esse código nem os dados. |

> Segurança: o que cada pessoa pode ver ou fazer é decidido **no servidor** (RLS + funções do banco).
> Esconder menus no navegador é só conveniência. Detalhes e verificações em [`docs/BACKEND.md`](docs/BACKEND.md).

## Tecnologias

React 19, TypeScript, Vite, Tailwind CSS 3, React Router, Lucide · Supabase (Auth, PostgreSQL, Edge Functions) · Vitest.

## Como executar

Requer Node.js 20.19+ (ou 22.12+).

```bash
npm install
```

**Demonstração (sem nada configurado):**

```bash
npm run dev:demo
```

**Backend real:** crie `.env.local` a partir de `.env.example` com a URL e a chave **pública** do projeto
Supabase e rode `npm run dev`. O passo a passo completo (Supabase local ou hospedado, Edge Function,
**criação segura do primeiro administrador**) está em [`docs/BACKEND.md`](docs/BACKEND.md).

Outros comandos:

```bash
npm run build         # tipos + build de produção (backend real; não publica nada)
npm run build:demo    # build do modo demonstração
npm run typecheck     # app, ferramentas e testes/servidor
npm test              # testes (inclui SQL/RLS num Postgres embutido, sem instalar nada)
npm run dev:seed      # contas fictícias no Supabase LOCAL (recusa qualquer URL que não seja localhost)
```

Teste de banco em um PostgreSQL real (inclui o teste de concorrência), com um banco **descartável**:

```bash
TEST_DATABASE_URL=postgres://usuario:senha@127.0.0.1:5432/postgres npm test
```

Cada arquivo de teste cria e remove o seu próprio banco temporário.

## Modelo de acessos

- **Conta** (`profiles`) e **vínculo com a loja** (`memberships`) são entidades separadas. Uma conta tem
  vários vínculos; cada um tem perfil, cargo, permissões e situação **próprios da loja**.
- Perfis: **Administrador geral** (todas as lojas e visão consolidada), **Responsável** (administra a loja e
  seus funcionários; pode haver vários) e **Funcionário** (só o que foi liberado).
- Permissões por módulo: visualizar, criar, editar, excluir, exportar. Sem "visualizar" não há outras ações.
- **Somente o administrador geral** concede ou remove os papéis de responsável e de administrador geral.
- Responsáveis gerenciam apenas funcionários das lojas que administram; não alteram outros responsáveis nem o
  próprio vínculo; **ninguém concede permissões que não possui**.
- O **último administrador geral ativo** não pode ser removido nem desativado.
- Desativar um vínculo corta **imediatamente** o acesso àquela loja e preserva a conta, os outros vínculos e o histórico.
- Cadastro de funcionário **por convite**: se o e-mail já tem conta, a identidade é reaproveitada e só o vínculo é
  criado — e a resposta é a mesma nos dois casos (não revela quem tem conta).
- Toda alteração é auditada (quem, quando, loja, o quê); o histórico é somente de acréscimo.

## Verificações

Validadas contra uma **pilha Supabase local real** (Supabase CLI + Docker: PostgreSQL 17, Auth/GoTrue, PostgREST,
Edge Functions e Mailpit para capturar e-mails). Nada foi aplicado em projeto remoto.

| | Resultado |
| --- | --- |
| Tipos (`tsc -b`) e builds (`build`, `build:demo`) | sem erros |
| `npm test` (PGlite) | 148 passam, 26 pulados* |
| `TEST_DATABASE_URL=… npm test` (PostgreSQL 16 real, com concorrência) | 150 passam, 24 pulados* |
| `tests/live`: Auth + PostgREST + Edge Function reais, identidades reais | 24/24 (repetido a partir de banco zerado) |
| Interface (build de produção) × pilha real, sem servidor falso | 31/31 |
| Regressão do modo demonstração (Playwright) | 46/46 |
| Build de produção | sem arquivos, textos ou dados de demonstração; sem chave privilegiada |

\* Pulados: `tests/live` (24, exigem a pilha em execução) e a concorrência (2, exigem Postgres real).

**Ainda não verificado (depende de ambiente externo):** entrega por SMTP hospedado, ajustes do painel do projeto
hospedado, `supabase db push` e deploy da função em projeto remoto. Os fluxos, os defeitos encontrados na validação e
como reproduzir tudo estão em [`docs/BACKEND.md`](docs/BACKEND.md#o-que-foi-verificado-e-o-que-não-foi).

## Modo demonstração

Dados **fictícios** (lojas Alfa, Beta, Gama, Delta; e-mails `demo.example`) em `src/services/mock/seed.ts`,
guardados no `localStorage`. Perfis para explorar:

| Perfil | O que observar |
| --- | --- |
| **Ana Ribeiro** (administradora geral) | Visão consolidada + 4 lojas; concede/remove administrador e desativa contas (o último administrador é protegido). |
| **Bruno Almeida** (responsável na Alfa) | Gerencia funcionários; outro responsável e o próprio vínculo aparecem bloqueados. |
| **Carla Mendes** (responsável na Beta, funcionária na Gama) | O menu muda ao trocar de loja; em `/equipe`, ir para a Gama redireciona com aviso. |
| **Igor Lima** | Permissões diferentes por loja. |
| **Marcos Teixeira** | Vínculo desativado na Alfa: só a Delta aparece. |
| **Patrícia Gomes** | Todos os vínculos desativados: sem acesso. |

Nada disso é autenticação, e as verificações do modo demonstração rodam no navegador.

## Organização

```
src/
  config/      escolha explícita do modo e validação do ambiente (rejeita chave privilegiada)
  demo/        interface exclusiva da demonstração (só existe no build --mode demo)
  domain/      tipos e regras de acesso/permissões (puras)
  services/    contratos (types.ts) + supabase/ (real) + mock/ (demonstração)
  context/     tema, avisos, autenticação e sessão
  components/  ui/, layout/, team/
  pages/       Visão geral, Financeiro, Equipe, Calendário, Histórico, Configurações, Entrar, Definir senha
supabase/
  migrations/  esquema, RLS, gatilhos, auditoria, RPC, bootstrap do 1º administrador
  functions/   Edge Function de convite (única que usa a chave de serviço)
  seed.sql     lojas fictícias SÓ para desenvolvimento local
tests/         db/ (SQL/RLS), live/ (pilha real, opcional), static/ (segredos)
e2e/           roteiros Playwright opcionais (demo, interface do modo real e interface × pilha real)
docs/BACKEND.md
```

## O que ainda não existe

- Calendário e exportação; financeiro além de contas/liquidações (rateio, recorrência, reembolsos). Detalhes em `docs/BACKEND.md`.
- Telas para criar/editar lojas, reenviar convites e exportar auditoria.
- MFA e política de cabeçalhos HTTP (CSP) no repositório (dependem do host).
- Execução automatizada em CI e a validação do projeto **hospedado** (veja `docs/BACKEND.md`).

Fora de escopo e não implementado: catálogo comercial, vitrine, pedidos e automação de vendas.

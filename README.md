# Painel de Lojas — etapa 1

Primeira etapa de um sistema administrativo para quatro ou mais lojas: **estrutura visual, navegação e modelo de acessos**. O financeiro e o calendário serão desenvolvidos depois.

> **Isto é uma demonstração.** Não há backend, login nem dados reais. A escolha de perfil na tela inicial **não é autenticação** e as verificações de permissão feitas no navegador **não são segurança de produção**.

## Tecnologias

React 19, TypeScript, Vite, Tailwind CSS 3, React Router e Lucide (ícones). Testes unitários com Vitest.

## Como executar

Requer Node.js 20.19 ou superior (ou 22.12+).

```bash
npm install
npm run dev
```

Abra o endereço mostrado no terminal (normalmente http://localhost:5173).

Outros comandos:

```bash
npm run build       # TypeScript + build de produção (pasta dist/, não publicada)
npm run typecheck   # só a checagem de tipos
npm test            # testes das regras de acesso e dos serviços
```

Não são necessárias variáveis de ambiente. Veja `.env.example`.

## Como testar os perfis e a troca de loja

Ao abrir o app você escolhe um perfil fictício. Troque de perfil a qualquer momento em **menu do usuário → Trocar perfil de demonstração** (ou no botão da faixa amarela).

| Perfil | O que observar |
| --- | --- |
| **Ana Ribeiro** (administradora geral) | Seletor com **Visão consolidada** + 4 lojas. É a única que vê a visão consolidada. Pode cadastrar responsáveis e alterar qualquer vínculo. |
| **Bruno Almeida** (responsável na Alfa) | Gerencia os funcionários da Alfa. Helena (outra responsável) e o próprio vínculo aparecem bloqueados. |
| **Diego Faria** (responsável na Gama e na Delta) | Duas lojas no seletor, ambas com gestão de equipe. |
| **Carla Mendes** (responsável na Beta, funcionária na Gama) | Na Beta o menu tem Equipe e permissões; ao trocar para a Gama o menu cai para Visão geral e Calendário. Estando em `/equipe` e trocando para a Gama, você é **redirecionada** com um aviso. |
| **Igor Lima** (funcionário na Alfa e na Beta) | Permissões diferentes por loja: Calendário existe na Alfa e não na Beta. |
| **Marcos Teixeira** | Vínculo **desativado** na Alfa: só a Delta aparece. |
| **Fábio Santos** | Funcionário que pode apenas consultar a equipe (sem botões de edição). |
| **Patrícia Gomes** | Todos os vínculos desativados: tela de "sem acesso". |

Fluxos sugeridos em **Equipe e permissões** (como Bruno ou Ana, em uma loja):

1. **Novo funcionário** com `lucas@demo.example`: a conta existente é reaproveitada e só o vínculo com a loja é criado.
2. Na matriz de permissões, desmarque **Visualizar**: as demais ações do módulo são limpas e bloqueadas.
3. **Editar** um funcionário e salvar; **Desativar** com confirmação e depois **Reativar** (filtro "Inativos").
4. Abra **Histórico de atividades** para ver os registros locais. Depois entre como a pessoa afetada para ver o efeito no seletor de lojas.

Em **Configurações** há duas ferramentas só da demonstração: simular falha de carregamento (para ver o estado de erro) e restaurar os dados iniciais.

## Modelo de acessos

- **Conta** (`Person`) e **vínculo** (`Membership`) são entidades separadas. Uma conta tem vários vínculos; cada vínculo tem perfil, cargo, permissões e situação **próprios da loja**.
- Perfis: **Administrador geral** (todas as lojas e visão consolidada), **Responsável** (administra a loja e seus funcionários) e **Funcionário** (só o que foi liberado).
- Permissões por módulo: visualizar, criar, editar, excluir, exportar. Sem "visualizar" não há nenhuma outra ação.
- Responsáveis **não** podem: criar administradores gerais, cadastrar/alterar/desativar outros responsáveis, alterar o próprio vínculo nem conceder (ou retirar) permissões que eles mesmos não possuem.
- Funcionários nunca recebem ações administrativas em "Equipe e permissões" (apenas visualizar); gerir equipe exige perfil de responsável.
- Desativar um vínculo muda só aquele vínculo: a conta, os outros vínculos e o histórico permanecem. O vínculo pode ser reativado com as mesmas permissões.
- O seletor de lojas mostra só lojas com vínculo ativo. Ao trocar de loja, menu e permissões são recalculados; se a página atual não for permitida, há redirecionamento para a primeira página autorizada.

As regras estão em `src/domain` (funções puras) e são reaplicadas na camada de serviços.

## O que é fictício

- **Tudo.** Lojas (Alfa, Beta, Gama, Delta), pessoas, e-mails (domínio reservado `demo.example`), vínculos, permissões e o histórico inicial estão em `src/services/mock/seed.ts`.
- Alterações feitas na demonstração ficam no `localStorage` do navegador (chave `esctiroio.demo.dados.v1`) e podem ser apagadas em Configurações → Restaurar.
- O atraso de rede é simulado para exercitar os estados de carregamento.

## O que ainda não existe

- Autenticação, senhas, recuperação de conta e sessões reais.
- Backend, banco de dados e autorização no servidor.
- **Financeiro** e **Calendário**: apenas estados vazios explicativos. As permissões desses módulos já podem ser configuradas, mas não há ações para executar.
- Exportação (a permissão existe no modelo; não há exportação implementada).
- Convite por e-mail, edição dos dados da própria conta pelo usuário, criação de novas lojas e de administradores gerais.
- Testes automatizados de interface no CI (há um roteiro manual em `e2e/`).

Fora do escopo desta etapa e não implementado: catálogo comercial, vitrine, pedidos e automação de vendas.

## Organização do código

```
src/
  domain/      tipos, módulos/ações e regras de acesso e permissões (puras, testadas)
  services/    contratos (types.ts) e implementação fictícia (mock/)
  context/     tema, avisos (toasts) e sessão de demonstração
  hooks/       useAsync (carregamento/erro/recarregar)
  components/  ui/ (primitivos), layout/ (menu, cabeçalho, seletor de loja), team/
  pages/       Visão geral, Financeiro, Equipe, Calendário, Histórico, Configurações
  app/         configuração de navegação
e2e/           roteiro opcional de verificação no navegador (Playwright)
```

### Trocando o mock por um backend

A interface só usa o contrato `Services` (`src/services/types.ts`). Para integrar:

1. Crie uma implementação de `Services` que chame a API (por exemplo com `fetch`).
2. Troque `createMockServices()` em `src/services/index.ts`.
3. Substitua o seletor de perfil por autenticação real e entregue `SessionSnapshot` a partir da sessão autenticada.
4. Reaplique **no servidor** todas as regras de `src/domain/access.ts` e `src/services/mock/backend.ts` (autorização por loja, limites do responsável, concessão de permissões).

Não coloque segredos em variáveis `VITE_*`: elas vão para o navegador.

## Verificação sem navegador

`npm test` cobre: normalização e limites de permissões, escopo de lojas por perfil, visão consolidada exclusiva, regras do responsável, cadastro com reaproveitamento de conta, desativação/reativação, persistência e registro de histórico.

## Roteiro no navegador (opcional)

Com `npm run dev` rodando e o Playwright instalado:

```bash
npm i -D playwright && npx playwright install chromium
node e2e/fluxos.cjs
```

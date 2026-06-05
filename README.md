# stack-mcp — Vendly MCP Server

Servidor MCP (Model Context Protocol) em TypeScript para a plataforma **Vendly** — atendimento ao cliente via WhatsApp com IA, com domínio completo de delivery (restaurantes, pedidos, entregadores).

Expõe ferramentas para que agentes de IA (Claude, GPT, etc.) operem toda a infraestrutura da Vendly: enviar mensagens WhatsApp com menções nativas, criar workflows N8N, consultar MongoDB/Redis/Qdrant, gerenciar pedidos de delivery, e muito mais.

---

## URLs dos serviços

| Serviço      | URL                                        |
|--------------|--------------------------------------------|
| Evolution    | `https://evolution.vendly.chat`            |
| N8N          | `https://workflows.vendly.chat`            |
| N8N API      | `https://workflows.vendly.chat/api/v1`     |
| Chatwoot     | `https://chatwoot.vendly.chat`             |
| Coolify      | `https://coolify.redatudo.online`          |
| MCP (prod)   | `https://app.vendly.chat/mcp`             |

---

## Ferramentas MCP

| Módulo          | Prefixo(s)                               | Descrição                                         |
|-----------------|------------------------------------------|---------------------------------------------------|
| Evolution API   | `evolution_`                             | WhatsApp — envio de texto, mídia, menções, grupos |
| N8N             | `n8n_`                                   | Workflows, execuções, credenciais                  |
| Chatwoot        | `chatwoot_`                              | Conversas, contatos, agentes, etiquetas            |
| MongoDB         | `mongo_`                                 | Queries, inserts, updates, aggregations            |
| Redis           | `redis_`                                 | GET/SET/DEL, listas, sessões                       |
| Qdrant          | `qdrant_`                                | Vetores, coleções, busca semântica                 |
| Coolify         | `coolify_`                               | Deploy, serviços, variáveis de ambiente            |
| Intelligence    | `intelligence_`, `customer_`, `business_`| Base de conhecimento, memória RAG, perfis          |
| System          | `system_`                                | Limpeza de conversas e estado por contato          |
| Delivery        | `delivery_`                              | Restaurantes, pedidos, entregadores, grupo         |

---

## Arquitetura — regra crítica

```
Agente IA ──► MCP (stack-mcp) ──► Serviços (Evolution, N8N, Redis, MongoDB...)
N8N runtime ──► Serviços DIRETAMENTE (nós nativos, nunca via MCP)
```

- Workflows N8N usam nós nativos (`n8n-nodes-base.redis`, `n8n-nodes-base.httpRequest`).
- **Nunca** chamar a URL MCP dentro de nós N8N — N8N em nuvem não acessa localhost.
- N8N pode chamar o endpoint REST `/tool/:name` (porta 3000) para executar tools MCP sem sessão.

---

## Fluxo de mensagem WhatsApp

```
Evolution API → Webhook /chatwoot-bot → [CORE] Entrada de Mensagem
  → Normalizar Mensagem
  → Redis GET Contact Filter → Aplicar Filtro Contatos   (bloqueia blacklist/whitelist)
  → Redis GET human_takeover → Auto-Aceitar Conversa     (pula se humano assumiu)
  → Redis GET Dedup → IF Já Processado?
  → PUSH Buffer → Setar Timestamp Debounce → Chamar Debounce

→ [CORE] Processar Buffer (Debounce)
  → aguarda 5s → Verificar timestamp → llen buffer
  → POP Buffer (xN) → Consolidar → Chamar Executor

→ [AGENT] Executor
  → Redis GET sessão → Construir Prompt → OpenRouter chat/completions
  → Loop multi-round tools → Evolution sendText (com mentionedList) → Redis SET sessão
```

### Grupo de entregadores

Mensagens no grupo de entregadores têm filtro estrito:
- Aceita **reply** a mensagem do bot, **OU** mensagem de usuário com pedido ativo em aberto.
- Broadcasts e notificações usam `mentionsEveryOne: true`.
- Menções individuais via `mentionedList` (auto-detectado no texto com `@phone`).

---

## Workflows N8N principais

| Workflow                           | ID                 | Status |
|------------------------------------|--------------------|--------|
| [CORE] Entrada de Mensagem         | `bEb19TdWZfFloisU` | ativo  |
| [CORE] Processar Buffer (Debounce) | `FacKqM3e2LsHE6NY` | ativo  |
| [AGENT] Executor                   | `jleu4RPvSnYDL8Gd` | ativo  |
| [ADMIN] Provisionar Negócio        | `IlSk5TsGYvAUDbro` | ativo  |
| [OBJECTIVES] Manager               | `vbCaEvxL60aBgsmB` | ativo  |

---

## Domínio Delivery

Sistema completo para restaurantes que operam delivery via WhatsApp:

### Entidades principais (MongoDB)
- `delivery_restaurants` — restaurantes com endereço e businessId
- `delivery_orders` — pedidos com ciclo de vida completo
- `delivery_deliverers` — entregadores cadastrados por restaurante

### Ciclo de vida do pedido
```
draft → pending → assigned → in_transit → delivered
                           ↘ cancelled
```

### Referências de pedido
Pedidos têm `orderRef` no formato `LT-XXXXXX-XXX` (base36) aceito como alternativa ao ObjectId MongoDB em todas as ferramentas.

### Taxa de entrega
Calculada automaticamente via **Google Routes API** (distância em linha reta com fator 1.3 × tarifa/km do restaurante). Exibida em EUR.

### Ferramentas `delivery_*`
| Ferramenta                        | Descrição                                              |
|-----------------------------------|--------------------------------------------------------|
| `delivery_draft_order`            | Cria ou atualiza rascunho de pedido                    |
| `delivery_confirm_order`          | Confirma e posta no grupo de entregadores              |
| `delivery_assign_deliverer`       | Atribui entregador (por ObjectId, orderRef ou phone)   |
| `delivery_update_order_status`    | Atualiza status (aceita orderRef)                      |
| `delivery_cancel_by_deliverer`    | Entregador cancela atribuição (abre concorrência)      |
| `delivery_cancel_by_restaurant`   | Restaurante cancela pedido                             |
| `delivery_list_orders`            | Lista pedidos por restaurante/entregador/status        |
| `delivery_get_order`              | Detalha um pedido                                      |
| `delivery_list_deliverers`        | Lista entregadores (por restaurante)                   |
| `delivery_register_deliverer`     | Cadastra entregador com telefone/JID                   |
| `delivery_post_to_command_group`  | Posta mensagem no grupo de entregadores                |
| `delivery_list_restaurants`       | Lista restaurantes do negócio                          |

---

## Módulo Intelligence

Base de conhecimento semântica sobre Qdrant:

| Ferramenta               | Descrição                                                  |
|--------------------------|------------------------------------------------------------|
| `intelligence_add`       | Adiciona bloco de texto vetorizado (produto, FAQ, insight) |
| `intelligence_search`    | Busca semântica por relevância                             |
| `customer_*`             | Perfis e histórico de clientes                             |
| `business_*`             | Configurações e perfis de negócios                         |

---

## Módulo System

| Ferramenta                    | Descrição                                              |
|-------------------------------|--------------------------------------------------------|
| `system_clear_contact`        | Limpa sessão, buffer e conversas de um contato         |
| `system_clear_all_conversations` | Limpa todos os contatos (Chatwoot + Redis + Mongo) |
| `system_health`               | Status de conectividade de todos os serviços           |

---

## Variaveis de ambiente (.env)

```env
# WhatsApp
EVOLUTION_URL=https://evolution.vendly.chat
EVOLUTION_API_KEY=...

# Automação
N8N_URL=https://workflows.vendly.chat
N8N_API_KEY=...

# Atendimento
CHATWOOT_URL=https://chatwoot.vendly.chat
CHATWOOT_API_KEY=...
CHATWOOT_ACCOUNT_ID=1

# Banco de dados
MONGODB_URI=mongodb://root:pass@host:27017
REDIS_HOST=...
REDIS_PORT=...
REDIS_PASSWORD=...

# Vetorial
QDRANT_URL=http://...
QDRANT_API_KEY=...

# Deploy
COOLIFY_URL=https://coolify.redatudo.online
COOLIFY_TOKEN=...

# IA
OPENROUTER_API_KEY=sk-or-v1-...
OPENROUTER_MODEL=meta-llama/llama-3.3-70b-instruct:free
OPENROUTER_MULTIMODAL_MODEL=google/gemini-2.0-flash-lite-001
OPENROUTER_EMBEDDING_MODEL=...
GOOGLE_ROUTES_API_KEY=...

# Servidor
PORT=3000
```

---

## Build e deploy

```powershell
# Build TypeScript → dist/ + dashboard
npm run build

# Deploy: push para main, Coolify faz redeploy automático
git push

# Dev local (porta 3001)
$env:PORT = "3001"; node dist/index.js

# Setup inicial (1x após deploy): configura credenciais N8N e atualiza workflows
node scripts/setup-stack.mjs
```

---

## Estrutura de código

```
src/
  config.ts          — lê .env, exporta config tipado
  index.ts           — servidor MCP + Express, roteamento por prefixo
  tools/
    evolution.ts     — WhatsApp (Evolution API)
    n8n.ts           — workflows, execuções, credenciais N8N
    chatwoot.ts      — conversas, contatos, agentes Chatwoot
    mongodb.ts       — MongoDB queries e operações
    redis.ts         — Redis cache, sessões, listas
    qdrant.ts        — vetores e busca semântica Qdrant
    coolify.ts       — deploy e serviços Coolify
    intelligence.ts  — base de conhecimento RAG (intelligence_, customer_, business_)
    system.ts        — manutenção: limpeza de conversas e estado
    delivery.ts      — domínio delivery: pedidos, restaurantes, entregadores
  utils/
    http.ts          — axios client factory, safeRequest, toText
  web/
    router.ts        — Express routing
    auth.ts          — autenticação do dashboard
    email.ts         — envio de e-mail via Nodemailer (Brevo)
    routes/
      businesses.ts      — CRUD de negócios
      customers.ts       — clientes
      agents.ts          — agentes de IA
      conversations.ts   — histórico de conversas
      delivery.ts        — operações de delivery
      analytics.ts       — métricas e relatórios
      knowledge.ts       — base de conhecimento
      connect.ts         — integrações e conexões
dashboard/
  src/               — React + Ant Design + React Query
  vite.config.ts
snapshots/
  wf-entrada-v1.json     — [CORE] Entrada de Mensagem
  wf-debounce-v1.json    — [CORE] Processar Buffer
  wf-executor-v1.json    — [AGENT] Executor
scripts/
  setup-stack.mjs        — setup inicial N8N
  test-all-usecases.mjs  — suite de testes de casos de uso
  create-lt-business.mjs — provisionar novo negócio LT
```

---

## Dashboard

Interface React + Ant Design em `dashboard/src/` com backend Express em `src/web/`.

**Páginas:**
- **Painel** — visão geral do negócio
- **Negócios** — configuração de instâncias, prompt, escalada
- **Clientes** — lista e detalhes de clientes
- **Conversas** — histórico de atendimentos
- **Delivery** — gestão de pedidos
- **Pedidos / Restaurantes / Entregadores** — CRUD do domínio delivery
- **WhatsApp** — gerenciamento de instâncias Evolution
- **Relatórios / Analytics** — métricas por restaurante e entregador
- **Base de Conhecimento** — documentos e FAQs
- **Acertos** — conciliação financeira de entregas
- **Manutenção** — limpeza de sessões e estado

---

## Adicionando uma nova ferramenta

1. Em `src/tools/servico.ts`, adicionar na array `servicoTools`:

```typescript
{
  name: 'servico_acao',
  description: 'Descrição em pt-BR.',
  inputSchema: {
    type: 'object',
    required: ['param'],
    properties: { param: { type: 'string', description: '...' } },
  },
},
```

2. Adicionar o case em `handleServicoTool`:

```typescript
case 'servico_acao': {
  const res = await safeRequest(() => http.post('/endpoint', args).then(r => r.data));
  return toText(res);
}
```

3. `npm run build` + `git push`

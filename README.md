# stack-mcp — Vendly MCP Server

Servidor MCP (Model Context Protocol) em TypeScript para a plataforma **Vendly** — atendimento ao cliente via WhatsApp com IA.

Expõe ferramentas para que agentes de IA (Claude, GPT, etc.) operem toda a infraestrutura da Vendly: enviar mensagens WhatsApp, criar workflows N8N, consultar MongoDB/Redis/Qdrant, gerenciar instâncias Evolution, Chatwoot e Coolify.

---

## URLs dos serviços

| Serviço    | URL                                          |
|------------|----------------------------------------------|
| Evolution  | `https://evolution.vendly.chat`              |
| N8N        | `https://workflows.vendly.chat`              |
| N8N API    | `https://workflows.vendly.chat/api/v1`       |
| Chatwoot   | `https://chatwoot.vendly.chat`               |
| Coolify    | `https://coolify.redatudo.online`            |
| MCP (prod) | `https://app.vendly.chat/mcp` |

---

## Ferramentas MCP

| Serviço         | Ferramentas | Prefixo          |
|-----------------|-------------|------------------|
| Evolution API   | 10          | `evolution_`     |
| N8N             | 9           | `n8n_`           |
| Chatwoot        | 10          | `chatwoot_`      |
| MongoDB         | 11          | `mongo_`         |
| Redis           | 11          | `redis_`         |
| Qdrant          | 9           | `qdrant_`        |
| Coolify         | 16          | `coolify_`       |

---

## Build e deploy

```powershell
# Build TypeScript ? dist/
npm run build

# Deploy: push para main, Coolify faz redeploy automatico
git push

# Dev local (porta 3001)
$env:PORT = "3001"; node dist/index.js

# Setup inicial (1x apos deploy): configura credenciais N8N e atualiza workflows
node scripts/setup-stack.mjs
```

---

## Variaveis de ambiente (.env)

```env
N8N_URL=https://workflows.vendly.chat
N8N_API_KEY=...
EVOLUTION_URL=https://evolution.vendly.chat
EVOLUTION_API_KEY=...
CHATWOOT_URL=https://chatwoot.vendly.chat
CHATWOOT_API_KEY=...
CHATWOOT_ACCOUNT_ID=1
MONGODB_URI=mongodb://...
REDIS_URL=redis://:pass@host:port/db
QDRANT_URL=http://...
QDRANT_API_KEY=...
COOLIFY_URL=https://coolify.redatudo.online
COOLIFY_TOKEN=...
OPENROUTER_API_KEY=sk-or-v1-...
OPENROUTER_MODEL=meta-llama/llama-3.3-70b-instruct:free
OPENROUTER_MULTIMODAL_MODEL=google/gemini-2.0-flash-lite-001
PORT=3000
```

---

## Estrutura

```
src/
  config.ts        — le .env, exporta config tipado
  index.ts         — servidor MCP, roteamento por prefixo
  tools/
    evolution.ts   — WhatsApp (Evolution API)
    n8n.ts         — workflows e credenciais N8N
    chatwoot.ts    — atendimento Chatwoot
    mongodb.ts     — MongoDB
    redis.ts       — Redis
    qdrant.ts      — vetores Qdrant
    coolify.ts     — deploy Coolify
  utils/
    http.ts        — axios client factory, safeRequest, toText
scripts/
  setup-stack.mjs              — setup inicial de credenciais e workflows N8N
  add-contact-filter-nodes.mjs — adiciona/atualiza nos de filtro de contatos
  add-escalation-notifications.mjs — adiciona nos de notificacao de escalada
snapshots/
  wf-entrada-v1.json    — snapshot do workflow [CORE] Entrada de Mensagem
  wf-debounce-v1.json   — snapshot do workflow [CORE] Processar Buffer
  wf-executor-v1.json   — snapshot do workflow [AGENT] Executor
```

---

## Arquitetura — regra critica

```
Agente IA --? MCP (stack-mcp) --? Servicos (Evolution, N8N, Redis, MongoDB...)
N8N runtime --? Servicos DIRETAMENTE (nos nativos, nunca via MCP)
```

Workflows N8N usam nos nativos (`n8n-nodes-base.redis`, `n8n-nodes-base.httpRequest`).
Nunca chamar a URL MCP dentro de nos N8N — N8N em nuvem nao acessa localhost.

---

## Workflows N8N principais

| Workflow                           | ID                 | Status |
|------------------------------------|--------------------|--------|
| [CORE] Entrada de Mensagem         | `bEb19TdWZfFloisU` | ativo  |
| [CORE] Processar Buffer (Debounce) | `FacKqM3e2LsHE6NY` | ativo  |
| [AGENT] Executor                   | `jleu4RPvSnYDL8Gd` | ativo  |
| [ADMIN] Provisionar Negocio        | `IlSk5TsGYvAUDbro` | ativo  |
| [OBJECTIVES] Manager               | `vbCaEvxL60aBgsmB` | ativo  |

### Fluxo de mensagem

```
Evolution API ? Webhook /chatwoot-bot ? [CORE] Entrada de Mensagem
  ? Normalizar Mensagem
  ? Redis GET Contact Filter ? Aplicar Filtro Contatos   (bloqueia blacklist/whitelist)
  ? Redis GET human_takeover ? Auto-Aceitar Conversa     (pula se humano assumiu)
  ? Redis GET Dedup ? IF Ja Processado?
  ? PUSH Buffer ? Setar Timestamp Debounce ? Chamar Debounce

? [CORE] Processar Buffer (Debounce)
  ? aguarda 5s ? Verificar timestamp ? llen buffer
  ? POP Buffer (xN) ? Consolidar ? Chamar Executor

? [AGENT] Executor
  ? Redis GET sessao ? Construir Prompt ? OpenRouter chat/completions
  ? Loop chunks ? delay ? Evolution sendText ? Redis SET sessao
```

---

## Dashboard

Interface React + Ant Design em `dashboard/src/`.
Backend Express em `src/web/routes/businesses.ts`.

Funcionalidades atuais:
- Gerenciamento de negocios (nome, instancias, prompt)
- Lista de notificacao para escalada humana
- Filtro de contatos por negocio (blacklist/whitelist de contatos e grupos WhatsApp)

---

## Adicionando uma nova ferramenta

1. Em `src/tools/servico.ts`, adicionar na array `servicoTools`:

```typescript
{
  name: 'servico_acao',
  description: 'Descricao em pt-BR.',
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

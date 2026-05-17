# Copilot Instructions — stack-mcp

## O que é este projeto

`stack-mcp` é um servidor MCP (Model Context Protocol) em TypeScript para a plataforma **Vendly** — atendimento ao cliente via WhatsApp com IA.

O MCP expõe **ferramentas** para que agentes de IA (Claude, GPT, etc.) possam operar toda a infraestrutura da Vendly: enviar mensagens WhatsApp, criar workflows N8N, consultar MongoDB/Redis/Qdrant, gerenciar instâncias Evolution, Chatwoot e Coolify.

---

## Arquitetura — REGRA CRÍTICA

```
Agente IA ──► MCP (stack-mcp) ──► Serviços (Evolution, N8N, Redis, MongoDB...)
N8N runtime ──► Serviços DIRETAMENTE (nós nativos, nunca via MCP)
```

**MCP é para agentes/tooling, NUNCA para runtime de N8N.**

- Workflows N8N devem usar nós nativos (`n8n-nodes-base.redis`, `n8n-nodes-base.httpRequest` direto para Evolution, etc.)
- Chamar `http://localhost:3001/mcp` ou qualquer URL MCP dentro de nós N8N é ERRADO
- O N8N em nuvem não consegue acessar `localhost` — isso quebra na primeira mensagem

---

## URLs dos serviços

| Serviço      | URL                                          |
|-------------|----------------------------------------------|
| Evolution   | `https://evolution.vendly.chat`              |
| N8N         | `https://workflows.vendly.chat`              |
| N8N API     | `https://workflows.vendly.chat/api/v1`       |
| Chatwoot    | `https://chatwoot.vendly.chat`               |
| MongoDB     | host interno Coolify (ver .env)              |
| Redis       | host interno Coolify (ver .env)              |
| Qdrant      | URL sslip.io (ver .env)                      |
| Coolify     | `https://coolify.redatudo.online`            |
| MCP (prod)  | `http://fco8og80s4sw4c0wc0ogswws.157.173.111.65.sslip.io/mcp` |

Credenciais completas: arquivo `.env` na raiz (nunca comitar credenciais reais).

---

## Build e deploy

```powershell
# Build TypeScript → dist/
npm run build

# Deploy: push para main, Coolify faz redeploy automático
git push

# Dev local (porta 3001)
$env:PORT = "3001"; node dist/index.js

# Testar ferramenta via MCP local
$headers = @{ "Content-Type" = "application/json"; "Accept" = "application/json, text/event-stream" }
Invoke-WebRequest -Uri http://localhost:3001/mcp -Method POST -Headers $headers -Body '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"1.0"}}}'
```

O build usa `tsc`. Saída em `dist/`. O projeto é **ESM** (`"type": "module"` em package.json).

---

## Estrutura de código

```
src/
  config.ts        — lê .env, exporta config tipado
  index.ts         — servidor MCP, roteamento por prefixo de ferramenta
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
```

Cada `tools/*.ts` exporta:
- `const {service}Tools: Tool[]` — array de definições de ferramentas
- `async function handle{Service}Tool(name, args): Promise<string>` — handler

Roteamento em `index.ts`:
```typescript
if (name.startsWith('evolution_')) return handleEvolutionTool(name, args);
if (name.startsWith('n8n_'))       return handleN8nTool(name, args);
// ...
```

---

## Convenções de ferramentas

- Nome: `{servico}_{acao}` (ex: `evolution_send_text`, `n8n_create_workflow`)
- Sempre incluir `instanceName` ou `instance` quando for específico de instância
- `inputSchema` com `required` explícito, `description` em pt-BR
- Handler: use `safeRequest(() => http.method(...).then(r => r.data))` + `return toText(res)`

---

## N8N — IDs dos workflows principais

| Workflow                          | ID                   | Status   |
|----------------------------------|----------------------|----------|
| [CORE] Entrada de Mensagem        | `bEb19TdWZfFloisU`   | ativo    |
| [CORE] Processar Buffer (Debounce)| `FacKqM3e2LsHE6NY`   | ativo    |
| [AGENT] Executor                  | `jleu4RPvSnYDL8Gd`   | ativo    |
| [ADMIN] Provisionar Negócio       | `IlSk5TsGYvAUDbro`   | ativo    |
| [OBJECTIVES] Manager              | `vbCaEvxL60aBgsmB`   | ativo    |

Webhook base: `https://workflows.vendly.chat/webhook/{path}`

---

## N8N — Nós nativos (para uso em workflows)

```javascript
// Redis RPUSH
{ type: 'n8n-nodes-base.redis', typeVersion: 1,
  parameters: { operation: 'lPush', key: '...', value: '...' },
  credentials: { redis: { id: 'CRED_ID', name: 'Redis Vendly' } } }

// Redis GET
{ parameters: { operation: 'get', key: '...' } }

// Redis SET
{ parameters: { operation: 'set', key: '...', value: '...' } }

// HTTP para Evolution API
{ type: 'n8n-nodes-base.httpRequest', typeVersion: 4.2,
  parameters: { method: 'POST', url: 'https://evolution.vendly.chat/message/sendText/INSTANCE',
    authentication: 'headerAuth', sendBody: true, bodyContentType: 'json', specifyBody: 'json',
    jsonBody: '={{ JSON.stringify({number, text}) }}' },
  credentials: { httpHeaderAuth: { id: 'CRED_ID', name: 'Evolution API' } } }

// OpenRouter
// url: https://openrouter.ai/api/v1/chat/completions
// credential: httpHeaderAuth, name=Authorization, value=Bearer sk-or-v1-...
```

---

## Fluxo de mensagem WhatsApp

```
Evolution API → Webhook /evolution → [CORE] Entrada de Mensagem
  → Redis RPUSH buffer:instance:telefone (nó nativo)
  → HTTP POST /webhook/agent-executor

[AGENT] Executor
  → Redis GET sessao:instance:telefone
  → Code: monta prompt com histórico
  → HTTP POST OpenRouter (chat/completions)
  → Code: divide resposta em chunks curtos
  → Loop: para cada chunk:
      → aguarda delay (simula digitação)
      → HTTP POST Evolution /message/sendText
  → Redis SET sessao atualizada
```

**Resposta humana**: mensagens curtas, múltiplos envios com delay, emojis moderados, sem blocos longos.

---

## Scripts úteis

```powershell
# Configura credenciais N8N e atualiza workflows com nós nativos (roda 1x após deploy)
node scripts/setup-stack.mjs

# (obsoleto) Setup inicial dos workflows
node scripts/setup-n8n.mjs
```

---

## Variáveis de ambiente necessárias (.env)

```
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
OPENROUTER_MODEL=meta-llama/llama-3.3-70b-instruct:free  # opcional
PORT=3000  # Coolify usa 3000, local usa 3001
```

---

## Adicionando uma nova ferramenta (exemplo)

1. Em `src/tools/servico.ts`, adiciona na array `servicoTools`:
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

2. Adiciona o case no switch de `handleServicoTool`:
```typescript
case 'servico_acao': {
  const res = await safeRequest(() => http.post('/endpoint', args).then(r => r.data));
  return toText(res);
}
```

3. `npm run build` + `git push`

---

## Erros comuns

| Erro                              | Causa                                           | Fix                                          |
|----------------------------------|-------------------------------------------------|----------------------------------------------|
| 405 no n8n_update_workflow       | Usou PATCH em vez de PUT                       | Usar PUT `/workflows/{id}`                   |
| 406 nas chamadas N8N             | Header Accept faltando                         | Adicionar `Accept: application/json, text/event-stream` |
| 400 no update_workflow           | Body sem `settings: {}`                        | Incluir `settings: {}` no payload            |
| Primeira mensagem falha          | N8N chama MCP via HTTP Request                 | Substituir por nó nativo `n8n-nodes-base.redis` |
| Secret bloqueado no git push     | Chave real em arquivo comitado                 | Usar `.env` (no .gitignore) ou placeholder em `.env.example` |

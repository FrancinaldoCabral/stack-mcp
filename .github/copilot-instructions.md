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
| MCP (prod)  | `https://app.vendly.chat/mcp` |

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

## N8N — Regra crítica: sempre buscar o workflow atual antes de modificar

Antes de propor qualquer mudança em workflow N8N, **sempre** buscar o JSON atual via API:
```
GET https://workflows.vendly.chat/api/v1/workflows/{id}
headers: X-N8N-API-KEY: $N8N_API_KEY
```
Nunca assumir que o workflow tem exatamente o que o setup-stack.mjs teria gerado — o usuário pode ter editado manualmente. Verificar nós, conexões, IDs e pinned data antes de qualquer proposta.

Para atualizar um workflow, usar **fixes cirúrgicos via API** — NUNCA reexecutar setup-stack.mjs (ele sobrescreve credenciais manuais do usuário).

PUT `https://workflows.vendly.chat/api/v1/workflows/{id}` — body aceita **somente** estes campos (outros causam erro 400):
```json
{ "name": "...", "nodes": [...], "connections": {...}, "settings": { "executionOrder": "v1", "saveManualExecutions": true } }
```
Campos proibidos no body: `active` (read-only), `meta`, `id`, `createdAt`, `updatedAt`, `binaryMode` em settings.

---

## N8N — Webhook v2: payload wrapper

O nó Webhook v2 do N8N envelopa o body: `$input.first().json = { body: {...}, headers: {...}, query: {...} }`.  
Sempre desembalar com: `const data = $input.first().json?.body ?? $input.first().json;`  
Referências a nós anteriores (`$('NomeDoNo')`) só funcionam em nós que executam **antes** de SplitInBatches ou IF — dentro do loop, os dados devem vir via `$input`, não via `$('...')`.

---

## N8N — Nós nativos (para uso em workflows)

```javascript
// Operações disponíveis no nó Redis N8N: delete, get, increment, info, keys, listLength, pop, publish, push, set
// NÃO EXISTE: lrange, hget, hset — use GET/SET com JSON array para acumular listas

// Redis PUSH (RPUSH — adiciona ao final da lista)
{ type: 'n8n-nodes-base.redis', typeVersion: 1,
  parameters: { operation: 'push', list: '...', messageData: '...' },
  credentials: { redis: { id: 'CRED_ID', name: 'Redis Vendly' } } }

// Redis POP (LPOP — retira um item da lista)
{ parameters: { operation: 'pop', list: '...', tail: false } }  // tail:true = RPOP

// Redis GET (string)
{ parameters: { operation: 'get', key: '...', propertyName: 'value', options: {} } }

// Redis SET (string)
{ parameters: { operation: 'set', key: '...', value: '...' } }
// Com TTL: { parameters: { operation: 'set', key: '...', value: '...', expire: true, ttl: 10 } }

// BUFFER DE MENSAGENS (padrão PUSH/POP — atômico, sem race condition):
// Entrada: PUSH buffer:{inst}:{tel} (RPUSH — atômico, cada mensagem é uma entrada isolada)
//   { operation: 'push', list: "={{ 'buffer:'+$json.instance+':'+$json.telefone }}", messageData: '={{ JSON.stringify($json) }}' }
//
// BUFFER DE MENSAGENS (padrão PUSH/POP — atômico, sem race condition):
// Entrada: PUSH buffer:{inst}:{tel} (RPUSH — atômico, cada mensagem é uma entrada isolada)
//   { operation: 'push', list: "={{ 'buffer:'+$json.instance+':'+$json.telefone }}", messageData: '={{ JSON.stringify($json) }}' }
//
// Debounce (após Verificar): llen buffer → Gerar Iteracoes → POP Buffer (×N) → Parse Item (×N) → Consolidar (runOnceForAllItems)
//   llen: { operation: 'llen', list: "={{ 'buffer:'+$json.instance+':'+$json.telefone }}" } → retorna { "buffer:inst:tel": N }
//   Gerar Iteracoes: lê N com Object.values(raw).find(v => typeof v === 'number') → Array.from({length:n})
//   POP Buffer: { operation: 'pop', list: "={{ 'buffer:'+$json.instance+':'+$json.telefone }}", tail: false }
//   Parse Item: JSON.parse($input.first().json.value)
//   Consolidar: mode='runOnceForAllItems', lê $input.all()
//   NÃO precisa de DEL — POP já remove atomicamente cada item
//   NÃO usar SplitInBatches: o Done Branch devolve itens de contexto, não os itens do loop body
//
// ATENÇÃO: N8N Redis armazena "List Length" internamente como operation='llen' (não 'listLength')
// O parâmetro da chave em llen/push/pop é 'list' (não 'key'); apenas get/set/delete usam 'key'
// llen retorna o comprimento com o nome da chave como field: { "buffer:inst:tel": 12 } — usar Object.values()
//
// NUNCA usar GET/SET com append para buffer: tem race condition quando execuções N8N se sobrepõem

// HTTP para Evolution API (e qualquer outro serviço com headerAuth)
// SEMPRE usar genericCredentialType + genericAuthType — NUNCA authentication: 'headerAuth' diretamente
{ type: 'n8n-nodes-base.httpRequest', typeVersion: 4.2,
  parameters: { method: 'POST', url: 'https://evolution.vendly.chat/message/sendText/INSTANCE',
    authentication: 'genericCredentialType', genericAuthType: 'httpHeaderAuth',
    sendBody: true, specifyBody: 'json',
    jsonBody: '={{ JSON.stringify({number, text}) }}',
    options: { response: { response: { neverError: true } } } },
  credentials: { httpHeaderAuth: { id: 'K3YGChLlsj7fRfYX', name: 'Evolution API' } } }

// OpenRouter
// url: https://openrouter.ai/api/v1/chat/completions
// modelo: google/gemini-2.0-flash-lite-001 (multimodal real — NÃO substitua)
// credential: httpHeaderAuth, name=Authorization, value=Bearer sk-or-v1-...
// IMPORTANTE: usar genericCredentialType: 'httpHeaderAuth' (NÃO httpBearerAuth)
// O header Authorization é do tipo Key/Value dentro de httpHeaderAuth — NÃO usar autenticação Bearer nativa do N8N
```

---

## Fluxo de mensagem WhatsApp

```
Evolution API → Webhook /evolution → [CORE] Entrada de Mensagem
  → RPUSH buffer:instance:telefone (atômico — sem race condition)
  → SET debounce_ts:instance:telefone
  → HTTP POST /webhook/debounce-trigger

[CORE] Processar Buffer (Debounce)
  → Webhook /debounce-trigger → aguarda 5s → GET debounce_ts → Verificar (ts match)
  → listLength buffer → Gerar N itens → SplitInBatches(1)
      Loop: POP buffer (LPOP) → Parse Item
      Done: Consolidar (join \n) → HTTP POST /webhook/agent-executor

[AGENT] Executor
  → Redis GET sessao:instance:telefone
  → Code: monta prompt com histórico (slice(-100) ≈ 100 turnos)
  → HTTP POST OpenRouter (chat/completions, sem max_tokens — usa capacidade total do modelo)
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
OPENROUTER_MULTIMODAL_MODEL=google/gemini-2.0-flash-lite-001  # modelo multimodal real usado no N8N — NÃO substituir
OPENROUTER_TTS_MODEL=                                     # opcional; se definido, responde com áudio quando usuário envia áudio
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
| EAI_AGAIN hostname redis         | N8N e Redis em redes Docker diferentes         | Conectar N8N à rede Docker do Redis no Coolify |
| Redis node: operação inválida    | Usar `lPush`/`key`/`value` → `push`/`list`/`messageData` | `operation: 'push', list: keyExpr, messageData: valueExpr` |
| `lrange` não existe no nó Redis  | N8N Redis não tem lrange — tenta rodar, retorna 0 itens | Usar PUSH/POP com SplitInBatches (ver padrão BUFFER DE MENSAGENS acima) |
| Race condition no buffer         | GET/SET tem janela onde 2 execuções leem buffer vazio simultâneo | Usar PUSH (atômico) na Entrada e POP no loop do Debounce — NUNCA GET/SET para acumular |
| Secret bloqueado no git push     | Chave real em arquivo comitado                 | Usar `.env` (no .gitignore) ou placeholder em `.env.example` |
| OpenRouter quebra após deploy    | Copilot trocou modelo ou tipo de auth          | Modelo fixo: `google/gemini-2.0-flash-lite-001`; auth: `genericCredentialType: httpHeaderAuth` com header `Authorization: Bearer sk-or-v1-...` — NUNCA usar `httpBearerAuth` nativo |
| Headers Authorization incorretos | Copilot usa Bearer auth nativa do N8N          | Sempre usar `genericCredentialType: 'httpHeaderAuth'` com par nome/valor explícito — o usuário padronizou assim e não deve ser alterado |

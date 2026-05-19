/**
 * fix-implementation.mjs
 *
 * Aplica as seguintes melhorias no [AGENT] Executor (jleu4RPvSnYDL8Gd):
 *
 * 1. Remove IDENTIDADE do defaultPrompt em Construir Prompt
 * 2. Business model fix:
 *    - MongoDB GET Business: query { instances: instanceName } (array field)
 *    - MongoDB GET Cliente:  query { phone: telefone } (sem acoplamento de instância)
 *    - Redis keys: sessao:{businessId}:{telefone}  (businessId > instance)
 *    - Parsear Chunks: passa businessId no contexto
 *    - Preparar Upsert Cliente: chave businessId:phone, inclui campo businessId
 *    - MongoDB Upsert Cliente: campos + businessId
 *    - Preparar Log Conversa: inclui businessId
 *    - MongoDB Log Conversa: campos + businessId
 *    - Qdrant Search Contexto: filtro por businessId (mantém fallback por instance)
 * 3. Tool calling — buscar_memoria via Qdrant:
 *    - OpenRouter: inclui tools + usa model de businessDoc.settings
 *    - Construir Prompt: retorna model e businessId no contexto
 *    - Novos nós: Verificar Tool Calls → Extrair Query → Embed → Qdrant → Montar Result → OpenRouter Tool
 */

import 'dotenv/config';
import https from 'https';

// ── HTTP helper ────────────────────────────────────────────────────────────────
function apiReq(method, path, body) {
  return new Promise((res, rej) => {
    const u = new URL(process.env.N8N_URL + path);
    const d = body ? JSON.stringify(body) : undefined;
    const opts = {
      hostname: u.hostname,
      path: u.pathname + u.search,
      method,
      headers: {
        'X-N8N-API-KEY': process.env.N8N_API_KEY,
        Accept: 'application/json',
        'Content-Type': 'application/json',
        ...(d ? { 'Content-Length': Buffer.byteLength(d) } : {}),
      },
    };
    const r = https.request(opts, (resp) => {
      let s = '';
      resp.on('data', (x) => (s += x));
      resp.on('end', () => {
        try { res({ status: resp.statusCode, body: JSON.parse(s) }); }
        catch { res({ status: resp.statusCode, body: s }); }
      });
    });
    r.on('error', rej);
    if (d) r.write(d);
    r.end();
  });
}

const WF_ID = 'jleu4RPvSnYDL8Gd';
const CRED = {
  openrouter: { id: 'H0XlPAbxjEUzplW4', name: 'OpenRouter' },
  qdrant:     { id: 't7DkEhFjCitShZgF', name: 'Qdrant Vendly' },
  mongo:      { id: 'sv8EpRFYk3nNbQ4G', name: 'MongoDB Vendly' },
  redis:      { id: 'zkKpThv7TlkK3IoB', name: 'Redis Vendly' },
};
const QDRANT_URL = 'http://qdrant-y40s0gw4wow0scw0cw8og88o.157.173.111.65.sslip.io';

// ── Fetch current workflow ─────────────────────────────────────────────────────
const { status: getStatus, body: wf } = await apiReq('GET', `/api/v1/workflows/${WF_ID}`);
if (getStatus !== 200) { console.error('GET failed', getStatus, wf); process.exit(1); }
console.log(`Workflow carregado: ${wf.name} (${wf.nodes.length} nós)`);

const find = (name) => wf.nodes.find((n) => n.name === name);

// ══════════════════════════════════════════════════════════════════════════════
// 1. CONSTRUIR PROMPT — remover IDENTIDADE + passar model e businessId
// ══════════════════════════════════════════════════════════════════════════════
const construirPrompt = find('Construir Prompt');

const novoDefaultPrompt = `\`Você é \${nomeAssistente}, atendente de WhatsApp.
Data e hora atual: \${dataHora}\``;

// Substituir todo o bloco defaultPrompt (da declaração até o fechamento do template)
construirPrompt.parameters.jsCode = construirPrompt.parameters.jsCode.replace(
  /\/\/ System prompt padrão[\s\S]*?const sistemaPrompt/,
  `// System prompt padrão — regras vêm inteiramente do systemPrompt do negócio
const defaultPrompt = ${novoDefaultPrompt};

const sistemaPrompt`
);

// Atualizar linha de retorno para incluir model e businessId
construirPrompt.parameters.jsCode = construirPrompt.parameters.jsCode.replace(
  /return \[\{ json: \{ \.\.\.msg, messages, historico, respondWithAudio: false \} \}\];/,
  `const modelToUse = businessDoc?.settings?.model ?? 'google/gemini-2.5-flash-preview';
return [{ json: { ...msg, messages, historico, respondWithAudio: false, model: modelToUse, businessId: String(businessDoc?._id ?? '') } }];`
);

console.log('✅ Construir Prompt: IDENTIDADE removida, model e businessId adicionados');

// ══════════════════════════════════════════════════════════════════════════════
// 2. MONGODB GET BUSINESS — query por instances[] em vez de instance
// ══════════════════════════════════════════════════════════════════════════════
const mongoBiz = find('MongoDB GET Business');
mongoBiz.parameters.query = '={{ JSON.stringify({ instances: $(\'Desembalar Payload\').first().json.instance }) }}';
console.log('✅ MongoDB GET Business: query por instances[]');

// ══════════════════════════════════════════════════════════════════════════════
// 3. MONGODB GET CLIENTE — query simplificada por phone (sem acoplamento instance)
// ══════════════════════════════════════════════════════════════════════════════
const mongoCliente = find('MongoDB GET Cliente');
mongoCliente.parameters.query = '={{ JSON.stringify({ phone: $(\'Desembalar Payload\').first().json.telefone }) }}';
console.log('✅ MongoDB GET Cliente: query por phone');

// ══════════════════════════════════════════════════════════════════════════════
// 4. REDIS GET SESSAO — chave sessao:{businessId}:{telefone}
// ══════════════════════════════════════════════════════════════════════════════
const redisGet = find('Redis GET Sessao');
redisGet.parameters.key =
  "={{ 'sessao:' + (String($('MongoDB GET Business').first()?.json?._id ?? '') || $('Desembalar Payload').first().json.instance) + ':' + $('Desembalar Payload').first().json.telefone }}";
console.log('✅ Redis GET Sessao: chave por businessId');

// ══════════════════════════════════════════════════════════════════════════════
// 5. REDIS SET SESSAO — chave businessId
// ══════════════════════════════════════════════════════════════════════════════
const redisSet = find('Redis SET Sessao');
redisSet.parameters.key = "={{ 'sessao:' + ($json.contexto.businessId || $json.contexto.instance) + ':' + $json.contexto.telefone }}";
redisSet.parameters.value = "={{ JSON.stringify($json.contexto.historico) }}";
console.log('✅ Redis SET Sessao: chave por businessId');

const redisSetAudio = find('Redis SET Sessao audio');
if (redisSetAudio) {
  redisSetAudio.parameters.key = "={{ 'sessao:' + ($json.contexto.businessId || $json.contexto.instance) + ':' + $json.contexto.telefone }}";
  console.log('✅ Redis SET Sessao audio: chave por businessId');
}

// ══════════════════════════════════════════════════════════════════════════════
// 6. PARSEAR CHUNKS — adicionar businessId ao contexto
// ══════════════════════════════════════════════════════════════════════════════
const parsearChunks = find('Parsear Chunks');
parsearChunks.parameters.jsCode = parsearChunks.parameters.jsCode.replace(
  `const contexto = {
  instance: promptData.instance,
  telefone: promptData.telefone,
  remoteJid: promptData.remoteJid,
  historico: novoHistorico,
};`,
  `const contexto = {
  instance: promptData.instance,
  telefone: promptData.telefone,
  remoteJid: promptData.remoteJid,
  historico: novoHistorico,
  businessId: promptData.businessId ?? '',
};`
);
console.log('✅ Parsear Chunks: businessId adicionado ao contexto');

// ══════════════════════════════════════════════════════════════════════════════
// 7. PREPARAR UPSERT CLIENTE — chave e campo businessId
// ══════════════════════════════════════════════════════════════════════════════
const prepUpsert = find('Preparar Upsert Cliente');
prepUpsert.parameters.jsCode = `const items = $input.all();
const last = items[items.length - 1]?.json ?? {};
const ctx = last.contexto ?? {};
const msg = $('Desembalar Payload').first().json;
const instance = ctx.instance ?? msg.instance;
const phone = ctx.telefone ?? msg.telefone;
const businessId = ctx.businessId || String($('MongoDB GET Business').first()?.json?._id ?? instance);
return [{
  json: {
    key: businessId + ':' + phone,
    businessId,
    instance,
    phone,
    name: msg.pushName || phone,
    last_seen: new Date().toISOString(),
  }
}];`;
console.log('✅ Preparar Upsert Cliente: chave e campo businessId');

// ══════════════════════════════════════════════════════════════════════════════
// 8. MONGODB UPSERT CLIENTE — incluir businessId nos campos
// ══════════════════════════════════════════════════════════════════════════════
const mongoUpsert = find('MongoDB Upsert Cliente');
mongoUpsert.parameters.fields = 'key, businessId, instance, phone, name, last_seen';
console.log('✅ MongoDB Upsert Cliente: campos + businessId');

// ══════════════════════════════════════════════════════════════════════════════
// 9. PREPARAR LOG CONVERSA — incluir businessId
// ══════════════════════════════════════════════════════════════════════════════
const prepLog = find('Preparar Log Conversa');
prepLog.parameters.jsCode = `const items = $input.all();
const last = items[items.length - 1]?.json ?? {};
const ctx = last.contexto ?? {};
return [{
  json: {
    businessId: ctx.businessId || ctx.instance,
    instance: ctx.instance,
    phone: ctx.telefone,
    started_at: new Date().toISOString(),
    messages: (ctx.historico ?? []).slice(-20),
    model_used: ctx.model ?? 'google/gemini-2.5-flash-preview',
  }
}];`;
console.log('✅ Preparar Log Conversa: businessId + model_used dinâmico');

// ══════════════════════════════════════════════════════════════════════════════
// 10. MONGODB LOG CONVERSA — incluir businessId nos campos
// ══════════════════════════════════════════════════════════════════════════════
const mongoLog = find('MongoDB Log Conversa');
mongoLog.parameters.fields = 'businessId, instance, phone, started_at, messages, model_used';
console.log('✅ MongoDB Log Conversa: campos + businessId');

// ══════════════════════════════════════════════════════════════════════════════
// 11. QDRANT SEARCH CONTEXTO — filtro por businessId (fallback instance)
// ══════════════════════════════════════════════════════════════════════════════
const qdrantSearch = find('Qdrant Search Contexto');
qdrantSearch.parameters.jsonBody = `={{ JSON.stringify({
  vector: $input.first().json.data?.[0]?.embedding ?? [],
  limit: 5,
  with_payload: true,
  score_threshold: 0.4,
  filter: {
    should: [
      { key: 'businessId', match: { value: String($('MongoDB GET Business').first()?.json?._id ?? $('Desembalar Payload').first().json.instance) } },
      { key: 'businessId', match: { value: 'global' } },
      { key: 'instance', match: { value: $('Desembalar Payload').first().json.instance } },
      { key: 'instance', match: { value: 'global' } }
    ]
  }
}) }}`;
console.log('✅ Qdrant Search Contexto: filtro businessId + fallback instance');

// ══════════════════════════════════════════════════════════════════════════════
// 12. OPENROUTER — usa model de Construir Prompt + inclui tool buscar_memoria
// ══════════════════════════════════════════════════════════════════════════════
const openRouter = find('OpenRouter');
openRouter.parameters.jsonBody = `={{ JSON.stringify({
  model: $json.model ?? 'google/gemini-2.5-flash-preview',
  messages: $json.messages,
  temperature: 0.8,
  tools: [{
    type: 'function',
    function: {
      name: 'buscar_memoria',
      description: 'Busca na base de conhecimento do negócio informações sobre produtos, serviços, preços, políticas e procedimentos. Use quando o cliente perguntar algo específico que pode estar documentado.',
      parameters: {
        type: 'object',
        required: ['query'],
        properties: {
          query: { type: 'string', description: 'Descrição clara do que buscar (seja específico)' }
        }
      }
    }
  }],
  tool_choice: 'auto'
}) }}`;
console.log('✅ OpenRouter: model dinâmico + tool buscar_memoria');

// ══════════════════════════════════════════════════════════════════════════════
// 13. NOVOS NÓS — Tool Calling Flow
// ══════════════════════════════════════════════════════════════════════════════

// 13a. Verificar Tool Calls (IF node)
const verificarToolCalls = {
  id: 'verificar-tool-calls',
  name: 'Verificar Tool Calls',
  type: 'n8n-nodes-base.if',
  typeVersion: 1,
  position: [980, 304],
  parameters: {
    conditions: {
      number: [{
        value1: "={{ ($json.choices?.[0]?.message?.tool_calls ?? []).length }}",
        operation: 'larger',
        value2: 0,
      }],
    },
  },
};

// 13b. Extrair Query Ferramenta (Code)
const extrairQuery = {
  id: 'extrair-query-ferramenta',
  name: 'Extrair Query Ferramenta',
  type: 'n8n-nodes-base.code',
  typeVersion: 2,
  position: [980, 500],
  parameters: {
    mode: 'runOnceForAllItems',
    jsCode: `const resp = $input.first().json;
const tc = resp.choices?.[0]?.message?.tool_calls?.[0];
if (!tc) return [];
let args = {};
try { args = JSON.parse(tc.function?.arguments ?? '{}'); } catch {}
return [{
  json: {
    toolCallId: tc.id,
    toolName: tc.function?.name,
    query: args.query ?? '',
    assistantMessage: resp.choices[0].message,
  }
}];`,
  },
};

// 13c. Gerar Embedding Ferramenta (HTTP — mesmo endpoint que Gerar Embedding)
const gerarEmbeddingFerramenta = {
  id: 'gerar-embedding-ferramenta',
  name: 'Gerar Embedding Ferramenta',
  type: 'n8n-nodes-base.httpRequest',
  typeVersion: 4.2,
  position: [1200, 500],
  credentials: { httpHeaderAuth: CRED.openrouter },
  parameters: {
    method: 'POST',
    url: 'https://openrouter.ai/api/v1/embeddings',
    authentication: 'genericCredentialType',
    genericAuthType: 'httpHeaderAuth',
    sendBody: true,
    specifyBody: 'json',
    jsonBody: "={{ JSON.stringify({ model: 'openai/text-embedding-3-small', input: $json.query }) }}",
    options: { response: { response: { neverError: true } } },
  },
};

// 13d. Qdrant Buscar Ferramenta (HTTP — mesmo endpoint que Qdrant Search Contexto)
const qdrantBuscarFerramenta = {
  id: 'qdrant-buscar-ferramenta',
  name: 'Qdrant Buscar Ferramenta',
  type: 'n8n-nodes-base.httpRequest',
  typeVersion: 4.2,
  position: [1420, 500],
  credentials: { httpHeaderAuth: CRED.qdrant },
  parameters: {
    method: 'POST',
    url: `${QDRANT_URL}/collections/vendly_intelligence/points/search`,
    authentication: 'genericCredentialType',
    genericAuthType: 'httpHeaderAuth',
    sendBody: true,
    specifyBody: 'json',
    jsonBody: `={{ JSON.stringify({
  vector: $input.first().json.data?.[0]?.embedding ?? [],
  limit: 5,
  with_payload: true,
  score_threshold: 0.35,
  filter: {
    should: [
      { key: 'businessId', match: { value: String($('MongoDB GET Business').first()?.json?._id ?? $('Desembalar Payload').first().json.instance) } },
      { key: 'businessId', match: { value: 'global' } },
      { key: 'instance', match: { value: $('Desembalar Payload').first().json.instance } },
      { key: 'instance', match: { value: 'global' } }
    ]
  }
}) }}`,
    options: { response: { response: { neverError: true } } },
  },
};

// 13e. Montar Tool Result (Code)
const montarToolResult = {
  id: 'montar-tool-result',
  name: 'Montar Tool Result',
  type: 'n8n-nodes-base.code',
  typeVersion: 2,
  position: [1640, 500],
  parameters: {
    mode: 'runOnceForAllItems',
    jsCode: `const qdrantResp = $input.first().json;
const extr = $('Extrair Query Ferramenta').first().json;
const promptData = $('Construir Prompt').first().json;

const results = (qdrantResp.result ?? [])
  .filter(r => (r.score ?? 0) >= 0.35)
  .map(r => r.payload?.content || r.payload?.text || '')
  .filter(Boolean);

const toolContent = results.length > 0
  ? results.join('\\n\\n')
  : 'Nenhuma informação relevante encontrada na base de conhecimento.';

const messages = [
  ...promptData.messages,
  extr.assistantMessage,
  { role: 'tool', tool_call_id: extr.toolCallId, content: toolContent },
];

return [{
  json: {
    model: promptData.model ?? 'google/gemini-2.5-flash-preview',
    messages,
    temperature: 0.8,
  }
}];`,
  },
};

// 13f. OpenRouter Com Ferramenta (HTTP — mesmo endpoint que OpenRouter)
const openRouterComFerramenta = {
  id: 'openrouter-com-ferramenta',
  name: 'OpenRouter Com Ferramenta',
  type: 'n8n-nodes-base.httpRequest',
  typeVersion: 4.2,
  position: [1860, 500],
  credentials: { httpHeaderAuth: CRED.openrouter },
  parameters: {
    method: 'POST',
    url: 'https://openrouter.ai/api/v1/chat/completions',
    authentication: 'genericCredentialType',
    genericAuthType: 'httpHeaderAuth',
    sendBody: true,
    specifyBody: 'json',
    jsonBody: '={{ JSON.stringify({ model: $json.model, messages: $json.messages, temperature: $json.temperature ?? 0.8 }) }}',
    options: { response: { response: { neverError: true } } },
  },
};

// Adicionar novos nós ao workflow
wf.nodes.push(
  verificarToolCalls,
  extrairQuery,
  gerarEmbeddingFerramenta,
  qdrantBuscarFerramenta,
  montarToolResult,
  openRouterComFerramenta,
);
console.log('✅ 6 novos nós de tool calling adicionados');

// ══════════════════════════════════════════════════════════════════════════════
// 14. ATUALIZAR CONEXÕES
// ══════════════════════════════════════════════════════════════════════════════
const conn = wf.connections;

// OpenRouter → Verificar Tool Calls (em vez de → Parsear Chunks)
conn['OpenRouter'] = { main: [[{ node: 'Verificar Tool Calls', type: 'main', index: 0 }]] };

// Verificar Tool Calls:
//   TRUE (index 0) → Extrair Query Ferramenta
//   FALSE (index 1) → Parsear Chunks
conn['Verificar Tool Calls'] = {
  main: [
    [{ node: 'Extrair Query Ferramenta', type: 'main', index: 0 }],   // TRUE
    [{ node: 'Parsear Chunks', type: 'main', index: 0 }],              // FALSE
  ],
};

// Tool calling chain
conn['Extrair Query Ferramenta'] = { main: [[{ node: 'Gerar Embedding Ferramenta', type: 'main', index: 0 }]] };
conn['Gerar Embedding Ferramenta'] = { main: [[{ node: 'Qdrant Buscar Ferramenta', type: 'main', index: 0 }]] };
conn['Qdrant Buscar Ferramenta'] = { main: [[{ node: 'Montar Tool Result', type: 'main', index: 0 }]] };
conn['Montar Tool Result'] = { main: [[{ node: 'OpenRouter Com Ferramenta', type: 'main', index: 0 }]] };
conn['OpenRouter Com Ferramenta'] = { main: [[{ node: 'Parsear Chunks', type: 'main', index: 0 }]] };

console.log('✅ Conexões atualizadas: OpenRouter → Verificar Tool Calls → ...');

// ══════════════════════════════════════════════════════════════════════════════
// 15. SALVAR WORKFLOW
// ══════════════════════════════════════════════════════════════════════════════
console.log('\nSalvando workflow...');
const { status: putStatus, body: result } = await apiReq('PUT', `/api/v1/workflows/${WF_ID}`, {
  name: wf.name,
  nodes: wf.nodes,
  connections: wf.connections,
  settings: { executionOrder: 'v1', saveManualExecutions: true },
});

if (putStatus !== 200) {
  console.error('❌ ERRO ao salvar:', putStatus, JSON.stringify(result).slice(0, 500));
  process.exit(1);
}

// ══════════════════════════════════════════════════════════════════════════════
// 16. VERIFICAÇÕES
// ══════════════════════════════════════════════════════════════════════════════
console.log('\n=== VERIFICAÇÕES ===');

const checkNode = (name) => result.nodes.find((n) => n.name === name);

// 1. defaultPrompt sem IDENTIDADE
const cpCode = checkNode('Construir Prompt')?.parameters?.jsCode ?? '';
console.log('Construir Prompt — sem IDENTIDADE:', !cpCode.includes('IDENTIDADE') ? 'OK ✅' : 'FALTANDO ❌');
console.log('Construir Prompt — retorna model:', cpCode.includes('modelToUse') ? 'OK ✅' : 'FALTANDO ❌');
console.log('Construir Prompt — retorna businessId:', cpCode.includes('businessId') ? 'OK ✅' : 'FALTANDO ❌');

// 2. MongoDB queries
const bizQ = checkNode('MongoDB GET Business')?.parameters?.query ?? '';
console.log('MongoDB GET Business — instances[]:', bizQ.includes('instances') ? 'OK ✅' : 'FALTANDO ❌');
const cliQ = checkNode('MongoDB GET Cliente')?.parameters?.query ?? '';
console.log('MongoDB GET Cliente — por phone:', cliQ.includes('"phone"') ? 'OK ✅' : 'FALTANDO ❌');

// 3. Redis keys
const rgKey = checkNode('Redis GET Sessao')?.parameters?.key ?? '';
console.log('Redis GET Sessao — businessId key:', rgKey.includes('_id') ? 'OK ✅' : 'FALTANDO ❌');
const rsKey = checkNode('Redis SET Sessao')?.parameters?.key ?? '';
console.log('Redis SET Sessao — businessId key:', rsKey.includes('businessId') ? 'OK ✅' : 'FALTANDO ❌');

// 4. Parsear Chunks
const pcCode = checkNode('Parsear Chunks')?.parameters?.jsCode ?? '';
console.log('Parsear Chunks — businessId no contexto:', pcCode.includes('businessId: promptData.businessId') ? 'OK ✅' : 'FALTANDO ❌');

// 5. OpenRouter tools
const orBody = checkNode('OpenRouter')?.parameters?.jsonBody ?? '';
console.log('OpenRouter — tool buscar_memoria:', orBody.includes('buscar_memoria') ? 'OK ✅' : 'FALTANDO ❌');
console.log('OpenRouter — model dinâmico:', orBody.includes('$json.model') ? 'OK ✅' : 'FALTANDO ❌');

// 6. Novos nós
const newNodes = ['Verificar Tool Calls', 'Extrair Query Ferramenta', 'Gerar Embedding Ferramenta', 'Qdrant Buscar Ferramenta', 'Montar Tool Result', 'OpenRouter Com Ferramenta'];
newNodes.forEach((name) => {
  console.log(`Nó "${name}":`, checkNode(name) ? 'OK ✅' : 'FALTANDO ❌');
});

// 7. Conexões
const openRouterConn = result.connections['OpenRouter']?.main?.[0]?.[0]?.node;
console.log('OpenRouter → Verificar Tool Calls:', openRouterConn === 'Verificar Tool Calls' ? 'OK ✅' : `ERRADO (${openRouterConn}) ❌`);

console.log('\n✅ Script concluído.');

/**
 * setup-stack.mjs
 * Configura credenciais e workflows N8N com nós nativos (sem chamadas MCP em runtime).
 *
 * Uso: node scripts/setup-stack.mjs
 *      (requer .env no root do projeto com as credenciais)
 */

import { readFileSync } from 'fs';
import axios from 'axios';

// ──────────────────────────────────────────────────
// Carrega .env
// ──────────────────────────────────────────────────
function loadEnv() {
  try {
    const env = {};
    for (const line of readFileSync(new URL('../.env', import.meta.url), 'utf8').split(/\r?\n/)) {
      const m = line.match(/^([A-Z0-9_]+)\s*=\s*(.*?)(\s*#.*)?$/);
      if (m) env[m[1]] = m[2].trim();
    }
    return env;
  } catch {
    return {};
  }
}
const e = loadEnv();
const ENV = (k) => process.env[k] ?? e[k] ?? '';

const N8N_URL = ENV('N8N_URL');
const N8N_KEY = ENV('N8N_API_KEY');
const EVOLUTION_URL = ENV('EVOLUTION_URL');
const EVOLUTION_KEY = ENV('EVOLUTION_API_KEY');
const REDIS_URL = ENV('REDIS_URL'); // redis://:pass@host:port/db
const OPENROUTER_KEY = ENV('OPENROUTER_API_KEY');
const OPENROUTER_MODEL = ENV('OPENROUTER_MODEL') || 'meta-llama/llama-3.3-70b-instruct:free';

// Parse redis URL
const redisMatch = REDIS_URL.match(/^redis:\/\/:([^@]+)@([^:]+):(\d+)\/(\d+)/);
if (!redisMatch) { console.error('❌ REDIS_URL inválida:', REDIS_URL); process.exit(1); }
const [, REDIS_PASS, REDIS_HOST, REDIS_PORT, REDIS_DB] = redisMatch;

// Workflow IDs (já existentes no N8N)
const WF = {
  entrada:   'bEb19TdWZfFloisU',
  processar: 'FacKqM3e2LsHE6NY',
  agent:     'jleu4RPvSnYDL8Gd',
};

// ──────────────────────────────────────────────────
// N8N API client
// ──────────────────────────────────────────────────
const n8n = axios.create({
  baseURL: `${N8N_URL}/api/v1`,
  headers: { 'X-N8N-API-KEY': N8N_KEY, 'Content-Type': 'application/json' },
});

// ──────────────────────────────────────────────────
// Utils
// ──────────────────────────────────────────────────
async function findOrCreateCredential(name, type, data) {
  // Lista credenciais existentes
  const list = await n8n.get('/credentials').then(r => r.data?.data ?? []);
  const found = list.find(c => c.name === name && c.type === type);
  if (found) {
    console.log(`  ✅ Credencial existente: ${name} (${found.id})`);
    return found.id;
  }
  const res = await n8n.post('/credentials', { name, type, data });
  console.log(`  ✨ Credencial criada: ${name} (${res.data.id})`);
  return res.data.id;
}

async function getWorkflow(id) {
  return n8n.get(`/workflows/${id}`).then(r => r.data);
}

async function updateWorkflow(id, wf) {
  return n8n.put(`/workflows/${id}`, {
    name: wf.name,
    nodes: wf.nodes,
    connections: wf.connections,
    settings: wf.settings ?? {},
    staticData: wf.staticData ?? null,
  });
}

async function activateWorkflow(id) {
  return n8n.patch(`/workflows/${id}/activate`);
}

// ──────────────────────────────────────────────────
// Constructors de nós N8N
// ──────────────────────────────────────────────────
function pos(x, y) { return [x, y]; }

function makeWebhook(id, name, path, responseMode = 'onReceived') {
  return {
    id, name, type: 'n8n-nodes-base.webhook', typeVersion: 2, position: pos(240, 300),
    webhookId: path,
    parameters: {
      path,
      httpMethod: 'POST',
      responseMode,
      options: {},
    },
  };
}

function makeRedisGet(id, name, keyExpr, credId, credName, posArr) {
  return {
    id, name, type: 'n8n-nodes-base.redis', typeVersion: 1, position: posArr,
    credentials: { redis: { id: credId, name: credName } },
    parameters: { operation: 'get', key: keyExpr },
  };
}

function makeRedisSet(id, name, keyExpr, valueExpr, credId, credName, posArr) {
  return {
    id, name, type: 'n8n-nodes-base.redis', typeVersion: 1, position: posArr,
    credentials: { redis: { id: credId, name: credName } },
    parameters: {
      operation: 'set',
      key: keyExpr,
      value: valueExpr,
      keepTTL: false,
    },
  };
}

function makeRedisRpush(id, name, keyExpr, valueExpr, credId, credName, posArr) {
  return {
    id, name, type: 'n8n-nodes-base.redis', typeVersion: 1, position: posArr,
    credentials: { redis: { id: credId, name: credName } },
    parameters: { operation: 'lPush', key: keyExpr, value: valueExpr },
  };
}

function makeRedisLrange(id, name, keyExpr, credId, credName, posArr) {
  return {
    id, name, type: 'n8n-nodes-base.redis', typeVersion: 1, position: posArr,
    credentials: { redis: { id: credId, name: credName } },
    parameters: { operation: 'lrange', key: keyExpr, start: 0, end: -1 },
  };
}

function makeRedisDelete(id, name, keyExpr, credId, credName, posArr) {
  return {
    id, name, type: 'n8n-nodes-base.redis', typeVersion: 1, position: posArr,
    credentials: { redis: { id: credId, name: credName } },
    parameters: { operation: 'delete', key: keyExpr },
  };
}

function makeCode(id, name, jsCode, posArr) {
  return {
    id, name, type: 'n8n-nodes-base.code', typeVersion: 2, position: posArr,
    parameters: { mode: 'runOnceForAllItems', jsCode },
  };
}

function makeHttpRequest(id, name, method, urlExpr, bodyExpr, credType, credId, credName, posArr) {
  const base = {
    id, name, type: 'n8n-nodes-base.httpRequest', typeVersion: 4.2, position: posArr,
    parameters: {
      method,
      url: urlExpr,
      sendHeaders: false,
      sendQuery: false,
      sendBody: true,
      bodyContentType: 'json',
      specifyBody: 'json',
      jsonBody: bodyExpr,
      options: { redirect: { redirect: { followRedirects: true } } },
    },
  };
  if (credType && credId) {
    base.parameters.authentication = 'headerAuth';
    base.credentials = { [credType]: { id: credId, name: credName } };
  }
  return base;
}

function makeSplitInBatches(id, name, posArr) {
  return {
    id, name, type: 'n8n-nodes-base.splitInBatches', typeVersion: 3, position: posArr,
    parameters: { batchSize: 1, options: {} },
  };
}

function makeRespondToWebhook(id, name, posArr) {
  return {
    id, name, type: 'n8n-nodes-base.respondToWebhook', typeVersion: 1, position: posArr,
    parameters: { respondWith: 'json', responseBody: '{ "ok": true }', options: {} },
  };
}

// ──────────────────────────────────────────────────
// WORKFLOW: [CORE] Entrada de Mensagem
// ──────────────────────────────────────────────────
function buildEntradaWorkflow(wf, redisCredId, redisCredName) {
  const normalizeCode = `
const body = $input.first().json.body ?? $input.first().json;
const event = body.event ?? '';
const data = body.data ?? {};
const msg = data.message ?? {};
const key = data.key ?? {};

// Aceita apenas mensagens recebidas (não enviadas por nós)
if (key.fromMe === true) return [];
if (!['messages.upsert','message.upsert'].includes(event)) return [];

const instance = body.instance ?? '';
const remoteJid = key.remoteJid ?? '';
const telefone = remoteJid.replace(/@.+/, '').replace(/[:@]/g, '');
const messageId = key.id ?? '';
const pushName = data.pushName ?? data.sender?.pushName ?? '';
const timestamp = data.messageTimestamp ?? Math.floor(Date.now()/1000);

// Extrai tipo e conteúdo da mensagem
let tipo = 'desconhecido';
let conteudo = '';
let metadata = {};

if (msg.conversation) {
  tipo = 'texto'; conteudo = msg.conversation;
} else if (msg.extendedTextMessage) {
  tipo = 'texto'; conteudo = msg.extendedTextMessage.text ?? '';
} else if (msg.imageMessage) {
  tipo = 'imagem'; conteudo = msg.imageMessage.caption ?? '[imagem]'; metadata = { url: msg.imageMessage.url, mimetype: msg.imageMessage.mimetype };
} else if (msg.videoMessage) {
  tipo = 'video'; conteudo = msg.videoMessage.caption ?? '[vídeo]'; metadata = { url: msg.videoMessage.url, mimetype: msg.videoMessage.mimetype };
} else if (msg.audioMessage) {
  tipo = 'audio'; conteudo = '[mensagem de voz]'; metadata = { url: msg.audioMessage.url, ptt: msg.audioMessage.ptt };
} else if (msg.documentMessage) {
  tipo = 'documento'; conteudo = msg.documentMessage.caption ?? msg.documentMessage.fileName ?? '[documento]'; metadata = { fileName: msg.documentMessage.fileName, url: msg.documentMessage.url };
} else if (msg.stickerMessage) {
  tipo = 'sticker'; conteudo = '[sticker]';
} else if (msg.locationMessage) {
  tipo = 'localizacao'; conteudo = '[localização]'; metadata = { lat: msg.locationMessage.degreesLatitude, lng: msg.locationMessage.degreesLongitude };
} else if (msg.contactMessage || msg.contactsArrayMessage) {
  tipo = 'contato'; conteudo = '[contato]';
} else if (msg.reactionMessage) {
  return []; // ignora reações
} else if (msg.pollCreationMessage) {
  tipo = 'enquete'; conteudo = msg.pollCreationMessage.name ?? '[enquete]';
}

if (!instance || !telefone) return [];

return [{ json: { instance, remoteJid, telefone, messageId, pushName, timestamp, tipo, conteudo, metadata } }];
`.trim();

  const nodes = [
    makeWebhook('webhook-entrada', 'Webhook Evolution', 'evolution', 'onReceived'),
    makeCode('normalizar', 'Normalizar Mensagem', normalizeCode, pos(480, 300)),
    makeRedisRpush('rpush-buffer', 'Buffer RPUSH', "={{ 'buffer:' + $json.instance + ':' + $json.telefone }}", "={{ $json.tipo + '|' + $json.messageId + '|' + JSON.stringify($json).replace(/\\|/g,'') }}", redisCredId, redisCredName, pos(720, 300)),
    makeHttpRequest('call-agent', 'Chamar Agente', 'POST', `${N8N_URL}/webhook/agent-executor`, '={{ JSON.stringify($json) }}', null, null, null, pos(960, 300)),
  ];

  const connections = {
    'Webhook Evolution': { main: [[{ node: 'Normalizar Mensagem', type: 'main', index: 0 }]] },
    'Normalizar Mensagem': { main: [[{ node: 'Buffer RPUSH', type: 'main', index: 0 }]] },
    'Buffer RPUSH': { main: [[{ node: 'Chamar Agente', type: 'main', index: 0 }]] },
  };

  return {
    ...wf,
    nodes,
    connections,
    settings: { executionOrder: 'v1', saveManualExecutions: true, callerPolicy: 'workflowsFromSameOwner' },
  };
}

// ──────────────────────────────────────────────────
// WORKFLOW: [AGENT] Executor
// ──────────────────────────────────────────────────
function buildAgentWorkflow(wf, redisCredId, redisCredName, evolutionCredId, evolutionCredName) {
  const buildPromptCode = `
const msg = $input.first().json;
const sessao = $('Redis GET Sessão').first().json;

// Histórico de conversa armazenado no Redis como JSON
let historico = [];
try {
  const raw = sessao.value ?? sessao;
  if (typeof raw === 'string') historico = JSON.parse(raw);
  else if (Array.isArray(raw)) historico = raw;
} catch {}

const sistemaPrompt = \`Você é um assistente de vendas da Vendly. Responda em português, de forma natural e amigável.
Nome do cliente: \${msg.pushName || 'cliente'}
Canal: WhatsApp
Instância: \${msg.instance}
Regras:
- Divida respostas longas em múltiplas mensagens curtas (3-8 palavras cada parte)
- Use emojis com moderação
- Nunca envie blocos longos de texto
- Responda apenas ao que foi perguntado\`;

const mensagemAtual = \`[\${msg.tipo}] \${msg.conteudo}\`;

const messages = [
  { role: 'system', content: sistemaPrompt },
  ...historico.slice(-20), // mantém últimas 20 mensagens
  { role: 'user', content: mensagemAtual },
];

return [{ json: { ...msg, messages, historico } }];
`.trim();

  const parseChunksCode = `
const item = $input.first().json;
const resp = $('OpenRouter').first().json;

const content = resp.choices?.[0]?.message?.content ?? resp.error?.message ?? 'Desculpe, erro interno.';
const msgs = item.messages;
const historico = item.historico ?? [];

// Divide resposta em chunks naturais (por parágrafo/frase curta/linha)
const chunks = content
  .split(/\\n+/)
  .map(s => s.trim())
  .filter(s => s.length > 0)
  .flatMap(s => {
    // Se um parágrafo é muito longo, divide nas sentenças
    if (s.length <= 180) return [s];
    return s.match(/[^.!?]+[.!?]+/g)?.map(x => x.trim()).filter(Boolean) ?? [s];
  });

// Atualiza histórico
const novoHistorico = [
  ...historico,
  { role: 'user', content: item.conteudo },
  { role: 'assistant', content: content },
];

// Prepara contexto (passado adiante para o Redis SET no final)
const contexto = {
  instance: item.instance,
  telefone: item.telefone,
  remoteJid: item.remoteJid,
  historico: novoHistorico,
};

// Retorna um item por chunk + último item com contexto para salvar sessão
return chunks.map((texto, i) => ({
  json: {
    chunk: texto,
    isLast: i === chunks.length - 1,
    contexto,
    instance: item.instance,
    remoteJid: item.remoteJid,
    delay: 800 + i * 600,
  }
}));
`.trim();

  const prepareEvolutionCode = `
const item = $input.first().json;
const { instance, remoteJid, chunk, delay } = item;

// Aguarda delay para simular digitação natural
await new Promise(r => setTimeout(r, delay ?? 800));

return [{
  json: {
    ...item,
    evolutionUrl: \`${EVOLUTION_URL}/message/sendText/\${instance}\`,
    evolutionBody: {
      number: remoteJid,
      text: chunk,
      delay: 300,
    }
  }
}];
`.trim();

  const saveSessionCode = `
const items = $input.all();
// Pega o contexto do último item processado
const last = items[items.length - 1]?.json ?? {};
return [{ json: { contexto: last.contexto } }];
`.trim();

  const nodes = [
    makeWebhook('webhook-agent', 'Webhook Agente', 'agent-executor', 'onReceived'),
    makeRedisGet('redis-get-sessao', 'Redis GET Sessão', "={{ 'sessao:' + $json.instance + ':' + $json.telefone }}", redisCredId, redisCredName, pos(480, 300)),
    makeCode('build-prompt', 'Construir Prompt', buildPromptCode, pos(720, 300)),
    {
      id: 'openrouter-llm',
      name: 'OpenRouter',
      type: 'n8n-nodes-base.httpRequest',
      typeVersion: 4.2,
      position: pos(960, 300),
      parameters: {
        method: 'POST',
        url: 'https://openrouter.ai/api/v1/chat/completions',
        authentication: 'headerAuth',
        sendBody: true,
        bodyContentType: 'json',
        specifyBody: 'json',
        jsonBody: `={{ JSON.stringify({ model: '${OPENROUTER_MODEL}', messages: $json.messages, max_tokens: 1024, temperature: 0.8 }) }}`,
        options: {},
      },
      credentials: {
        httpHeaderAuth: { id: null, name: 'OpenRouter' }, // será preenchido abaixo
      },
    },
    makeCode('parse-chunks', 'Parsear Chunks', parseChunksCode, pos(1200, 300)),
    makeSplitInBatches('loop-chunks', 'Loop Chunks', pos(1440, 300)),
    makeCode('prep-evolution', 'Preparar Envio', prepareEvolutionCode, pos(1680, 200)),
    {
      id: 'evolution-send',
      name: 'Evolution Send',
      type: 'n8n-nodes-base.httpRequest',
      typeVersion: 4.2,
      position: pos(1920, 200),
      parameters: {
        method: 'POST',
        url: '={{ $json.evolutionUrl }}',
        authentication: 'headerAuth',
        sendBody: true,
        bodyContentType: 'json',
        specifyBody: 'json',
        jsonBody: '={{ JSON.stringify($json.evolutionBody) }}',
        options: {},
      },
      credentials: {
        httpHeaderAuth: { id: evolutionCredId, name: evolutionCredName },
      },
    },
    makeCode('save-session', 'Preparar Sessão', saveSessionCode, pos(1680, 440)),
    makeRedisSet('redis-set-sessao', 'Redis SET Sessão', "={{ 'sessao:' + $json.contexto.instance + ':' + $json.contexto.telefone }}", '={{ JSON.stringify($json.contexto.historico) }}', redisCredId, redisCredName, pos(1920, 440)),
  ];

  const connections = {
    'Webhook Agente': { main: [[{ node: 'Redis GET Sessão', type: 'main', index: 0 }]] },
    'Redis GET Sessão': { main: [[{ node: 'Construir Prompt', type: 'main', index: 0 }]] },
    'Construir Prompt': { main: [[{ node: 'OpenRouter', type: 'main', index: 0 }]] },
    'OpenRouter': { main: [[{ node: 'Parsear Chunks', type: 'main', index: 0 }]] },
    'Parsear Chunks': { main: [[{ node: 'Loop Chunks', type: 'main', index: 0 }]] },
    'Loop Chunks': {
      main: [
        [{ node: 'Preparar Envio', type: 'main', index: 0 }],  // output 0: processa próximo item
        [{ node: 'Preparar Sessão', type: 'main', index: 0 }], // output 1: terminou tudo
      ],
    },
    'Preparar Envio': { main: [[{ node: 'Evolution Send', type: 'main', index: 0 }]] },
    'Evolution Send': { main: [[{ node: 'Loop Chunks', type: 'main', index: 0 }]] },
    'Preparar Sessão': { main: [[{ node: 'Redis SET Sessão', type: 'main', index: 0 }]] },
  };

  return {
    ...wf,
    nodes,
    connections,
    settings: { executionOrder: 'v1', saveManualExecutions: true },
  };
}

// ──────────────────────────────────────────────────
// MAIN
// ──────────────────────────────────────────────────
async function main() {
  console.log('\n🚀 setup-stack.mjs — configurando N8N\n');
  console.log(`  N8N: ${N8N_URL}`);
  console.log(`  Evolution: ${EVOLUTION_URL}`);
  console.log(`  Redis: ${REDIS_HOST}:${REDIS_PORT}\n`);

  // 1. Criar/encontrar credenciais
  console.log('📦 Credenciais:\n');

  const redisCredId = await findOrCreateCredential('Redis Vendly', 'redis', {
    host: REDIS_HOST,
    port: parseInt(REDIS_PORT, 10),
    password: REDIS_PASS,
    database: parseInt(REDIS_DB, 10),
    ssl: false,
  });

  const openrouterCredId = await findOrCreateCredential('OpenRouter', 'httpHeaderAuth', {
    name: 'Authorization',
    value: `Bearer ${OPENROUTER_KEY}`,
  });

  const evolutionCredId = await findOrCreateCredential('Evolution API', 'httpHeaderAuth', {
    name: 'apikey',
    value: EVOLUTION_KEY,
  });

  console.log('\n✅ Credenciais prontas\n');

  // 2. Atualizar [CORE] Entrada de Mensagem
  console.log('🔄 Atualizando workflows...\n');

  {
    console.log(`  → [CORE] Entrada de Mensagem (${WF.entrada})`);
    const wf = await getWorkflow(WF.entrada);
    const updated = buildEntradaWorkflow(wf, redisCredId, 'Redis Vendly');
    await updateWorkflow(WF.entrada, updated);
    console.log('    ✅ Atualizado');
    try { await activateWorkflow(WF.entrada); console.log('    ✅ Ativado'); } catch {}
  }

  // 3. Atualizar [AGENT] Executor
  {
    console.log(`  → [AGENT] Executor (${WF.agent})`);
    const wf = await getWorkflow(WF.agent);
    const updated = buildAgentWorkflow(wf, redisCredId, 'Redis Vendly', evolutionCredId, 'Evolution API');
    // Preenche credencial OpenRouter no nó
    const orNode = updated.nodes.find(n => n.id === 'openrouter-llm');
    if (orNode) orNode.credentials.httpHeaderAuth.id = openrouterCredId;
    await updateWorkflow(WF.agent, updated);
    console.log('    ✅ Atualizado');
    try { await activateWorkflow(WF.agent); console.log('    ✅ Ativado'); } catch {}
  }

  console.log('\n✨ Setup completo!\n');
  console.log('Próximos passos:');
  console.log('  1. Configure o webhook da Evolution API para POST para:');
  console.log(`     ${N8N_URL}/webhook/evolution`);
  console.log('  2. Teste enviando uma mensagem no WhatsApp');
  console.log('  3. Verifique as execuções em:', `${N8N_URL}/executions`);
  console.log('');
}

main().catch(err => {
  console.error('❌ Erro:', err.response?.data ?? err.message);
  process.exit(1);
});

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
const OPENROUTER_MULTIMODAL_MODEL = ENV('OPENROUTER_MULTIMODAL_MODEL') || OPENROUTER_MODEL;
const OPENROUTER_TTS_MODEL = ENV('OPENROUTER_TTS_MODEL') || '';

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
    parameters: { operation: 'get', key: keyExpr, propertyName: 'value' },
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
    parameters: { operation: 'push', list: keyExpr, messageData: valueExpr },
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
  // typeVersion 1: batchSize como parâmetro top-level funciona corretamente na API do N8N
  // typeVersion 3 ignora batchSize e salta direto para done (output 1) sem processar itens
  return {
    id, name, type: 'n8n-nodes-base.splitInBatches', typeVersion: 1, position: posArr,
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
  // respondWithAudio: só responde com áudio TTS se OPENROUTER_TTS_MODEL estiver configurado
  const respondWithAudioExpr = OPENROUTER_TTS_MODEL
    ? `msg.tipo === 'audio'`
    : 'false';

  const buildPromptCode = `
// Redis GET substitui o item inteiro — buscar dados originais via $('Desembalar Payload')
const msg = $('Desembalar Payload').first().json;
const sessao = $input.first().json; // output do Redis GET: { value: <json_or_null> }

let historico = [];
try {
  // 'value' = propertyName configurado no Redis GET; fallback para 'propertyName' (legado)
  const raw = sessao.value ?? sessao.propertyName ?? null;
  if (typeof raw === 'string') historico = JSON.parse(raw);
  else if (Array.isArray(raw)) historico = raw;
} catch {}

const sistemaPrompt = \`Você é um assistente de vendas da Vendly. Responda em português, de forma natural e amigável.
Nome do cliente: \${msg.pushName || 'cliente'}
Canal: WhatsApp
Instância: \${msg.instance}
Regras:
- Divida respostas longas em múltiplas mensagens curtas
- Use emojis com moderação
- Nunca envie blocos longos de texto
- Responda apenas ao que foi perguntado\`;

// Constrói conteúdo multimodal baseado no tipo da mensagem
let userContent;
if (msg.tipo === 'imagem' && msg.metadata?.url) {
  userContent = [
    { type: 'text', text: msg.conteudo || 'O cliente enviou uma imagem. Analise e responda:' },
    { type: 'image_url', image_url: { url: msg.metadata.url } },
  ];
} else if (msg.tipo === 'audio') {
  userContent = '[mensagem de voz recebida] Peça educadamente ao cliente que envie a mensagem em texto.';
} else if (msg.tipo === 'documento') {
  userContent = \`[documento: \${msg.metadata?.fileName || msg.conteudo}]\`;
} else if (msg.tipo === 'video') {
  userContent = \`[vídeo enviado: \${msg.conteudo}]\`;
} else if (msg.tipo === 'localizacao') {
  userContent = \`[localização: lat=\${msg.metadata?.lat}, lng=\${msg.metadata?.lng}]\`;
} else {
  userContent = msg.conteudo;
}

const messages = [
  { role: 'system', content: sistemaPrompt },
  ...historico.slice(-20),
  { role: 'user', content: userContent },
];

const respondWithAudio = ${respondWithAudioExpr};

return [{ json: { ...msg, messages, historico, respondWithAudio } }];
`.trim();

  // NOTA: $input.first() após HTTP Request = resposta da API. Usar $('Construir Prompt') para dados originais.
  const parseChunksCode = `
const promptData = $('Construir Prompt').first().json;
const resp = $input.first().json;

const content = resp.choices?.[0]?.message?.content ?? resp.error?.message ?? 'Desculpe, erro interno.';
const historico = promptData.historico ?? [];
const respondWithAudio = promptData.respondWithAudio ?? false;

const chunks = content
  .split(/\\n+/)
  .map(s => s.trim())
  .filter(s => s.length > 0)
  .flatMap(s => {
    if (s.length <= 180) return [s];
    return s.match(/[^.!?]+[.!?]+/g)?.map(x => x.trim()).filter(Boolean) ?? [s];
  });

const novoHistorico = [
  ...historico,
  { role: 'user', content: typeof promptData.messages[promptData.messages.length - 1]?.content === 'string'
      ? promptData.messages[promptData.messages.length - 1].content
      : promptData.conteudo },
  { role: 'assistant', content },
];

const contexto = {
  instance: promptData.instance,
  telefone: promptData.telefone,
  remoteJid: promptData.remoteJid,
  historico: novoHistorico,
};

return chunks.map((texto, i) => ({
  json: {
    chunk: texto,
    fullText: content,
    isLast: i === chunks.length - 1,
    respondWithAudio,
    contexto,
    instance: promptData.instance,
    remoteJid: promptData.remoteJid,
    delay: 800 + i * 600,
  }
}));
`.trim();

  const extractB64TtsCode = `
const binaryData = $input.first().binary?.data;
if (!binaryData) throw new Error('TTS: sem dados de áudio na resposta');
const audioBase64 = binaryData.data;

const allChunks = $('Parsear Chunks').all();
const ctx = allChunks[allChunks.length - 1]?.json ?? {};

return [{
  json: {
    audioBase64,
    instance: ctx.instance,
    remoteJid: ctx.remoteJid,
    evolutionAudioUrl: \`${EVOLUTION_URL}/message/sendWhatsAppAudio/\${ctx.instance}\`,
    evolutionAudioBody: { number: ctx.remoteJid, audio: audioBase64, encoding: true },
    contexto: ctx.contexto,
  }
}];
`.trim();

  const prepareEvolutionCode = `
const item = $input.first().json;
const { instance, remoteJid, chunk, delay } = item;

return [{
  json: {
    ...item,
    presenceUrl: \`${EVOLUTION_URL}/chat/sendPresence/\${instance}\`,
    presenceBody: {
      number: remoteJid,
      options: { delay: delay ?? 800, presence: 'composing', number: remoteJid },
    },
    evolutionUrl: \`${EVOLUTION_URL}/message/sendText/\${instance}\`,
    evolutionBody: { number: remoteJid, text: chunk, delay: 0 },
  }
}];
`.trim();

  const waitCode = `
const item = $input.first().json;
await new Promise(r => setTimeout(r, item.delay ?? 800));
return [{ json: item }];
`.trim();

  const saveSessionCode = `
const items = $input.all();
const last = items[items.length - 1]?.json ?? {};
return [{ json: { contexto: last.contexto } }];
`.trim();

  const nodes = [
    makeWebhook('webhook-agent', 'Webhook Agente', 'agent-executor', 'onReceived'),
    // Desembala wrapper do Webhook v2: {body, headers, query} → dados diretos
    makeCode('unwrap-payload', 'Desembalar Payload', 'const raw = $input.first().json; const data = raw.body ?? raw; return [{ json: data }];', pos(360, 300)),
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
        jsonBody: `={{ JSON.stringify({ model: '${OPENROUTER_MULTIMODAL_MODEL}', messages: $json.messages, max_tokens: 1024, temperature: 0.8 }) }}`,
        options: {},
      },
      credentials: {
        httpHeaderAuth: { id: null, name: 'OpenRouter' }, // será preenchido abaixo
      },
    },
    makeCode('parse-chunks', 'Parsear Chunks', parseChunksCode, pos(1200, 300)),
    // === IF: responde com áudio TTS ou texto normal? ===
    {
      id: 'if-audio-response',
      name: 'IF Responder com Áudio?',
      type: 'n8n-nodes-base.if',
      typeVersion: 1,
      position: pos(1440, 300),
      parameters: {
        conditions: {
          boolean: [{ value1: '={{ $json.respondWithAudio }}', operation: 'equal', value2: true }],
        },
      },
    },
    // === CAMINHO ÁUDIO (TTS) — saída true do IF ===
    {
      id: 'openrouter-tts',
      name: 'OpenRouter TTS',
      type: 'n8n-nodes-base.httpRequest',
      typeVersion: 4.2,
      position: pos(1680, 160),
      parameters: {
        method: 'POST',
        url: 'https://openrouter.ai/api/v1/audio/speech',
        authentication: 'headerAuth',
        sendBody: true,
        bodyContentType: 'json',
        specifyBody: 'json',
        jsonBody: `={{ JSON.stringify({ model: '${OPENROUTER_TTS_MODEL || 'openai/gpt-4o-mini-tts'}', input: $json.fullText, voice: 'alloy', response_format: 'mp3' }) }}`,
        options: { response: { response: { responseFormat: 'file' } } },
      },
      credentials: { httpHeaderAuth: { id: null, name: 'OpenRouter' } },
    },
    makeCode('extract-b64-tts', 'Extrair B64 TTS', extractB64TtsCode, pos(1920, 160)),
    {
      id: 'evolution-send-audio',
      name: 'Evolution Send Áudio',
      type: 'n8n-nodes-base.httpRequest',
      typeVersion: 4.2,
      position: pos(2160, 160),
      parameters: {
        method: 'POST',
        url: '={{ $json.evolutionAudioUrl }}',
        authentication: 'headerAuth',
        sendBody: true,
        bodyContentType: 'json',
        specifyBody: 'json',
        jsonBody: '={{ JSON.stringify($json.evolutionAudioBody) }}',
        options: { response: { response: { neverError: true } } },
      },
      credentials: { httpHeaderAuth: { id: evolutionCredId, name: evolutionCredName } },
    },
    makeCode('save-session-audio', 'Preparar Sessão Áudio', 'const item = $input.first().json; return [{ json: { contexto: item.contexto } }];', pos(2400, 160)),
    makeRedisSet('redis-set-sessao-audio', 'Redis SET Sessão Áudio', "={{ 'sessao:' + $json.contexto.instance + ':' + $json.contexto.telefone }}", '={{ JSON.stringify($json.contexto.historico) }}', redisCredId, redisCredName, pos(2640, 160)),
    // === CAMINHO TEXTO — saída false do IF ===
    makeSplitInBatches('loop-chunks', 'Loop Chunks', pos(1680, 440)),
    makeCode('prep-evolution', 'Preparar Envio', prepareEvolutionCode, pos(1920, 440)),
    {
      id: 'presence-digitando',
      name: 'Presence Digitando',
      type: 'n8n-nodes-base.httpRequest',
      typeVersion: 4.2,
      position: pos(2160, 400),
      parameters: {
        method: 'POST',
        url: '={{ $json.presenceUrl }}',
        authentication: 'headerAuth',
        sendBody: true,
        bodyContentType: 'json',
        specifyBody: 'json',
        jsonBody: '={{ JSON.stringify($json.presenceBody) }}',
        options: { response: { response: { neverError: true } } },
      },
      credentials: { httpHeaderAuth: { id: evolutionCredId, name: evolutionCredName } },
    },
    makeCode('wait-typing', 'Aguardar Digitação', waitCode, pos(2400, 400)),
    {
      id: 'evolution-send',
      name: 'Evolution Send',
      type: 'n8n-nodes-base.httpRequest',
      typeVersion: 4.2,
      position: pos(2640, 400),
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
      credentials: { httpHeaderAuth: { id: evolutionCredId, name: evolutionCredName } },
    },
    makeCode('save-session', 'Preparar Sessão', saveSessionCode, pos(2880, 440)),
    makeRedisSet('redis-set-sessao', 'Redis SET Sessão', "={{ 'sessao:' + $json.contexto.instance + ':' + $json.contexto.telefone }}", '={{ JSON.stringify($json.contexto.historico) }}', redisCredId, redisCredName, pos(3120, 440)),
  ];

  const connections = {
    'Webhook Agente': { main: [[{ node: 'Desembalar Payload', type: 'main', index: 0 }]] },
    'Desembalar Payload': { main: [[{ node: 'Redis GET Sessão', type: 'main', index: 0 }]] },
    'Redis GET Sessão': { main: [[{ node: 'Construir Prompt', type: 'main', index: 0 }]] },
    'Construir Prompt': { main: [[{ node: 'OpenRouter', type: 'main', index: 0 }]] },
    'OpenRouter': { main: [[{ node: 'Parsear Chunks', type: 'main', index: 0 }]] },
    'Parsear Chunks': { main: [[{ node: 'IF Responder com Áudio?', type: 'main', index: 0 }]] },
    'IF Responder com Áudio?': {
      main: [
        [{ node: 'OpenRouter TTS', type: 'main', index: 0 }],  // output 0 (true) → áudio
        [{ node: 'Loop Chunks', type: 'main', index: 0 }],     // output 1 (false) → texto
      ],
    },
    // Caminho áudio
    'OpenRouter TTS': { main: [[{ node: 'Extrair B64 TTS', type: 'main', index: 0 }]] },
    'Extrair B64 TTS': { main: [[{ node: 'Evolution Send Áudio', type: 'main', index: 0 }]] },
    'Evolution Send Áudio': { main: [[{ node: 'Preparar Sessão Áudio', type: 'main', index: 0 }]] },
    'Preparar Sessão Áudio': { main: [[{ node: 'Redis SET Sessão Áudio', type: 'main', index: 0 }]] },
    // Caminho texto
    'Loop Chunks': {
      main: [
        [{ node: 'Preparar Envio', type: 'main', index: 0 }],  // output 0: processa item
        [{ node: 'Preparar Sessão', type: 'main', index: 0 }], // output 1: terminou
      ],
    },
    'Preparar Envio': { main: [[{ node: 'Presence Digitando', type: 'main', index: 0 }]] },
    'Presence Digitando': { main: [[{ node: 'Aguardar Digitação', type: 'main', index: 0 }]] },
    'Aguardar Digitação': { main: [[{ node: 'Evolution Send', type: 'main', index: 0 }]] },
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
  console.log(`  Redis: ${REDIS_HOST}:${REDIS_PORT}`);
  console.log(`  Modelo LLM: ${OPENROUTER_MULTIMODAL_MODEL}`);
  if (OPENROUTER_TTS_MODEL) console.log(`  Modelo TTS: ${OPENROUTER_TTS_MODEL}`);
  if (REDIS_HOST.length < 20) console.warn(`  ⚠️  REDIS_HOST parece um hostname Coolify interno (${REDIS_HOST}). Se N8N der EAI_AGAIN, conecte N8N e Redis na mesma rede Docker no Coolify.`);
  console.log('');

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
    const ttsNode = updated.nodes.find(n => n.id === 'openrouter-tts');
    if (ttsNode) ttsNode.credentials.httpHeaderAuth.id = openrouterCredId;
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

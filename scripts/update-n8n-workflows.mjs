/**
 * Atualiza workflows N8N existentes:
 * 1. [CORE] Entrada de Mensagem  — suporte a todos os tipos de mensagem WA
 * 2. [AGENT] Executor            — usa evolution_send_chunks para resposta humana
 */

import http from 'http';
import https from 'https';

const MCP_URL = process.env.MCP_URL ?? 'http://localhost:3001/mcp';
const N8N_WEBHOOK_BASE = process.env.N8N_WEBHOOK_BASE ?? 'https://n8n.vendly.chat';

// ── MCP helper ─────────────────────────────────────────────────────────────

function post(url, body) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const lib = u.protocol === 'https:' ? https : http;
    const data = JSON.stringify(body);
    const req = lib.request(
      { hostname: u.hostname, port: u.port || (u.protocol === 'https:' ? 443 : 80), path: u.pathname, method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json, text/event-stream', 'Content-Length': Buffer.byteLength(data) } },
      (res) => {
        let buf = '';
        res.on('data', c => buf += c);
        res.on('end', () => {
          const lines = buf.split('\n').filter(l => l.startsWith('data:'));
          const last = lines[lines.length - 1]?.replace(/^data:\s*/, '');
          try { resolve(JSON.parse(last)); } catch { resolve(buf); }
        });
      }
    );
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

let _sessionId = null;
async function mcpInit() {
  const res = await post(MCP_URL, { jsonrpc: '2.0', id: 1, method: 'initialize',
    params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'update-n8n', version: '1.0' } } });
  _sessionId = res?.result?.sessionId ?? null;
  await post(MCP_URL, { jsonrpc: '2.0', method: 'notifications/initialized', params: {} });
}

async function tool(name, args) {
  const res = await post(MCP_URL, {
    jsonrpc: '2.0', id: Date.now(), method: 'tools/call',
    params: { name, arguments: args },
  }).catch(e => ({ error: e.message }));
  const text = res?.result?.content?.[0]?.text ?? JSON.stringify(res?.result ?? res ?? null);
  if (!text || text === 'undefined') return null;
  try { return JSON.parse(text); } catch { return text; }
}

// ── Workflow 1: [CORE] Entrada de Mensagem — recebe TODOS os tipos ──────────

const ENTRADA_ID = process.env.ENTRADA_WF_ID ?? 'bEb19TdWZfFloisU';

const entradaNodes = [
  {
    id: 'webhook',
    name: 'Webhook Evolution',
    type: 'n8n-nodes-base.webhook',
    typeVersion: 2,
    position: [240, 300],
    parameters: {
      path: 'evolution',
      httpMethod: 'POST',
      responseMode: 'responseNode',
    },
  },
  {
    id: 'filter',
    name: 'Ignorar fromMe e sem conteúdo',
    type: 'n8n-nodes-base.if',
    typeVersion: 2,
    position: [460, 300],
    parameters: {
      conditions: {
        options: { caseSensitive: true, leftValue: '', typeValidation: 'strict' },
        conditions: [
          {
            id: 'c1',
            leftValue: '={{ $json.body.data.key.fromMe }}',
            rightValue: true,
            operator: { type: 'boolean', operation: 'notEquals' },
          },
          {
            id: 'c2',
            leftValue: '={{ $json.body.event }}',
            rightValue: 'messages.upsert',
            operator: { type: 'string', operation: 'equals' },
          },
        ],
        combinator: 'and',
      },
    },
  },
  {
    id: 'normalize',
    name: 'Normalizar Mensagem',
    type: 'n8n-nodes-base.code',
    typeVersion: 2,
    position: [680, 300],
    parameters: {
      jsCode: `
// Normaliza qualquer tipo de mensagem WA para formato padrão
const body = $input.item.json.body;
const data = body.data ?? {};
const key = data.key ?? {};
const msg = data.message ?? {};
const ts = data.messageTimestamp ?? Math.floor(Date.now() / 1000);

// Extrai número limpo (remove @s.whatsapp.net / @g.us)
const remoteJid = key.remoteJid ?? '';
const telefone = remoteJid.replace(/@.+$/, '').replace(/[^0-9]/g, '');
const isGroup = remoteJid.endsWith('@g.us');
const participante = data.participant ?? key.participant ?? remoteJid;

// Detecta tipo e extrai conteúdo
let tipo = 'texto';
let conteudo = '';
let metadata = {};

if (msg.conversation) {
  tipo = 'texto';
  conteudo = msg.conversation;
} else if (msg.extendedTextMessage) {
  tipo = 'texto';
  conteudo = msg.extendedTextMessage.text ?? '';
  metadata.contextInfo = msg.extendedTextMessage.contextInfo;
} else if (msg.imageMessage) {
  tipo = 'imagem';
  conteudo = msg.imageMessage.caption ?? '[imagem sem legenda]';
  metadata.url = msg.imageMessage.url;
  metadata.mimetype = msg.imageMessage.mimetype;
} else if (msg.videoMessage) {
  tipo = 'video';
  conteudo = msg.videoMessage.caption ?? '[vídeo sem legenda]';
  metadata.url = msg.videoMessage.url;
  metadata.mimetype = msg.videoMessage.mimetype;
} else if (msg.audioMessage) {
  tipo = msg.audioMessage.ptt ? 'audio_ptt' : 'audio';
  conteudo = '[mensagem de áudio]';
  metadata.url = msg.audioMessage.url;
  metadata.segundos = msg.audioMessage.seconds;
} else if (msg.documentMessage) {
  tipo = 'documento';
  conteudo = msg.documentMessage.caption ?? msg.documentMessage.fileName ?? '[documento]';
  metadata.url = msg.documentMessage.url;
  metadata.fileName = msg.documentMessage.fileName;
  metadata.mimetype = msg.documentMessage.mimetype;
} else if (msg.documentWithCaptionMessage) {
  const inner = msg.documentWithCaptionMessage.message?.documentMessage ?? {};
  tipo = 'documento';
  conteudo = inner.caption ?? inner.fileName ?? '[documento]';
  metadata.url = inner.url;
  metadata.fileName = inner.fileName;
} else if (msg.stickerMessage) {
  tipo = 'sticker';
  conteudo = '[sticker]';
  metadata.url = msg.stickerMessage.url;
  metadata.isAnimated = msg.stickerMessage.isAnimated;
} else if (msg.locationMessage) {
  tipo = 'localizacao';
  conteudo = \`[localização] \${msg.locationMessage.name ?? ''} - \${msg.locationMessage.address ?? ''}\`.trim();
  metadata.latitude = msg.locationMessage.degreesLatitude;
  metadata.longitude = msg.locationMessage.degreesLongitude;
  metadata.name = msg.locationMessage.name;
  metadata.address = msg.locationMessage.address;
} else if (msg.contactMessage) {
  tipo = 'contato';
  conteudo = \`[contato] \${msg.contactMessage.displayName ?? ''}\`;
  metadata.vcard = msg.contactMessage.vcard;
} else if (msg.contactsArrayMessage) {
  tipo = 'contatos';
  conteudo = \`[contatos] \${(msg.contactsArrayMessage.contacts ?? []).map(c => c.displayName).join(', ')}\`;
} else if (msg.reactionMessage) {
  tipo = 'reacao';
  conteudo = \`[reação: \${msg.reactionMessage.text}]\`;
  metadata.reactionEmoji = msg.reactionMessage.text;
  metadata.targetMessageId = msg.reactionMessage.key?.id;
} else if (msg.pollCreationMessage) {
  tipo = 'enquete';
  const opts = (msg.pollCreationMessage.options ?? []).map(o => o.optionName).join(' | ');
  conteudo = \`[enquete] \${msg.pollCreationMessage.name}: \${opts}\`;
} else if (msg.pollUpdateMessage) {
  tipo = 'enquete_voto';
  conteudo = '[voto na enquete]';
  metadata.pollId = msg.pollUpdateMessage.pollCreationMessageKey?.id;
} else if (msg.buttonsResponseMessage) {
  tipo = 'botao_resposta';
  conteudo = msg.buttonsResponseMessage.selectedDisplayText ?? msg.buttonsResponseMessage.selectedButtonId ?? '[botão]';
} else if (msg.listResponseMessage) {
  tipo = 'lista_resposta';
  conteudo = msg.listResponseMessage.title ?? msg.listResponseMessage.singleSelectReply?.selectedRowId ?? '[opção de lista]';
} else if (msg.templateButtonReplyMessage) {
  tipo = 'template_resposta';
  conteudo = msg.templateButtonReplyMessage.selectedDisplayText ?? '[template reply]';
} else {
  tipo = 'desconhecido';
  conteudo = '[tipo de mensagem não identificado]';
  metadata.rawMessage = msg;
}

return {
  instance: body.instance ?? '',
  telefone,
  remoteJid,
  isGroup,
  participante,
  pushName: data.pushName ?? '',
  messageId: key.id ?? '',
  tipo,
  conteudo,
  metadata,
  timestamp: ts,
  raw: body,
};
`,
    },
  },
  {
    id: 'buffer',
    name: 'Adicionar ao Buffer Redis',
    type: 'n8n-nodes-base.httpRequest',
    typeVersion: 4.2,
    position: [900, 300],
    parameters: {
      method: 'POST',
      url: `${MCP_URL.replace('/mcp', '')}/mcp`,
      sendHeaders: true,
      headerParameters: { parameters: [{ name: 'Content-Type', value: 'application/json' }] },
      sendBody: true,
      bodyParameters: {
        parameters: [
          {
            name: 'JSON',
            value: `={
  "jsonrpc": "2.0",
  "id": {{ $now.toMillis() }},
  "method": "tools/call",
  "params": {
    "name": "redis_rpush",
    "arguments": {
      "key": "buffer:{{ $json.instance }}:{{ $json.telefone }}",
      "values": ["{{ $json.tipo }}|{{ $json.messageId }}|{{ $json.conteudo.replace(/"/g, '\\\\"').replace(/\\n/g, ' ') }}"],
      "ttl": 120
    }
  }
}`,
          },
        ],
      },
      options: {},
    },
  },
  {
    id: 'debounce_trigger',
    name: 'Agendar Debounce',
    type: 'n8n-nodes-base.httpRequest',
    typeVersion: 4.2,
    position: [1120, 300],
    parameters: {
      method: 'POST',
      url: `${N8N_WEBHOOK_BASE}/webhook/debounce-trigger`,
      sendBody: true,
      bodyContentType: 'json',
      jsonBody: `={{ JSON.stringify({ instance: $json.instance, telefone: $json.telefone, remoteJid: $json.remoteJid, isGroup: $json.isGroup, pushName: $json.pushName }) }}`,
      options: { redirect: { redirect: { followRedirects: true } } },
    },
  },
  {
    id: 'respond',
    name: 'Responder OK',
    type: 'n8n-nodes-base.respondToWebhook',
    typeVersion: 1,
    position: [1340, 300],
    parameters: { respondWith: 'text', responseBody: 'ok' },
  },
  {
    id: 'ignore',
    name: 'Ignorar',
    type: 'n8n-nodes-base.noOp',
    typeVersion: 1,
    position: [680, 480],
    parameters: {},
  },
];

const entradaConnections = {
  'Webhook Evolution': { main: [[{ node: 'Ignorar fromMe e sem conteúdo', type: 'main', index: 0 }]] },
  'Ignorar fromMe e sem conteúdo': {
    main: [
      [{ node: 'Normalizar Mensagem', type: 'main', index: 0 }],
      [{ node: 'Ignorar', type: 'main', index: 0 }],
    ],
  },
  'Normalizar Mensagem': { main: [[{ node: 'Adicionar ao Buffer Redis', type: 'main', index: 0 }]] },
  'Adicionar ao Buffer Redis': { main: [[{ node: 'Agendar Debounce', type: 'main', index: 0 }]] },
  'Agendar Debounce': { main: [[{ node: 'Responder OK', type: 'main', index: 0 }]] },
};

// ── Workflow 2: [AGENT] Executor — resposta humana com send_chunks ──────────

const AGENT_ID = process.env.AGENT_WF_ID ?? 'jleu4RPvSnYDL8Gd';

const agentNodes = [
  {
    id: 'webhook',
    name: 'Webhook Agente',
    type: 'n8n-nodes-base.webhook',
    typeVersion: 2,
    position: [240, 300],
    parameters: { path: 'agent-executor', httpMethod: 'POST', responseMode: 'responseNode' },
  },
  {
    id: 'load_context',
    name: 'Carregar Contexto',
    type: 'n8n-nodes-base.httpRequest',
    typeVersion: 4.2,
    position: [460, 300],
    parameters: {
      method: 'POST',
      url: `${MCP_URL.replace('/mcp', '')}/mcp`,
      sendHeaders: true,
      headerParameters: { parameters: [{ name: 'Content-Type', value: 'application/json' }] },
      sendBody: true,
      bodyParameters: {
        parameters: [
          {
            name: 'JSON',
            value: `={
  "jsonrpc": "2.0",
  "id": 1,
  "method": "tools/call",
  "params": {
    "name": "redis_get",
    "arguments": { "key": "sessao:{{ $json.body.instance }}:{{ $json.body.telefone }}" }
  }
}`,
          },
        ],
      },
      options: {},
    },
  },
  {
    id: 'build_prompt',
    name: 'Construir Prompt',
    type: 'n8n-nodes-base.code',
    typeVersion: 2,
    position: [680, 300],
    parameters: {
      jsCode: `
const input = $('Webhook Agente').item.json.body;
const sessaoRaw = $input.item.json?.result?.content?.[0]?.text;
let sessao = {};
try { sessao = JSON.parse(sessaoRaw); } catch {}

const historico = (sessao.historico ?? []).slice(-12); // últimas 12 msgs
const nome = input.pushName ?? 'cliente';
const tipo = input.tipo ?? 'texto';
const conteudo = input.conteudo ?? '';
const metadata = input.metadata ?? {};

// Sistema base — adapta conforme business_id/contexto
const systemPrompt = \`Você é um assistente de atendimento via WhatsApp.
Seu nome é Ayla. Você é simpática, direta e objetiva.

REGRAS DE COMUNICAÇÃO — CRÍTICAS:
- Nunca envie blocos grandes de texto. Máximo 2 frases por chunk.
- Use emojis de forma natural, não excessiva (1-2 por mensagem quando fizer sentido)
- Stickers apenas em momentos de celebração ou humor leve (raramente)
- Respostas devem soar como uma pessoa real digitando no WhatsApp
- Não use formatação markdown (sem *, **, -, etc.)
- Quebre ideias complexas em 3-5 mensagens curtas sequenciais

FORMATO DE RESPOSTA — OBRIGATÓRIO JSON:
Retorne APENAS um JSON válido, sem explicações:
{
  "chunks": [
    { "type": "text", "content": "primeira ideia", "delay": 800 },
    { "type": "text", "content": "segunda ideia 🙂", "delay": 1200 },
    { "type": "sticker", "content": "URL_DO_STICKER", "delay": 500 }
  ]
}

Tipos permitidos: text, sticker (use URL pública .webp), image (use URL).
Audio ainda não disponível neste contexto.

Histórico da conversa:
\${historico.map(h => \`[\${h.role}]: \${h.content}\`).join('\\n')}

Mensagem atual do cliente (\${tipo}): \${conteudo}\`;

return {
  instance: input.instance,
  telefone: input.telefone,
  remoteJid: input.remoteJid,
  systemPrompt,
  userMessage: conteudo,
  tipo,
  metadata,
  sessao,
};
`,
    },
  },
  {
    id: 'claude',
    name: 'Claude (Anthropic)',
    type: '@n8n/n8n-nodes-langchain.lmChatAnthropic',
    typeVersion: 1.3,
    position: [900, 180],
    parameters: {
      model: 'claude-sonnet-4-20250514',
      options: { maxTokens: 1024, temperature: 0.7 },
    },
  },
  {
    id: 'ai_agent',
    name: 'AI Agent',
    type: '@n8n/n8n-nodes-langchain.agent',
    typeVersion: 1.7,
    position: [900, 300],
    parameters: {
      agentType: 'conversationalAgent',
      text: '={{ $json.userMessage }}',
      systemMessage: '={{ $json.systemPrompt }}',
      options: {},
    },
  },
  {
    id: 'parse_response',
    name: 'Parse Chunks',
    type: 'n8n-nodes-base.code',
    typeVersion: 2,
    position: [1120, 300],
    parameters: {
      jsCode: `
const agentOutput = $input.item.json.output ?? $input.item.json.text ?? '';
const upstream = $('Construir Prompt').item.json;

// Tenta extrair JSON da resposta do agente
let chunks = [];
try {
  const jsonMatch = agentOutput.match(/\\{[\\s\\S]*"chunks"[\\s\\S]*\\}/);
  if (jsonMatch) {
    const parsed = JSON.parse(jsonMatch[0]);
    chunks = parsed.chunks ?? [];
  }
} catch (e) {}

// Fallback: se não conseguiu parsear JSON, quebra o texto em frases
if (chunks.length === 0) {
  const frases = agentOutput
    .split(/(?<=[.!?])[\\s]+/)
    .filter(f => f.trim().length > 0)
    .slice(0, 6); // máx 6 frases
  chunks = frases.map((f, i) => ({ type: 'text', content: f.trim(), delay: i === 0 ? 500 : 1000 + Math.min(f.length * 30, 2000) }));
}

return {
  instance: upstream.instance,
  telefone: upstream.telefone,
  chunks,
  sessao: upstream.sessao,
  userMessage: upstream.userMessage,
  agentOutput,
};
`,
    },
  },
  {
    id: 'send_chunks',
    name: 'Enviar Chunks (MCP)',
    type: 'n8n-nodes-base.httpRequest',
    typeVersion: 4.2,
    position: [1340, 300],
    parameters: {
      method: 'POST',
      url: `${MCP_URL.replace('/mcp', '')}/mcp`,
      sendHeaders: true,
      headerParameters: { parameters: [{ name: 'Content-Type', value: 'application/json' }] },
      sendBody: true,
      bodyParameters: {
        parameters: [
          {
            name: 'JSON',
            value: `={
  "jsonrpc": "2.0",
  "id": {{ $now.toMillis() }},
  "method": "tools/call",
  "params": {
    "name": "evolution_send_chunks",
    "arguments": {
      "instanceName": "{{ $json.instance }}",
      "number": "{{ $json.telefone }}",
      "delayBetween": 1200,
      "chunks": {{ JSON.stringify($json.chunks) }}
    }
  }
}`,
          },
        ],
      },
      options: {},
    },
  },
  {
    id: 'update_session',
    name: 'Atualizar Sessão Redis',
    type: 'n8n-nodes-base.httpRequest',
    typeVersion: 4.2,
    position: [1560, 300],
    parameters: {
      method: 'POST',
      url: `${MCP_URL.replace('/mcp', '')}/mcp`,
      sendHeaders: true,
      headerParameters: { parameters: [{ name: 'Content-Type', value: 'application/json' }] },
      sendBody: true,
      bodyParameters: {
        parameters: [
          {
            name: 'JSON',
            value: `={
  "jsonrpc": "2.0",
  "id": {{ $now.toMillis() + 1 }},
  "method": "tools/call",
  "params": {
    "name": "redis_set",
    "arguments": {
      "key": "sessao:{{ $json.instance }}:{{ $json.telefone }}",
      "value": {{ JSON.stringify(JSON.stringify({ ...($json.sessao ?? {}), historico: [...(($json.sessao?.historico ?? []).slice(-20)), { role: 'user', content: $json.userMessage }, { role: 'assistant', content: $json.agentOutput }] })) }},
      "ttl": 3600
    }
  }
}`,
          },
        ],
      },
      options: {},
    },
  },
  {
    id: 'respond',
    name: 'Responder OK',
    type: 'n8n-nodes-base.respondToWebhook',
    typeVersion: 1,
    position: [1780, 300],
    parameters: { respondWith: 'text', responseBody: 'ok' },
  },
];

const agentConnections = {
  'Webhook Agente': { main: [[{ node: 'Carregar Contexto', type: 'main', index: 0 }]] },
  'Carregar Contexto': { main: [[{ node: 'Construir Prompt', type: 'main', index: 0 }]] },
  'Construir Prompt': { main: [[{ node: 'AI Agent', type: 'main', index: 0 }]] },
  'Claude (Anthropic)': { ai_languageModel: [[{ node: 'AI Agent', type: 'ai_languageModel', index: 0 }]] },
  'AI Agent': { main: [[{ node: 'Parse Chunks', type: 'main', index: 0 }]] },
  'Parse Chunks': { main: [[{ node: 'Enviar Chunks (MCP)', type: 'main', index: 0 }]] },
  'Enviar Chunks (MCP)': { main: [[{ node: 'Atualizar Sessão Redis', type: 'main', index: 0 }]] },
  'Atualizar Sessão Redis': { main: [[{ node: 'Responder OK', type: 'main', index: 0 }]] },
};

// ── Execução ────────────────────────────────────────────────────────────────

async function run() {
  console.log('── Atualizar Workflows N8N ────────────────────────────────');
  await mcpInit();

  // 1. Atualizar [CORE] Entrada de Mensagem
  console.log(`\n  Atualizando [CORE] Entrada de Mensagem (${ENTRADA_ID})...`);
  const r1 = await tool('n8n_update_workflow', {
    id: ENTRADA_ID,
    name: '[CORE] Entrada de Mensagem',
    nodes: entradaNodes,
    connections: entradaConnections,
    settings: {},
  });
  if (r1 && typeof r1 === 'object' && r1?.id) {
    console.log(`  ✅ Atualizado — id: ${r1.id}`);
  } else {
    console.log(`  ⚠️  Resposta:`, JSON.stringify(r1 ?? null).slice(0, 300));
  }

  // 2. Atualizar [AGENT] Executor
  console.log(`\n  Atualizando [AGENT] Executor (${AGENT_ID})...`);
  const r2 = await tool('n8n_update_workflow', {
    id: AGENT_ID,
    name: '[AGENT] Executor',
    nodes: agentNodes,
    connections: agentConnections,
    settings: {},
  });
  if (r2 && typeof r2 === 'object' && r2?.id) {
    console.log(`  ✅ Atualizado — id: ${r2.id}`);
  } else {
    console.log(`  ⚠️  Resposta:`, JSON.stringify(r2 ?? null).slice(0, 300));
  }

  console.log('\n✅ Pronto.');
  console.log('\n⚠️  Próximos passos:');
  console.log('   1. Configurar credencial Anthropic no N8N (Claude)');
  console.log('   2. Ativar os workflows no painel N8N');
  console.log('   3. Configurar webhook Evolution → URL do [CORE] Entrada de Mensagem');
  console.log('   4. Testar recebendo uma mensagem de cada tipo');
}

run().catch(console.error);

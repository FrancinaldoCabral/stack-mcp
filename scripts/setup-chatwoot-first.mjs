/**
 * setup-chatwoot-first.mjs
 * Configura a arquitetura "Chatwoot-first" onde:
 *   - Webhook da Evolution → Chatwoot (sync nativo)
 *   - Chatwoot Agent Bot → N8N (/webhook/chatwoot-bot)
 *   - Bot responde via Chatwoot API → Chatwoot → Evolution → WhatsApp
 *   - Histórico da conversa vem do Chatwoot (não mais Redis)
 *
 * Uso: node scripts/setup-chatwoot-first.mjs [--instance suporte-redatudo]
 */

import { readFileSync } from 'fs';
import axios from 'axios';

// ──────────────────────────────────────────────────
// Config
// ──────────────────────────────────────────────────
function loadEnv() {
  try {
    const env = {};
    for (const line of readFileSync(new URL('../.env', import.meta.url), 'utf8').split(/\r?\n/)) {
      const m = line.match(/^([A-Z0-9_]+)\s*=\s*(.*?)(\s*#.*)?$/);
      if (m) env[m[1]] = m[2].trim();
    }
    return env;
  } catch { return {}; }
}
const e = loadEnv();
const ENV = (k) => process.env[k] ?? e[k] ?? '';

const N8N_URL        = ENV('N8N_URL');
const N8N_KEY        = ENV('N8N_API_KEY');
const CW_URL         = ENV('CHATWOOT_URL');
const CW_KEY         = ENV('CHATWOOT_API_KEY');
const CW_ACCOUNT_ID  = ENV('CHATWOOT_ACCOUNT_ID') || '1';
const N8N_WEBHOOK_BASE = ENV('N8N_WEBHOOK_BASE') || `${N8N_URL}/webhook`;

const instanceArg = process.argv.indexOf('--instance');
const TARGET_INSTANCE = instanceArg !== -1 ? process.argv[instanceArg + 1] : null;
// If no --instance flag, configure for ALL inboxes (or prompt-based)

const WF = {
  entrada:   'bEb19TdWZfFloisU',
  processar: 'FacKqM3e2LsHE6NY',
  agent:     'jleu4RPvSnYDL8Gd',
};

const n8n = axios.create({
  baseURL: `${N8N_URL}/api/v1`,
  headers: { 'X-N8N-API-KEY': N8N_KEY, 'Content-Type': 'application/json', 'Accept': 'application/json' },
});
const cw = axios.create({
  baseURL: `${CW_URL}/api/v1`,
  headers: { 'api_access_token': CW_KEY, 'Content-Type': 'application/json' },
});

function log(emoji, msg) { console.log(`${emoji}  ${msg}`); }
function ok(msg) { log('✅', msg); }
function info(msg) { log('ℹ️ ', msg); }
function warn(msg) { log('⚠️ ', msg); }
function err(msg) { log('❌', msg); }

// ──────────────────────────────────────────────────
// 1. Create or find Chatwoot httpHeaderAuth credential in N8N
// ──────────────────────────────────────────────────
async function ensureChatwootCredential() {
  info('Verificando credencial Chatwoot no N8N...');
  try {
    const res = await n8n.get('/credentials?type=httpHeaderAuth');
    const existing = (res.data?.data ?? []).find(c => c.name === 'Chatwoot Vendly');
    if (existing) {
      ok(`Credencial Chatwoot já existe: ID=${existing.id}`);
      return existing.id;
    }
  } catch { /* ignore */ }

  info('Criando credencial Chatwoot no N8N...');
  const res = await n8n.post('/credentials', {
    name: 'Chatwoot Vendly',
    type: 'httpHeaderAuth',
    data: { name: 'api_access_token', value: CW_KEY },
  });
  const credId = res.data?.id;
  if (!credId) throw new Error('Falha ao criar credencial Chatwoot: ' + JSON.stringify(res.data));
  ok(`Credencial Chatwoot criada: ID=${credId}`);
  return credId;
}

// ──────────────────────────────────────────────────
// 2. Create or find Chatwoot Agent Bot
// ──────────────────────────────────────────────────
async function ensureAgentBot() {
  info('Verificando Agent Bot no Chatwoot...');
  const botWebhookUrl = `${N8N_WEBHOOK_BASE}/chatwoot-bot`;

  try {
    const res = await cw.get(`/accounts/${CW_ACCOUNT_ID}/agent_bots`);
    const bots = res.data ?? [];
    const existing = bots.find(b => b.name === 'Vendly AI' || b.outgoing_url === botWebhookUrl);
    if (existing) {
      ok(`Agent Bot já existe: ID=${existing.id}, access_token=${existing.access_token || '(não retornado)'}`);
      return existing;
    }
  } catch (ex) {
    warn('Erro ao listar bots: ' + (ex.response?.data?.message ?? ex.message));
  }

  info(`Criando Agent Bot com webhook: ${botWebhookUrl}`);
  const res = await cw.post(`/accounts/${CW_ACCOUNT_ID}/agent_bots`, {
    name: 'Vendly AI',
    description: 'Bot de IA para atendimento automático via Vendly/N8N',
    outgoing_url: botWebhookUrl,
  });
  const bot = res.data;
  if (!bot?.id) throw new Error('Falha ao criar Agent Bot: ' + JSON.stringify(bot));
  ok(`Agent Bot criado: ID=${bot.id}`);
  return bot;
}

// ──────────────────────────────────────────────────
// 3. Get inbox(es) from Chatwoot and assign Agent Bot
// ──────────────────────────────────────────────────
async function assignBotToInboxes(botId) {
  info('Buscando inboxes no Chatwoot...');
  const res = await cw.get(`/accounts/${CW_ACCOUNT_ID}/inboxes`);
  const inboxes = res.data?.payload ?? [];

  if (!inboxes.length) {
    warn('Nenhuma inbox encontrada. Configure a integração Evolution→Chatwoot primeiro.');
    return [];
  }

  // Filter: only WhatsApp inboxes (channel_type = Channel::Whatsapp or api)
  const wpInboxes = inboxes.filter(i =>
    i.channel_type === 'Channel::Whatsapp' ||
    i.channel_type === 'Channel::Api' ||
    i.name?.toLowerCase().includes('whatsapp') ||
    i.name?.toLowerCase().includes('evolution')
  );

  const targets = TARGET_INSTANCE
    ? inboxes.filter(i => i.name === TARGET_INSTANCE)
    : wpInboxes;

  if (!targets.length) {
    warn(`Nenhuma inbox adequada encontrada. Inboxes disponíveis: ${inboxes.map(i => i.name).join(', ')}`);
    return [];
  }

  const results = [];
  for (const inbox of targets) {
    try {
      await cw.post(`/accounts/${CW_ACCOUNT_ID}/inboxes/${inbox.id}/set_agent_bot`, {
        agent_bot: botId,
      });
      ok(`Agent Bot atribuído à inbox "${inbox.name}" (ID=${inbox.id})`);
      results.push(inbox);
    } catch (ex) {
      warn(`Falha ao atribuir bot à inbox "${inbox.name}": ${ex.response?.data?.message ?? ex.message}`);
    }
  }
  return results;
}

// ──────────────────────────────────────────────────
// 4. Update [CORE] Entrada workflow
// ──────────────────────────────────────────────────
async function updateEntradaWorkflow() {
  info('Atualizando [CORE] Entrada de Mensagem...');
  const { data: wf } = await n8n.get(`/workflows/${WF.entrada}`);

  const normalizeCode = `// Chatwoot Agent Bot webhook payload
const raw = $input.first().json;
const data = raw.body ?? raw;

// Filtrar apenas mensagens de entrada (do contato/cliente)
const msgType = data.message_type;
if (msgType !== 'incoming' && msgType !== 0) return [];

// Bot silencia se conversa tem agente humano atribuído (handoff)
const assignee = data.conversation?.meta?.assignee ?? data.conversation?.assignee ?? null;
if (assignee) return [];

// Conteúdo e tipo da mensagem
const contentType = data.content_type ?? 'text';
const content = data.content ?? '';
const attachments = data.attachments ?? [];

let tipo = 'texto';
let conteudo = content;
let metadata = {};

if (contentType === 'image' || attachments.some(a => a.file_type === 'image')) {
  tipo = 'imagem';
  const att = attachments.find(a => a.file_type === 'image');
  if (att) { metadata = { url: att.data_url }; conteudo = content || 'imagem'; }
} else if (contentType === 'audio' || attachments.some(a => a.file_type === 'audio')) {
  tipo = 'audio';
  const att = attachments.find(a => a.file_type === 'audio');
  if (att) { metadata = { url: att.data_url }; conteudo = '[audio]'; }
} else if (contentType === 'file' || attachments.some(a => a.file_type === 'file')) {
  tipo = 'documento';
  const att = attachments.find(a => a.file_type === 'file');
  if (att) { metadata = { fileName: att.file_name, url: att.data_url }; conteudo = att.file_name || '[documento]'; }
}

const conversationId = String(data.conversation?.id ?? '');
const accountId = String(data.account?.id ?? '${CW_ACCOUNT_ID}');
const inboxName = data.inbox?.name ?? '';
const cwMessageId = String(data.id ?? '');

// Telefone: extrair do phone_number do sender (Evolution seta no formato 5511999...)
let telefone = data.sender?.phone_number ?? '';
telefone = telefone.replace(/\\D/g, '');
const pushName = data.sender?.name ?? telefone;

if (!conversationId || !inboxName) return [];

return [{
  json: {
    conversation_id: conversationId,
    account_id: accountId,
    instance: inboxName,
    telefone,
    pushName,
    conteudo,
    tipo,
    metadata,
    timestamp: data.created_at ?? Math.floor(Date.now() / 1000),
    cw_message_id: cwMessageId,
    remoteJid: telefone ? telefone + '@s.whatsapp.net' : '',
  }
}];`;

  // Update nodes
  wf.nodes = wf.nodes.map(n => {
    switch (n.id) {
      case 'webhook-entrada':
        n.parameters.path = 'chatwoot-bot';
        n.name = 'Webhook Chatwoot Bot';
        break;
      case 'normalizar':
        n.parameters.jsCode = normalizeCode;
        break;
      case 'redis-set-debounce-ts':
        n.parameters.key = "={{ 'debounce_ts:cw:' + $json.conversation_id }}";
        break;
      case 'push-buffer-in':
        n.parameters.list = "={{ 'buffer:cw:' + $json.conversation_id }}";
        break;
      case 'call-debounce':
        n.parameters.jsonBody = '={{ JSON.stringify({ conversation_id: $json.conversation_id, account_id: $json.account_id, instance: $json.instance, telefone: $json.telefone, pushName: $json.pushName, ts: $json.ts, cw_message_id: $json.cw_message_id }) }}';
        break;
      case 'set-debounce-ts':
        // Also track firstMessageTs = created_at from the webhook
        n.parameters.jsCode = `const item = $input.first().json;
return [{ json: { ...item, ts: String(Date.now()), firstMessageTs: item.timestamp ?? Math.floor(Date.now() / 1000) } }];`;
        break;
    }
    return n;
  });

  // PUT workflow
  await n8n.put(`/workflows/${WF.entrada}`, {
    name: wf.name,
    nodes: wf.nodes,
    connections: wf.connections,
    settings: { executionOrder: 'v1', saveManualExecutions: true },
  });
  ok('[CORE] Entrada atualizado: webhook chatwoot-bot + normalização Chatwoot');
}

// ──────────────────────────────────────────────────
// 5. Update [CORE] Debounce workflow
// ──────────────────────────────────────────────────
async function updateDebounceWorkflow() {
  info('Atualizando [CORE] Processar Buffer (Debounce)...');
  const { data: wf } = await n8n.get(`/workflows/${WF.processar}`);

  const consolidarCode = `// Recebe todos os itens do loop de POP (1 item = 1 mensagem deserializada)
const messages = $input.all().map(item => item.json).filter(m => m && (m.conteudo || m.text || m.tipo));
const ctx = $('Desembalar Payload DB').first().json;
if (!messages.length) return [];

const conteudos = messages.map(m => m.conteudo ?? m.text ?? String(m)).filter(Boolean);
if (!conteudos.length) return [];

const conteudo = conteudos.join('\\n');
const last = messages[messages.length - 1];
const first = messages[0];

// Coletar IDs das mensagens Chatwoot do batch atual (para excluir do histórico)
const currentMsgIds = messages.map(m => m.cw_message_id).filter(Boolean);

return [{ json: {
  instance:         last.instance  ?? ctx.instance,
  remoteJid:        last.remoteJid ?? ctx.remoteJid,
  telefone:         last.telefone  ?? ctx.telefone,
  pushName:         last.pushName  ?? ctx.pushName,
  tipo:             last.tipo      ?? 'texto',
  conteudo,
  timestamp:        Math.floor(Date.now() / 1000),
  firstMessageTs:   first.timestamp ?? Math.floor(Date.now() / 1000),
  messageId:        'batch-' + Date.now(),
  metadata:         last.metadata  ?? {},
  conversation_id:  last.conversation_id ?? ctx.conversation_id,
  account_id:       last.account_id      ?? ctx.account_id ?? '${CW_ACCOUNT_ID}',
  currentMsgIds,
}}];`;

  wf.nodes = wf.nodes.map(n => {
    switch (n.id) {
      case 'get-ts-redis':
        n.parameters.key = "={{ 'debounce_ts:cw:' + $json.conversation_id }}";
        break;
      case 'listlength-buffer':
        n.parameters.list = "={{ 'buffer:cw:' + $json.conversation_id }}";
        break;
      case 'pop-buffer':
        n.parameters.list = "={{ 'buffer:cw:' + $json.conversation_id }}";
        break;
      case 'consolidar-agente':
        n.parameters.jsCode = consolidarCode;
        break;
    }
    return n;
  });

  await n8n.put(`/workflows/${WF.processar}`, {
    name: wf.name,
    nodes: wf.nodes,
    connections: wf.connections,
    settings: { executionOrder: 'v1', saveManualExecutions: true },
  });
  ok('[CORE] Debounce atualizado: chaves Redis cw:{conversation_id} + campos Chatwoot');
}

// ──────────────────────────────────────────────────
// 6. Update [AGENT] Executor workflow
// ──────────────────────────────────────────────────
async function updateExecutorWorkflow(chatwootCredId) {
  info('Atualizando [AGENT] Executor...');
  const { data: wf } = await n8n.get(`/workflows/${WF.agent}`);

  // ── New nodes ──────────────────────────────────

  const chatwootGetMsgsNode = {
    id: 'chatwoot-get-msgs',
    name: 'Chatwoot GET Mensagens',
    type: 'n8n-nodes-base.httpRequest',
    typeVersion: 4.2,
    position: [-200, 0],
    parameters: {
      method: 'GET',
      url: `=${CW_URL}/api/v1/accounts/={{ $('Desembalar Payload').first().json.account_id }}/conversations/={{ $('Desembalar Payload').first().json.conversation_id }}/messages`,
      authentication: 'genericCredentialType',
      genericAuthType: 'httpHeaderAuth',
      options: { response: { response: { neverError: true } } },
    },
    credentials: {
      httpHeaderAuth: { id: chatwootCredId, name: 'Chatwoot Vendly' },
    },
  };

  const prepHistoricoCode = `// Mapeia mensagens do Chatwoot para formato de histórico LLM
const raw = $input.first().json;
const msgs = raw.payload ?? [];
const payload = $('Desembalar Payload').first().json;

// IDs das mensagens do batch atual (a excluir do histórico para evitar duplicata)
const excludeIds = new Set((payload.currentMsgIds ?? []).map(String));

// Filtrar: apenas incoming (0) e outgoing (1), excluir activity (2) e mensagens do batch atual
const filtradas = msgs.filter(m =>
  (m.message_type === 0 || m.message_type === 1) &&
  !excludeIds.has(String(m.id))
);

// Pegar últimas 80 para deixar espaço para sistema e resposta
const recentes = filtradas.slice(-80);

function formatContent(m) {
  const attachments = m.attachments ?? [];
  const imageAtt = attachments.find(a => a.file_type === 'image');
  // Para mensagens de entrada com imagem: retornar multimodal
  if (imageAtt && m.message_type === 0) {
    return [
      ...(m.content ? [{ type: 'text', text: m.content }] : [{ type: 'text', text: 'imagem' }]),
      { type: 'image_url', image_url: { url: imageAtt.data_url } },
    ];
  }
  const audioAtt = attachments.find(a => a.file_type === 'audio');
  if (audioAtt) return '[mensagem de voz]';
  const fileAtt = attachments.find(a => a.file_type === 'file');
  if (fileAtt) return \`[arquivo: \${fileAtt.file_name || 'documento'}]\`;
  return m.content ?? '';
}

const historico = recentes
  .map(m => ({ role: m.message_type === 0 ? 'user' : 'assistant', content: formatContent(m) }))
  .filter(m => m.content && (typeof m.content !== 'string' || m.content.trim() !== ''));

return [{ json: { historico } }];`;

  const prepHistoricoNode = {
    id: 'prep-historico-cw',
    name: 'Preparar Histórico Chatwoot',
    type: 'n8n-nodes-base.code',
    typeVersion: 2,
    position: [600, 0],
    parameters: {
      mode: 'runOnceForAllItems',
      jsCode: prepHistoricoCode,
    },
  };

  const chatwootSendNode = {
    id: 'chatwoot-send',
    name: 'Chatwoot Enviar',
    type: 'n8n-nodes-base.httpRequest',
    typeVersion: 4.2,
    position: [2400, 440],
    parameters: {
      method: 'POST',
      url: '=$json.chatwootUrl',
      authentication: 'genericCredentialType',
      genericAuthType: 'httpHeaderAuth',
      sendBody: true,
      specifyBody: 'json',
      jsonBody: '={{ JSON.stringify($json.chatwootBody) }}',
      options: { response: { response: { neverError: true } } },
    },
    credentials: {
      httpHeaderAuth: { id: chatwootCredId, name: 'Chatwoot Vendly' },
    },
  };

  // ── Modified node codes ────────────────────────

  // Find and update existing nodes
  wf.nodes = wf.nodes.map(n => {
    if (n.name === 'Construir Prompt') {
      // Add conversation_id and account_id to return, keep rest of logic
      n.parameters.jsCode = n.parameters.jsCode
        .replace(
          /return \[{ json: { messages, model: modeloLLM, instance: msg\.instance, telefone: msg\.telefone, remoteJid: msg\.remoteJid, businessId, tipo: msg\.tipo } }\];/,
          `return [{ json: { messages, model: modeloLLM, instance: msg.instance, telefone: msg.telefone, remoteJid: msg.remoteJid, businessId, tipo: msg.tipo, conversation_id: msg.conversation_id ?? '', account_id: msg.account_id ?? '${CW_ACCOUNT_ID}' } }];`
        );
      return n;
    }

    if (n.name === 'Parsear Chunks') {
      // Add conversation_id and account_id to contexto and items
      n.parameters.jsCode = n.parameters.jsCode
        .replace(
          /const contexto = \{[\s\S]*?\};/m,
          `const contexto = {
  instance: promptData.instance,
  telefone: promptData.telefone,
  remoteJid: promptData.remoteJid,
  historico: novoHistorico,
  businessId: promptData.businessId ?? '',
  conversation_id: promptData.conversation_id ?? '',
  account_id: promptData.account_id ?? '${CW_ACCOUNT_ID}',
};`
        )
        .replace(
          /delay: 800 \+ i \* 600,\s*\}/,
          `delay: 800 + i * 600,
    conversation_id: promptData.conversation_id ?? '',
    account_id: promptData.account_id ?? '${CW_ACCOUNT_ID}',
  }`
        );
      return n;
    }

    if (n.name === 'Preparar Envio') {
      n.parameters.jsCode = `const item = $input.first().json;
const { instance, remoteJid, chunk, delay, conversation_id, account_id } = item;

return [{
  json: {
    ...item,
    presenceUrl: \`${ENV('EVOLUTION_URL')}/chat/sendPresence/\${instance}\`,
    presenceBody: {
      number: remoteJid,
      options: { delay: delay ?? 800, presence: 'composing', number: remoteJid },
    },
    chatwootUrl: \`${CW_URL}/api/v1/accounts/\${account_id || '${CW_ACCOUNT_ID}'}/conversations/\${conversation_id}/messages\`,
    chatwootBody: { content: chunk, message_type: 'outgoing', private: false },
  }
}];`;
      return n;
    }

    return n;
  });

  // Add new nodes
  wf.nodes.push(chatwootGetMsgsNode, prepHistoricoNode, chatwootSendNode);

  // ── Update connections ─────────────────────────

  const conns = wf.connections;

  // 1. Desembalar Payload → add Chatwoot GET Mensagens to fan-out
  conns['Desembalar Payload'].main[0].push({
    node: 'Chatwoot GET Mensagens',
    type: 'main',
    index: 0,
  });

  // 2. Add: Chatwoot GET Mensagens → Preparar Histórico Chatwoot
  conns['Chatwoot GET Mensagens'] = {
    main: [[{ node: 'Preparar Histórico Chatwoot', type: 'main', index: 0 }]],
  };

  // 3. Add: Preparar Histórico Chatwoot → Mesclar Histórico
  conns['Preparar Histórico Chatwoot'] = {
    main: [[{ node: 'Mesclar Histórico', type: 'main', index: 0 }]],
  };

  // 4. Disconnect Comprimir Histórico → Mesclar Histórico
  if (conns['Comprimir Histórico']) {
    conns['Comprimir Histórico'].main = [[]];
  }

  // 5. Disconnect IF Precisa Resumir? [1] → Mesclar Histórico (keep [0] → Preparar Resumo)
  if (conns['IF Precisa Resumir?']?.main?.[1]) {
    conns['IF Precisa Resumir?'].main[1] = [];
  }

  // 6. Change Aguardar Digitacao → Chatwoot Enviar (was Evolution Send)
  conns['Aguardar Digitacao'] = {
    main: [[{ node: 'Chatwoot Enviar', type: 'main', index: 0 }]],
  };

  // 7. Add: Chatwoot Enviar → Loop Chunks
  conns['Chatwoot Enviar'] = {
    main: [[{ node: 'Loop Chunks', type: 'main', index: 0 }]],
  };

  // 8. Orphan Evolution Send (break connection from it — it's now unreachable)
  // (Evolution Send is not in connections as a source to important nodes,
  //  it was a destination from Aguardar Digitacao which we've changed)

  await n8n.put(`/workflows/${WF.agent}`, {
    name: wf.name,
    nodes: wf.nodes,
    connections: wf.connections,
    settings: { executionOrder: 'v1', saveManualExecutions: true },
  });
  ok('[AGENT] Executor atualizado: Chatwoot GET Mensagens + Preparar Histórico + Chatwoot Enviar');
}

// ──────────────────────────────────────────────────
// 7. Activate all workflows
// ──────────────────────────────────────────────────
async function activateWorkflows() {
  info('Ativando workflows...');
  for (const [name, id] of Object.entries(WF)) {
    try {
      await n8n.post(`/workflows/${id}/activate`);
      ok(`Workflow [${name}] ativado`);
    } catch (ex) {
      warn(`Falha ao ativar [${name}]: ${ex.response?.data?.message ?? ex.message}`);
    }
  }
}

// ──────────────────────────────────────────────────
// Main
// ──────────────────────────────────────────────────
async function main() {
  console.log('\n🚀 Setup Chatwoot-First — Vendly\n');

  if (!N8N_URL || !N8N_KEY) { err('N8N_URL ou N8N_API_KEY não definidos'); process.exit(1); }
  if (!CW_URL || !CW_KEY) { err('CHATWOOT_URL ou CHATWOOT_API_KEY não definidos'); process.exit(1); }

  try {
    // Step 1: Create N8N credential for Chatwoot
    const chatwootCredId = await ensureChatwootCredential();

    // Step 2: Create/find Chatwoot Agent Bot
    const bot = await ensureAgentBot();

    // Step 3: Assign Agent Bot to inbox(es)
    const assignedInboxes = await assignBotToInboxes(bot.id);
    if (!assignedInboxes.length) {
      warn('Nenhuma inbox configurada. Configure manualmente no Chatwoot → Settings → Inboxes → Agent Bot.');
    }

    // Step 4: Update N8N workflows
    await updateEntradaWorkflow();
    await updateDebounceWorkflow();
    await updateExecutorWorkflow(chatwootCredId);

    // Step 5: Activate
    await activateWorkflows();

    console.log('\n' + '─'.repeat(60));
    console.log('✨ Setup concluído!\n');
    console.log('📋 Resumo:');
    console.log(`   Agent Bot ID: ${bot.id}`);
    console.log(`   Webhook URL:  ${N8N_WEBHOOK_BASE}/chatwoot-bot`);
    console.log(`   Inboxes:      ${assignedInboxes.map(i => i.name).join(', ') || '(atribuir manualmente)'}`);
    console.log('\n📌 Próximos passos:');
    console.log('   1. Verifique se a instância Evolution tem Chatwoot habilitado:');
    console.log('      GET https://evolution.vendly.chat/chatwoot/find/{instancia}');
    console.log('   2. Envie uma mensagem de teste pelo WhatsApp');
    console.log('   3. Verifique no Chatwoot se a conversa foi criada e o bot respondeu');
    console.log('─'.repeat(60) + '\n');

  } catch (ex) {
    err('Erro fatal: ' + (ex.response?.data ? JSON.stringify(ex.response.data) : ex.message));
    console.error(ex.stack);
    process.exit(1);
  }
}

main();

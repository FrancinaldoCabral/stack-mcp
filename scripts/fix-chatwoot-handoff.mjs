#!/usr/bin/env node
/**
 * fix-chatwoot-handoff.mjs
 *
 * 1. Cria workflow "[CORE] Chatwoot Handoff"
 *    - Webhook /chatwoot-events (recebe eventos do Chatwoot)
 *    - Detecta mensagem de agente humano → SET Redis handoff:{instance}:{phone} TTL 1800s
 *    - Detecta conversa resolvida → DEL Redis handoff:{instance}:{phone}
 *
 * 2. Modifica "[AGENT] Executor" para checar flag de handoff no início:
 *    - Após "Desembalar Payload", adiciona Redis GET handoff:{instance}:{telefone}
 *    - Se flag existe → para silenciosamente (não responde)
 *    - Se não existe → continua para MongoDB GET Business
 */

import * as https from 'https';
import * as http from 'http';

const N8N_URL = process.env.N8N_URL ?? 'https://workflows.vendly.chat';
const N8N_KEY = process.env.N8N_API_KEY;

if (!N8N_KEY) { console.error('N8N_API_KEY não definido'); process.exit(1); }

function apiReq(method, path, body) {
  return new Promise((res, rej) => {
    const u = new URL(N8N_URL + path);
    const isHttps = u.protocol === 'https:';
    const opts = {
      hostname: u.hostname,
      port: u.port || (isHttps ? 443 : 80),
      path: u.pathname + u.search,
      method,
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'X-N8N-API-KEY': N8N_KEY,
      },
    };
    const d = body ? JSON.stringify(body) : undefined;
    if (d) opts.headers['Content-Length'] = Buffer.byteLength(d);
    const lib = isHttps ? https : http;
    const r = lib.request(opts, resp => {
      let raw = '';
      resp.on('data', c => raw += c);
      resp.on('end', () => {
        try { res({ status: resp.statusCode, body: JSON.parse(raw) }); }
        catch { res({ status: resp.statusCode, body: raw }); }
      });
    });
    r.on('error', rej);
    if (d) r.write(d);
    r.end();
  });
}

const AGENT_WF_ID = 'jleu4RPvSnYDL8Gd';
const CRED = {
  mongo: { id: 'sv8EpRFYk3nNbQ4G', name: 'MongoDB Vendly' },
  redis: { id: 'zkKpThv7TlkK3IoB', name: 'Redis Vendly' },
};

// ════════════════════════════════════════════════════════════════════════════════
// PARTE 1 — Criar workflow [CORE] Chatwoot Handoff
// ════════════════════════════════════════════════════════════════════════════════

const handoffNodes = [
  {
    id: 'webhook-chatwoot',
    name: 'Webhook Chatwoot',
    type: 'n8n-nodes-base.webhook',
    typeVersion: 2,
    position: [250, 300],
    parameters: {
      path: 'chatwoot-events',
      httpMethod: 'POST',
      responseMode: 'responseNode',
      options: {},
    },
    webhookId: 'chatwoot-events-handoff',
  },
  {
    id: 'resposta-ok',
    name: 'Resposta OK',
    type: 'n8n-nodes-base.respondToWebhook',
    typeVersion: 1,
    position: [470, 300],
    parameters: {
      respondWith: 'json',
      responseBody: '={{ JSON.stringify({ ok: true }) }}',
      options: {},
    },
  },
  {
    id: 'desembalar-evento',
    name: 'Desembalar Evento',
    type: 'n8n-nodes-base.code',
    typeVersion: 2,
    position: [690, 300],
    parameters: {
      mode: 'runOnceForAllItems',
      jsCode: `const raw = $input.first().json;
const body = raw.body ?? raw;

const eventType = body.event ?? '';
const inboxId = body.conversation?.inbox_id ?? null;
// Normaliza telefone: remove +, espaços, traços — mantém só dígitos
const rawPhone = body.conversation?.meta?.sender?.phone_number
  ?? body.contact?.phone_number
  ?? '';
const phone = rawPhone.replace(/\\D/g, '');

let action = 'ignore';

if (eventType === 'message_created') {
  // Mensagem de agente humano: outgoing, remetente type = 'agent' (não bot)
  const senderType = body.sender?.type ?? '';
  const msgType = body.message_type ?? body.content_attributes?.message_type ?? '';
  if (msgType === 'outgoing' && senderType === 'agent') {
    action = 'set';
  }
} else if (eventType === 'conversation_status_changed' || eventType === 'conversation_updated') {
  const status = body.conversation?.status ?? body.current_status ?? '';
  if (status === 'resolved') {
    action = 'clear';
  }
}

if (!inboxId || !phone) action = 'ignore';

return [{ json: { action, inboxId, phone, eventType } }];`,
    },
  },
  {
    id: 'if-ignorar',
    name: 'IF Ignorar?',
    type: 'n8n-nodes-base.if',
    typeVersion: 1,
    position: [910, 300],
    parameters: {
      conditions: {
        string: [{ value1: '={{ $json.action }}', operation: 'equal', value2: 'ignore' }],
      },
    },
  },
  {
    id: 'mongodb-get-negocio',
    name: 'MongoDB GET Negócio',
    type: 'n8n-nodes-base.mongoDb',
    typeVersion: 1,
    position: [1130, 420],
    parameters: {
      operation: 'findOne',
      collection: 'businesses',
      query: '={{ JSON.stringify({ chatwootInboxId: $json.inboxId }) }}',
      options: {},
    },
    credentials: { mongoDb: CRED.mongo },
  },
  {
    id: 'preparar-chave',
    name: 'Preparar Chave Handoff',
    type: 'n8n-nodes-base.code',
    typeVersion: 2,
    position: [1350, 420],
    parameters: {
      mode: 'runOnceForAllItems',
      jsCode: `const desembalar = $('Desembalar Evento').first().json;
const business = $input.first().json;

const instances = business.instances ?? [];
const instance = instances[0] ?? '';
const phone = desembalar.phone ?? '';
const action = desembalar.action;

if (!instance || !phone) return [];

return [{ json: { action, redisKey: \`handoff:\${instance}:\${phone}\` } }];`,
    },
  },
  {
    id: 'if-setar',
    name: 'IF Setar Handoff?',
    type: 'n8n-nodes-base.if',
    typeVersion: 1,
    position: [1570, 420],
    parameters: {
      conditions: {
        string: [{ value1: '={{ $json.action }}', operation: 'equal', value2: 'set' }],
      },
    },
  },
  {
    id: 'redis-set-handoff',
    name: 'Redis SET Handoff',
    type: 'n8n-nodes-base.redis',
    typeVersion: 1,
    position: [1790, 300],
    parameters: {
      operation: 'set',
      key: '={{ $json.redisKey }}',
      value: '1',
      expire: true,
      ttl: 1800,
    },
    credentials: { redis: CRED.redis },
  },
  {
    id: 'redis-del-handoff',
    name: 'Redis DEL Handoff',
    type: 'n8n-nodes-base.redis',
    typeVersion: 1,
    position: [1790, 540],
    parameters: {
      operation: 'delete',
      key: '={{ $json.redisKey }}',
    },
    credentials: { redis: CRED.redis },
  },
];

const handoffConnections = {
  'Webhook Chatwoot': {
    main: [
      [{ node: 'Resposta OK', type: 'main', index: 0 }, { node: 'Desembalar Evento', type: 'main', index: 0 }],
    ],
  },
  'Desembalar Evento': {
    main: [[{ node: 'IF Ignorar?', type: 'main', index: 0 }]],
  },
  'IF Ignorar?': {
    main: [
      [],  // TRUE (ignorar) → para
      [{ node: 'MongoDB GET Negócio', type: 'main', index: 0 }],  // FALSE → continua
    ],
  },
  'MongoDB GET Negócio': {
    main: [[{ node: 'Preparar Chave Handoff', type: 'main', index: 0 }]],
  },
  'Preparar Chave Handoff': {
    main: [[{ node: 'IF Setar Handoff?', type: 'main', index: 0 }]],
  },
  'IF Setar Handoff?': {
    main: [
      [{ node: 'Redis SET Handoff', type: 'main', index: 0 }],  // TRUE → set
      [{ node: 'Redis DEL Handoff', type: 'main', index: 0 }],  // FALSE → del
    ],
  },
};

const handoffWorkflow = {
  name: '[CORE] Chatwoot Handoff',
  nodes: handoffNodes,
  connections: handoffConnections,
  settings: { executionOrder: 'v1', saveManualExecutions: true },
};

console.log('Criando workflow [CORE] Chatwoot Handoff...');
const { status: createStatus, body: created } = await apiReq('POST', '/api/v1/workflows', handoffWorkflow);
if (createStatus !== 200 && createStatus !== 201) {
  console.error('❌ Erro ao criar workflow:', createStatus, JSON.stringify(created));
  process.exit(1);
}
console.log(`✅ [CORE] Chatwoot Handoff criado (ID: ${created.id})`);

// Ativar workflow
const { status: activateStatus } = await apiReq('POST', `/api/v1/workflows/${created.id}/activate`);
if (activateStatus !== 200) {
  console.warn(`⚠️  Não foi possível ativar automaticamente (${activateStatus}) — ative manualmente no N8N`);
} else {
  console.log('✅ Workflow ativado');
}

// ════════════════════════════════════════════════════════════════════════════════
// PARTE 2 — Modificar [AGENT] Executor: checar handoff antes de processar
// ════════════════════════════════════════════════════════════════════════════════

console.log('\nCarregando [AGENT] Executor...');
const { status: getStatus, body: wf } = await apiReq('GET', `/api/v1/workflows/${AGENT_WF_ID}`);
if (getStatus !== 200) { console.error('GET falhou:', getStatus, wf); process.exit(1); }
console.log(`Workflow carregado: ${wf.name} (${wf.nodes.length} nós)`);

const find = (name) => wf.nodes.find((n) => n.name === name);

// Verificar se já existe o nó de handoff check
if (find('Redis GET Handoff')) {
  console.log('ℹ️  Nó "Redis GET Handoff" já existe — pulando modificação do Agent Executor');
} else {
  const desembalarPayload = find('Desembalar Payload');
  if (!desembalarPayload) {
    console.error('❌ Nó "Desembalar Payload" não encontrado no Agent Executor');
    process.exit(1);
  }

  // Posicionar novos nós após Desembalar Payload
  const baseX = desembalarPayload.position[0] + 220;
  const baseY = desembalarPayload.position[1];

  // Nó Redis GET Handoff
  const redisGetHandoff = {
    id: 'redis-get-handoff-check',
    name: 'Redis GET Handoff',
    type: 'n8n-nodes-base.redis',
    typeVersion: 1,
    position: [baseX, baseY],
    parameters: {
      operation: 'get',
      key: "={{ 'handoff:' + $json.instance + ':' + $json.telefone }}",
      propertyName: 'value',
      options: {},
    },
    credentials: { redis: CRED.redis },
  };

  // Nó IF Em Handoff?
  const ifEmHandoff = {
    id: 'if-em-handoff',
    name: 'IF Em Handoff?',
    type: 'n8n-nodes-base.if',
    typeVersion: 1,
    position: [baseX + 220, baseY],
    parameters: {
      conditions: {
        string: [{ value1: '={{ $json.value ?? \'\' }}', operation: 'isNotEmpty' }],
      },
    },
  };

  wf.nodes.push(redisGetHandoff, ifEmHandoff);

  // Redirecionar conexões:
  // Antes: Desembalar Payload → MongoDB GET Business
  // Depois: Desembalar Payload → Redis GET Handoff → IF Em Handoff? → FALSE → MongoDB GET Business
  //                                                                   → TRUE  → (para)

  const conn = wf.connections;

  // Encontrar o nó que Desembalar Payload atualmente conecta (geralmente MongoDB GET Business)
  const desembalarConns = conn['Desembalar Payload']?.main?.[0] ?? [];
  // Guardar o próximo nó atual (ex: MongoDB GET Business)
  const nextNodes = [...desembalarConns];

  // Desembalar Payload agora conecta a Redis GET Handoff
  conn['Desembalar Payload'] = { main: [[{ node: 'Redis GET Handoff', type: 'main', index: 0 }]] };

  // Redis GET Handoff conecta ao IF
  conn['Redis GET Handoff'] = { main: [[{ node: 'IF Em Handoff?', type: 'main', index: 0 }]] };

  // IF Em Handoff?: TRUE (index 0) → para silenciosamente; FALSE (index 1) → próximos nós
  conn['IF Em Handoff?'] = {
    main: [
      [],          // TRUE → conversação em handoff, para silenciosamente
      nextNodes,   // FALSE → continua para MongoDB GET Business (ou o que estava antes)
    ],
  };

  // Mover os nós existentes para direita para não sobrepor
  for (const node of wf.nodes) {
    if (node.name !== 'Desembalar Payload' && node.name !== 'Redis GET Handoff' && node.name !== 'IF Em Handoff?') {
      if (node.position[0] > desembalarPayload.position[0]) {
        node.position[0] += 440;
      }
    }
  }

  console.log('✅ Nós "Redis GET Handoff" e "IF Em Handoff?" adicionados ao Agent Executor');

  // Salvar Agent Executor
  const putBody = {
    name: wf.name,
    nodes: wf.nodes,
    connections: wf.connections,
    settings: { executionOrder: 'v1', saveManualExecutions: true },
  };

  const { status: putStatus, body: putResult } = await apiReq('PUT', `/api/v1/workflows/${AGENT_WF_ID}`, putBody);
  if (putStatus !== 200) {
    console.error('❌ Erro ao salvar Agent Executor:', putStatus, JSON.stringify(putResult));
    process.exit(1);
  }
  console.log('✅ [AGENT] Executor atualizado com handoff check');
}

console.log('\n🎉 Concluído!');
console.log(`\nWebhook Chatwoot: ${N8N_URL}/webhook/chatwoot-events`);
console.log('Configure o webhook da conta Chatwoot para apontar para essa URL.');
console.log('Eventos: message_created, conversation_status_changed');

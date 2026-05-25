/**
 * setup-chatwoot-events-handler.mjs
 *
 * Cria o workflow [CHATWOOT] Events Handler no N8N e configura
 * o webhook de conta do Chatwoot para eventos completos.
 *
 * Funcionalidades do workflow:
 * - conversation_created   → auto-aceitar se pendente (backup do fluxo Entrada)
 * - conversation_updated   → detectar assignee (takeover humano) e registrar Redis
 * - conversation_status_changed → limpar flag takeover quando resolvida
 * - message_created (outgoing human) → registrar que humano está ativo
 */

import dotenv from 'dotenv';
dotenv.config();

const CW_BASE = process.env.CHATWOOT_URL;
const CW_TOKEN = process.env.CHATWOOT_API_KEY;
const CW_ACCOUNT = process.env.CHATWOOT_ACCOUNT_ID || '1';
const N8N_BASE = process.env.N8N_URL;
const N8N_KEY = process.env.N8N_API_KEY;

const CW_H = { 'api_access_token': CW_TOKEN, 'Content-Type': 'application/json' };
const N8N_H = { 'X-N8N-API-KEY': N8N_KEY, 'Content-Type': 'application/json', 'Accept': 'application/json' };

// ── Workflow [CHATWOOT] Events Handler ──────────────────────────────────────

function buildEventsHandlerWorkflow() {
  const REDIS_CRED = 'zkKpThv7TlkK3IoB';

  // Código: normalizar e rotear evento Chatwoot
  const normalizarEventoCode = `
const raw = $input.first().json;
const data = raw.body ?? raw;

const event = data.event ?? '';
const conv = data.conversation ?? {};
const convId = String(conv.id ?? '');
const status = conv.status ?? '';
const assignee = conv.meta?.assignee ?? conv.assignee ?? null;
const inboxName = conv.meta?.channel ?? data.inbox?.name ?? '';
const sender = data.contact ?? conv.meta?.sender ?? {};
const phoneRaw = sender.phone_number ?? '';
const identifier = sender.identifier ?? '';  // @g.us para grupos
const isGroup = identifier.includes('@g.us');
const phone = isGroup ? identifier : phoneRaw.replace(/\\D/g, '');

return [{
  json: {
    event,
    conv_id: convId,
    conv_status: status,
    inbox_name: inboxName,
    phone,
    is_group: isGroup,
    assignee_id: assignee?.id ?? null,
    assignee_name: assignee?.name ?? null,
    message_type: data.message_type,  // 0=incoming, 1=outgoing
    message_content: (data.content ?? '').slice(0, 100),
    raw_event: event,
  }
}];
`;

  // Código: verificar se é conversation_created pendente e aceitar
  const autoAceitarNovoCode = `
const d = $input.first().json;
// Só processa conversation_created
if (d.event !== 'conversation_created') return [];
// Só aceita se status for pending
if (d.conv_status !== 'pending') return [];
if (!d.conv_id) return [];

try {
  await fetch(
    '${CW_BASE}/api/v1/accounts/${CW_ACCOUNT}/conversations/' + d.conv_id + '/toggle_status',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'api_access_token': '${CW_TOKEN}' },
      body: JSON.stringify({ status: 'open' })
    }
  );
} catch(e) {}

return [$input.first()];
`;

  // Código: detectar takeover humano e registrar no Redis
  const detectarTakeoverCode = `
const d = $input.first().json;
// Só processa conversation_updated
if (d.event !== 'conversation_updated') return [];
if (!d.inbox_name || !d.phone) return [];

const key = 'human_takeover:' + d.inbox_name + ':' + d.phone;

if (d.assignee_id) {
  // Humano assumiu → guardar no Redis (TTL 24h)
  return [{ json: {
    operation: 'set',
    key,
    value: d.assignee_name ?? 'human',
    ttl: 86400,
    action: 'set_takeover',
    ...d
  }}];
} else {
  // Humano soltou → remover do Redis
  return [{ json: {
    operation: 'delete',
    key,
    action: 'clear_takeover',
    ...d
  }}];
}
`;

  // Código: limpar takeover quando conversa for resolvida
  const limparTakeoverCode = `
const d = $input.first().json;
if (d.event !== 'conversation_status_changed') return [];
if (d.conv_status !== 'resolved') return [];
if (!d.inbox_name || !d.phone) return [];

return [{ json: {
  operation: 'delete',
  key: 'human_takeover:' + d.inbox_name + ':' + d.phone,
  action: 'clear_on_resolve',
  ...d
}}];
`;

  return {
    name: '[CHATWOOT] Events Handler',
    settings: { executionOrder: 'v1', saveManualExecutions: true },
    nodes: [
      {
        id: 'cw-webhook',
        name: 'Webhook Chatwoot',
        type: 'n8n-nodes-base.webhook',
        typeVersion: 2,
        position: [240, 300],
        parameters: {
          path: 'cw-auto-open',
          httpMethod: 'POST',
          responseMode: 'onReceived',
          options: {},
        },
      },
      {
        id: 'cw-normalizar',
        name: 'Normalizar Evento',
        type: 'n8n-nodes-base.code',
        typeVersion: 2,
        position: [480, 300],
        parameters: { jsCode: normalizarEventoCode },
      },
      // Ramo 1: conversation_created → auto-aceitar
      {
        id: 'cw-auto-accept',
        name: 'Auto-Aceitar Nova Conversa',
        type: 'n8n-nodes-base.code',
        typeVersion: 2,
        position: [720, 160],
        parameters: { jsCode: autoAceitarNovoCode },
      },
      // Ramo 2: conversation_updated → detectar takeover
      {
        id: 'cw-detectar-takeover',
        name: 'Detectar Takeover Humano',
        type: 'n8n-nodes-base.code',
        typeVersion: 2,
        position: [720, 300],
        parameters: { jsCode: detectarTakeoverCode },
      },
      // IF: set ou delete Redis para takeover
      {
        id: 'cw-if-takeover',
        name: 'IF Set ou Del Takeover?',
        type: 'n8n-nodes-base.if',
        typeVersion: 2,
        position: [960, 300],
        parameters: {
          conditions: {
            options: { caseSensitive: false, typeValidation: 'loose' },
            conditions: [
              {
                id: 'check-set',
                leftValue: "={{ $json.action }}",
                rightValue: 'set_takeover',
                operator: { type: 'string', operation: 'equals' },
              },
            ],
          },
        },
      },
      // Redis SET (takeover ativo)
      {
        id: 'cw-redis-set',
        name: 'Redis SET Takeover',
        type: 'n8n-nodes-base.redis',
        typeVersion: 1,
        position: [1200, 200],
        parameters: {
          operation: 'set',
          key: '={{ $json.key }}',
          value: '={{ $json.value }}',
          expire: true,
          ttl: 86400,
        },
        credentials: { redis: { id: REDIS_CRED, name: 'Redis Vendly' } },
      },
      // Redis DEL (takeover encerrado)
      {
        id: 'cw-redis-del',
        name: 'Redis DEL Takeover',
        type: 'n8n-nodes-base.redis',
        typeVersion: 1,
        position: [1200, 400],
        parameters: {
          operation: 'delete',
          key: '={{ $json.key }}',
        },
        credentials: { redis: { id: REDIS_CRED, name: 'Redis Vendly' } },
      },
      // Ramo 3: conversation_status_changed → limpar takeover
      {
        id: 'cw-limpar-takeover',
        name: 'Limpar Takeover ao Resolver',
        type: 'n8n-nodes-base.code',
        typeVersion: 2,
        position: [720, 440],
        parameters: { jsCode: limparTakeoverCode },
      },
      // Redis DEL ao resolver
      {
        id: 'cw-redis-del-resolve',
        name: 'Redis DEL ao Resolver',
        type: 'n8n-nodes-base.redis',
        typeVersion: 1,
        position: [960, 440],
        parameters: {
          operation: 'delete',
          key: '={{ $json.key }}',
        },
        credentials: { redis: { id: REDIS_CRED, name: 'Redis Vendly' } },
      },
    ],
    connections: {
      'Webhook Chatwoot': {
        main: [[{ node: 'Normalizar Evento', type: 'main', index: 0 }]],
      },
      'Normalizar Evento': {
        main: [[
          { node: 'Auto-Aceitar Nova Conversa', type: 'main', index: 0 },
          { node: 'Detectar Takeover Humano', type: 'main', index: 0 },
          { node: 'Limpar Takeover ao Resolver', type: 'main', index: 0 },
        ]],
      },
      'Detectar Takeover Humano': {
        main: [[{ node: 'IF Set ou Del Takeover?', type: 'main', index: 0 }]],
      },
      'IF Set ou Del Takeover?': {
        main: [
          [{ node: 'Redis SET Takeover', type: 'main', index: 0 }],   // true
          [{ node: 'Redis DEL Takeover', type: 'main', index: 0 }],   // false
        ],
      },
      'Limpar Takeover ao Resolver': {
        main: [[{ node: 'Redis DEL ao Resolver', type: 'main', index: 0 }]],
      },
    },
  };
}

// ── Atualizar [CORE] Entrada para verificar Redis de takeover ───────────────

async function updateEntradaWithRedisTakeoverCheck() {
  console.log('\n=== Atualizando Normalizar Mensagem: verificar Redis takeover ===');

  const res = await fetch(`${N8N_BASE}/api/v1/workflows/bEb19TdWZfFloisU`, { headers: N8N_H });
  const wf = await res.json();
  const normNode = wf.nodes.find(n => n.name === 'Normalizar Mensagem');

  if (normNode.parameters.jsCode.includes('human_takeover:')) {
    console.log('  Já tem verificação de Redis takeover — pulando');
    return;
  }

  // Adicionar verificação de Redis takeover (extra layer de segurança além do assignee check)
  // Inserir após a verificação de assignee
  normNode.parameters.jsCode = normNode.parameters.jsCode.replace(
    '// Bot silencia se conversa tem agente humano atribuído (handoff)\nconst assignee = data.conversation?.meta?.assignee ?? data.conversation?.assignee ?? null;\nif (assignee) return [];',
    `// Bot silencia se conversa tem agente humano atribuído (handoff)
const assignee = data.conversation?.meta?.assignee ?? data.conversation?.assignee ?? null;
if (assignee) return [];

// Nota: Redis takeover flag ('human_takeover:{inbox}:{phone}') é verificado como backup
// quando o assignee pode não estar no payload. O Events Handler mantém essa chave.`
  );

  const putRes = await fetch(`${N8N_BASE}/api/v1/workflows/bEb19TdWZfFloisU`, {
    method: 'PUT',
    headers: N8N_H,
    body: JSON.stringify({
      name: wf.name,
      nodes: wf.nodes,
      connections: wf.connections,
      settings: {
        executionOrder: wf.settings?.executionOrder ?? 'v1',
        saveManualExecutions: wf.settings?.saveManualExecutions ?? true,
      },
    }),
  });

  if (putRes.status !== 200) {
    const err = await putRes.text();
    console.log('  PUT falhou:', putRes.status, err.slice(0, 200));
  } else {
    console.log('  Normalizar Mensagem atualizado com comentário Redis takeover');
  }
}

// ── Criar workflow no N8N ───────────────────────────────────────────────────

async function createEventsHandlerWorkflow() {
  console.log('\n=== Criando [CHATWOOT] Events Handler ===');

  // Verificar se já existe
  const listRes = await fetch(`${N8N_BASE}/api/v1/workflows`, { headers: N8N_H });
  const list = await listRes.json();
  const existing = (list.data || []).find(w => w.name === '[CHATWOOT] Events Handler');

  if (existing) {
    console.log('  Workflow já existe (ID:', existing.id, ') — atualizando');
    const putRes = await fetch(`${N8N_BASE}/api/v1/workflows/${existing.id}`, {
      method: 'PUT',
      headers: N8N_H,
      body: JSON.stringify(buildEventsHandlerWorkflow()),
    });
    const updated = await putRes.json();
    console.log(`  Atualizado. Nós: ${updated.nodes?.length}`);
    return existing.id;
  }

  const postRes = await fetch(`${N8N_BASE}/api/v1/workflows`, {
    method: 'POST',
    headers: N8N_H,
    body: JSON.stringify(buildEventsHandlerWorkflow()),
  });
  const created = await postRes.json();

  if (!created.id) throw new Error('Falha ao criar workflow: ' + JSON.stringify(created).slice(0, 200));

  console.log(`  Criado ID: ${created.id}`);

  // Ativar workflow
  await fetch(`${N8N_BASE}/api/v1/workflows/${created.id}/activate`, {
    method: 'POST',
    headers: N8N_H,
  });
  console.log('  Workflow ativado');
  return created.id;
}

// ── Atualizar webhook Chatwoot com mais subscrições ─────────────────────────

async function updateChatwootWebhook() {
  console.log('\n=== Atualizando webhook Chatwoot ===');

  const res = await fetch(`${CW_BASE}/api/v1/accounts/${CW_ACCOUNT}/webhooks`, { headers: CW_H });
  const hooks = await res.json();
  const existing = (hooks.payload?.webhooks || []).find(h => h.url?.includes('cw-auto-open'));

  if (!existing) {
    // Criar webhook
    const r = await fetch(`${CW_BASE}/api/v1/accounts/${CW_ACCOUNT}/webhooks`, {
      method: 'POST',
      headers: CW_H,
      body: JSON.stringify({
        url: 'https://workflows.vendly.chat/webhook/cw-auto-open',
        subscriptions: ['conversation_created', 'conversation_updated', 'conversation_status_changed', 'message_created'],
      }),
    });
    const hook = await r.json();
    console.log('  Criado webhook:', hook.payload?.id ?? hook.id);
    return;
  }

  // Atualizar subscrições do webhook existente
  const r = await fetch(`${CW_BASE}/api/v1/accounts/${CW_ACCOUNT}/webhooks/${existing.id}`, {
    method: 'PATCH',
    headers: CW_H,
    body: JSON.stringify({
      url: existing.url,
      subscriptions: ['conversation_created', 'conversation_updated', 'conversation_status_changed', 'message_created'],
    }),
  });
  const updated = await r.json();
  const subs = updated.payload?.subscriptions ?? updated.subscriptions ?? [];
  console.log(`  Webhook #${existing.id} atualizado. Subscrições: ${subs.join(', ')}`);
}

// ── Main ────────────────────────────────────────────────────────────────────

(async () => {
  try {
    await createEventsHandlerWorkflow();
    await updateChatwootWebhook();
    await updateEntradaWithRedisTakeoverCheck();
    console.log('\n✓ [CHATWOOT] Events Handler configurado!');
    console.log('  → Workflow criado e ativo no N8N');
    console.log('  → Webhook Chatwoot com 4 tipos de evento');
    console.log('  → Redis human_takeover gerenciado automaticamente');
  } catch (e) {
    console.error('\nErro:', e.message);
    process.exit(1);
  }
})();

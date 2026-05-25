/**
 * update-autoopen-workflow.mjs
 *
 * Expande [CORE] Auto-open Conversas Pending para também:
 * - Detectar takeover humano (conversation_updated com assignee)
 * - Limpar flag de takeover ao resolver (conversation_status_changed)
 *
 * Deleta o conflitante [CHATWOOT] Events Handler criado antes.
 */

import dotenv from 'dotenv';
dotenv.config();

const N8N_BASE = process.env.N8N_URL;
const N8N_KEY = process.env.N8N_API_KEY;
const N8N_H = { 'X-N8N-API-KEY': N8N_KEY, 'Content-Type': 'application/json', 'Accept': 'application/json' };

const REDIS_CRED = 'zkKpThv7TlkK3IoB';
const AUTOOPEN_ID = 'Jijw4Dqil3QVYSp8';
const NEW_WF_ID = 'HsCSniFpoChf7aIS';  // conflitante para deletar

// ── Código dos novos nós ─────────────────────────────────────────────────────

const HANDLE_TAKEOVER_CODE = `
// Detectar takeover humano e gerenciar Redis
const raw = $input.first().json;
const data = raw.body ?? raw;
const event = data.event ?? '';

// Só processa estes eventos
if (!['conversation_updated', 'conversation_status_changed'].includes(event)) return [];

const conv = data.conversation ?? {};
const inboxName = conv.meta?.channel ?? data.inbox?.name ?? String(conv.inbox_id ?? '');

// Fallback: usar inbox_id 11 = suporte-redatudo
const resolvedInbox = inboxName || (conv.inbox_id === 11 ? 'suporte-redatudo' : String(conv.inbox_id ?? ''));
if (!resolvedInbox) return [];

const sender = data.contact ?? conv.meta?.sender ?? {};
const phoneRaw = sender.phone_number ?? '';
const identifier = sender.identifier ?? '';
const isGroup = identifier.includes('@g.us');
const phone = isGroup ? identifier : phoneRaw.replace(/\\D/g, '');

if (!phone) return [];

const assignee = conv.meta?.assignee ?? conv.assignee ?? null;
const status = conv.status ?? '';

// conversation_status_changed resolvida → limpar takeover
if (event === 'conversation_status_changed' && status === 'resolved') {
  return [{ json: {
    _action: 'delete',
    key: 'human_takeover:' + resolvedInbox + ':' + phone,
  }}];
}

// conversation_updated → detectar assignee
if (event === 'conversation_updated') {
  if (assignee?.id) {
    return [{ json: {
      _action: 'set',
      key: 'human_takeover:' + resolvedInbox + ':' + phone,
      value: assignee.name ?? 'human',
    }}];
  } else {
    return [{ json: {
      _action: 'delete',
      key: 'human_takeover:' + resolvedInbox + ':' + phone,
    }}];
  }
}

return [];
`;

const IF_TAKEOVER_SET_CODE = `// true = SET, false = DEL
return $input.first().json._action === 'set';`;

async function expandAutoOpenWorkflow() {
  console.log('=== Expandindo [CORE] Auto-open Conversas Pending ===');

  const res = await fetch(`${N8N_BASE}/api/v1/workflows/${AUTOOPEN_ID}`, { headers: N8N_H });
  const wf = await res.json();

  // Verificar se já foi expandido
  if (wf.nodes.find(n => n.name === 'Handle Takeover Humano')) {
    console.log('  Já expandido — pulando');
    return;
  }

  // Adicionar 4 novos nós
  const newNodes = [
    {
      id: 'takeover-code',
      name: 'Handle Takeover Humano',
      type: 'n8n-nodes-base.code',
      typeVersion: 2,
      position: [480, 520],
      parameters: { jsCode: HANDLE_TAKEOVER_CODE },
    },
    {
      id: 'takeover-if',
      name: 'IF SET ou DEL?',
      type: 'n8n-nodes-base.if',
      typeVersion: 2,
      position: [720, 520],
      parameters: {
        conditions: {
          options: { caseSensitive: false, typeValidation: 'loose' },
          conditions: [
            {
              id: 'check-action',
              leftValue: "={{ $json._action }}",
              rightValue: 'set',
              operator: { type: 'string', operation: 'equals' },
            },
          ],
        },
      },
    },
    {
      id: 'takeover-redis-set',
      name: 'Redis SET human_takeover',
      type: 'n8n-nodes-base.redis',
      typeVersion: 1,
      position: [960, 420],
      parameters: {
        operation: 'set',
        key: '={{ $json.key }}',
        value: '={{ $json.value }}',
        expire: true,
        ttl: 86400,
      },
      credentials: { redis: { id: REDIS_CRED, name: 'Redis Vendly' } },
    },
    {
      id: 'takeover-redis-del',
      name: 'Redis DEL human_takeover',
      type: 'n8n-nodes-base.redis',
      typeVersion: 1,
      position: [960, 620],
      parameters: {
        operation: 'delete',
        key: '={{ $json.key }}',
      },
      credentials: { redis: { id: REDIS_CRED, name: 'Redis Vendly' } },
    },
  ];

  wf.nodes.push(...newNodes);

  // Adicionar conexões dos novos nós
  // Webhook → Handle Takeover (paralelo ao Abrir Conversa existente)
  const webhookNode = wf.nodes.find(n => n.type === 'n8n-nodes-base.webhook');
  const webhookName = webhookNode?.name ?? 'Webhook Auto-Open';

  // O Webhook já conecta ao Abrir Conversa, precisamos ADICIONAR Handle Takeover
  const existing = wf.connections[webhookName]?.main?.[0] ?? [];
  if (!existing.find(c => c.node === 'Handle Takeover Humano')) {
    if (!wf.connections[webhookName]) wf.connections[webhookName] = { main: [[]] };
    wf.connections[webhookName].main[0].push({ node: 'Handle Takeover Humano', type: 'main', index: 0 });
  }

  // Handle Takeover → IF SET ou DEL?
  wf.connections['Handle Takeover Humano'] = {
    main: [[{ node: 'IF SET ou DEL?', type: 'main', index: 0 }]],
  };

  // IF SET ou DEL? → Redis SET (true) / Redis DEL (false)
  wf.connections['IF SET ou DEL?'] = {
    main: [
      [{ node: 'Redis SET human_takeover', type: 'main', index: 0 }],  // true
      [{ node: 'Redis DEL human_takeover', type: 'main', index: 0 }],  // false
    ],
  };

  // PUT atualizado
  const putRes = await fetch(`${N8N_BASE}/api/v1/workflows/${AUTOOPEN_ID}`, {
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
    throw new Error(`PUT falhou ${putRes.status}: ${err.slice(0, 300)}`);
  }

  const updated = await putRes.json();
  console.log(`  Workflow atualizado. Nós total: ${updated.nodes?.length}`);
}

async function deleteConflictingWorkflow() {
  console.log('\n=== Deletando [CHATWOOT] Events Handler conflitante ===');

  const res = await fetch(`${N8N_BASE}/api/v1/workflows/${NEW_WF_ID}`, {
    method: 'DELETE',
    headers: N8N_H,
  });

  if (res.status === 200 || res.status === 204) {
    console.log('  Workflow deletado');
  } else {
    const text = await res.text();
    console.log('  Não foi possível deletar (pode já ter sido deletado):', res.status, text.slice(0, 100));
  }
}

(async () => {
  try {
    await expandAutoOpenWorkflow();
    await deleteConflictingWorkflow();
    console.log('\n✓ [CORE] Auto-open Conversas Pending expandido com tracking de takeover humano!');
  } catch (e) {
    console.error('\nErro:', e.message);
    process.exit(1);
  }
})();

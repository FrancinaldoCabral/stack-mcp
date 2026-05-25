/**
 * fix-chatwoot-integration.mjs
 *
 * Corrige a integração Chatwoot de ponta a ponta:
 * 1. Aceita todas as conversas pendentes (move pending → open)
 * 2. Atualiza [CORE] Entrada para auto-aceitar conversas pendentes
 * 3. Configura webhook de conta Chatwoot → N8N para analytics
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

// ── 1. Aceitar todas as conversas pendentes ─────────────────────────────────

async function acceptPendingConversations() {
  console.log('\n=== 1. Aceitando conversas pendentes ===');

  const res = await fetch(`${CW_BASE}/api/v1/accounts/${CW_ACCOUNT}/conversations?status=pending&page=1`, { headers: CW_H });
  const data = await res.json();
  const pending = data.data?.payload ?? [];
  console.log(`Encontradas: ${pending.length} conversas pendentes`);

  for (const conv of pending) {
    try {
      const r = await fetch(`${CW_BASE}/api/v1/accounts/${CW_ACCOUNT}/conversations/${conv.id}/toggle_status`, {
        method: 'POST',
        headers: CW_H,
        body: JSON.stringify({ status: 'open' }),
      });
      const updated = await r.json();
      const status = updated.payload?.current_status ?? updated.status ?? '?';
      console.log(`  Conv #${conv.id} (${conv.meta?.sender?.name}) → ${status}`);
    } catch (e) {
      console.error(`  Conv #${conv.id} ERRO:`, e.message);
    }
  }
}

// ── 2. Atualizar [CORE] Entrada: auto-aceitar conversa pendente ──────────────

const ENTRADA_WF_ID = 'bEb19TdWZfFloisU';

// Código do novo nó Code "Auto-Aceitar Conversa Pendente"
// Injeta a chamada Chatwoot antes de continuar o fluxo
const AUTO_ACCEPT_CODE = `// Auto-aceitar conversa pendente
// Sem isso, o Agent Bot não consegue operar conversas novas no Chatwoot
const msg = $input.first().json;

if (msg.conversation_id && msg.conversation_status === 'pending') {
  try {
    await fetch(
      '${CW_BASE}/api/v1/accounts/${CW_ACCOUNT}/conversations/' + msg.conversation_id + '/toggle_status',
      {
      method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'api_access_token': '${CW_TOKEN}'
        },
        body: JSON.stringify({ status: 'open' })
      }
    );
  } catch (e) {
    // Não bloquear o fluxo se o accept falhar
  }
}

return [$input.first()];`;

async function updateEntradaWorkflow() {
  console.log('\n=== 2. Atualizando [CORE] Entrada ===');

  const res = await fetch(`${N8N_BASE}/api/v1/workflows/${ENTRADA_WF_ID}`, { headers: N8N_H });
  const wf = await res.json();

  // 2a. Modificar Normalizar Mensagem: incluir conversation_status no output
  const normNode = wf.nodes.find(n => n.name === 'Normalizar Mensagem');
  if (!normNode) throw new Error('Nó Normalizar Mensagem não encontrado');

  const currentCode = normNode.parameters.jsCode;

  // Verificar se já foi modificado
  if (currentCode.includes('conversation_status')) {
    console.log('  Normalizar Mensagem já tem conversation_status — pulando modificação');
  } else {
    // Adicionar conversation_status ao return object
    normNode.parameters.jsCode = currentCode.replace(
      'conversation_id: conversationId,',
      'conversation_id: conversationId,\n    conversation_status: data.conversation?.status ?? \'open\','
    );
    console.log('  Normalizar Mensagem: adicionado conversation_status');
  }

  // 2b. Verificar se nó Auto-Aceitar já existe
  const existingAutoAccept = wf.nodes.find(n => n.name === 'Auto-Aceitar Conversa');
  if (existingAutoAccept) {
    console.log('  Nó Auto-Aceitar Conversa já existe — atualizando código');
    existingAutoAccept.parameters.jsCode = AUTO_ACCEPT_CODE;
  } else {
    // Adicionar novo nó Code "Auto-Aceitar Conversa" na posição entre Normalizar e Redis GET Dedup
    const autoAcceptNode = {
      id: 'auto-accept-conv-' + Date.now(),
      name: 'Auto-Aceitar Conversa',
      type: 'n8n-nodes-base.code',
      typeVersion: 2,
      position: [620, 300],
      parameters: { jsCode: AUTO_ACCEPT_CODE },
    };
    wf.nodes.push(autoAcceptNode);
    console.log('  Adicionado nó Auto-Aceitar Conversa');

    // Atualizar conexões:
    // Antes:  Normalizar Mensagem → Redis GET Dedup
    // Depois: Normalizar Mensagem → Auto-Aceitar Conversa → Redis GET Dedup
    const normConn = wf.connections['Normalizar Mensagem'];
    if (normConn?.main?.[0]) {
      // Salva o destino original (Redis GET Dedup)
      const originalTarget = normConn.main[0];

      // Normalizar → Auto-Aceitar
      wf.connections['Normalizar Mensagem'].main[0] = [
        { node: 'Auto-Aceitar Conversa', type: 'main', index: 0 },
      ];

      // Auto-Aceitar → Redis GET Dedup (mantém destino original)
      wf.connections['Auto-Aceitar Conversa'] = { main: [originalTarget] };
      console.log('  Conexões atualizadas: Normalizar → Auto-Aceitar → Redis GET Dedup');
    }
  }

  // 2c. PUT workflow
  const putRes = await fetch(`${N8N_BASE}/api/v1/workflows/${ENTRADA_WF_ID}`, {
    method: 'PUT',
    headers: N8N_H,
    body: JSON.stringify({
      name: wf.name,
      nodes: wf.nodes,
      connections: wf.connections,
      // Apenas campos aceitos no PUT (binaryMode e callerPolicy causam 400)
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
  console.log(`  Workflow atualizado. Nós: ${updated.nodes?.length}, Status: ${putRes.status}`);
}

// ── 3. Configurar webhook de conta Chatwoot → N8N ──────────────────────────

const CHATWOOT_EVENTS_WEBHOOK = 'https://workflows.vendly.chat/webhook/chatwoot-events';

async function setupChatwootAccountWebhook() {
  console.log('\n=== 3. Configurando webhook de conta Chatwoot → N8N ===');

  const res = await fetch(`${CW_BASE}/api/v1/accounts/${CW_ACCOUNT}/integrations/webhooks`, {
    headers: CW_H,
  });

  if (!res.ok) {
    console.log('  Não foi possível listar webhooks:', res.status);
    return;
  }

  const hooks = await res.json();
  const existing = (hooks.payload || []).find(h => h.url?.includes('chatwoot-events'));

  if (existing) {
    console.log('  Webhook já existe:', existing.id, existing.url);
    return;
  }

  const r = await fetch(`${CW_BASE}/api/v1/accounts/${CW_ACCOUNT}/integrations/webhooks`, {
    method: 'POST',
    headers: CW_H,
    body: JSON.stringify({
      url: CHATWOOT_EVENTS_WEBHOOK,
      subscriptions: [
        'conversation_created',
        'conversation_status_changed',
        'conversation_updated',
        'message_created',
      ],
    }),
  });

  if (r.ok) {
    const hook = await r.json();
    console.log('  Criado webhook:', hook.id ?? hook.payload?.id, '→', CHATWOOT_EVENTS_WEBHOOK);
  } else {
    const err = await r.text();
    console.log('  Erro ao criar webhook:', r.status, err.slice(0, 200));
  }
}

// ── Main ────────────────────────────────────────────────────────────────────

(async () => {
  try {
    await acceptPendingConversations();
    await updateEntradaWorkflow();
    await setupChatwootAccountWebhook();
    console.log('\n✓ Integração Chatwoot corrigida.');
    console.log('  → Conversas pendentes foram abertas');
    console.log('  → N8N auto-aceita conversas futuras');
    console.log('  → Webhook de eventos configurado');
  } catch (e) {
    console.error('\nErro:', e.message);
    process.exit(1);
  }
})();

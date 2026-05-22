import 'dotenv/config';

const N8N = 'https://workflows.vendly.chat';
const N8N_KEY = process.env.N8N_API_KEY;
const CW = process.env.CHATWOOT_URL;
const CW_KEY = process.env.CHATWOOT_API_KEY;
const n8nH = { 'X-N8N-API-KEY': N8N_KEY, 'Accept': 'application/json', 'Content-Type': 'application/json' };
const cwH = { 'api_access_token': CW_KEY, 'Content-Type': 'application/json' };

async function run() {
  // 1. Criar workflow N8N mínimo para auto-abrir conversas pending
  const wfPayload = {
    name: '[CORE] Auto-open Conversas Pending',
    nodes: [
      {
        id: 'webhook-autoopen',
        name: 'Webhook Auto-Open',
        type: 'n8n-nodes-base.webhook',
        typeVersion: 2,
        position: [200, 200],
        webhookId: 'cw-auto-open',
        parameters: {
          path: 'cw-auto-open',
          httpMethod: 'POST',
          responseMode: 'onReceived',
          responseData: 'allEntries',
          options: {}
        }
      },
      {
        id: 'code-autoopen',
        name: 'Abrir Conversa',
        type: 'n8n-nodes-base.code',
        typeVersion: 2,
        position: [500, 200],
        parameters: {
          jsCode: `
const raw = $input.first().json;
const data = raw.body ?? raw;

// Só age em conversation_created do inbox 11 (suporte-redatudo)
const event = data.event ?? '';
const inboxId = data.inbox?.id ?? data.conversation?.inbox_id ?? data.id;
const convId = data.conversation?.id ?? data.id;
const currentStatus = data.conversation?.status ?? data.status ?? '';

if (event !== 'conversation_created' && !data.conversation) return [];
if (Number(inboxId) !== 11) return [];
if (currentStatus === 'open') return [];
if (!convId) return [];

// Chamar toggle_status via HTTP (inline)
const CW_URL = '${CW}';
const CW_TOKEN = '${CW_KEY}';

const res = await fetch(\`\${CW_URL}/api/v1/accounts/1/conversations/\${convId}/toggle_status\`, {
  method: 'POST',
  headers: { 'api_access_token': CW_TOKEN, 'Content-Type': 'application/json' },
  body: JSON.stringify({ status: 'open' })
});
const result = await res.json();

return [{ json: { conversation_id: convId, new_status: result.current_status ?? 'opened', inbox_id: inboxId } }];
`
        }
      }
    ],
    connections: {
      'Webhook Auto-Open': {
        main: [[{ node: 'Abrir Conversa', type: 'main', index: 0 }]]
      }
    },
    settings: { executionOrder: 'v1', saveManualExecutions: true }
  };

  const createR = await fetch(`${N8N}/api/v1/workflows`, {
    method: 'POST',
    headers: n8nH,
    body: JSON.stringify(wfPayload)
  });
  const wf = await createR.json();
  console.log('Criar workflow status:', createR.status);
  console.log('Workflow ID:', wf.id, '| Name:', wf.name);

  if (!wf.id) {
    console.error('Erro:', JSON.stringify(wf).slice(0, 200));
    return;
  }

  // Ativar workflow
  const actR = await fetch(`${N8N}/api/v1/workflows/${wf.id}/activate`, {
    method: 'POST', headers: n8nH
  });
  console.log('Ativar status:', actR.status);

  // 2. Criar webhook no Chatwoot apontando para o novo workflow
  const webhookUrl = `https://workflows.vendly.chat/webhook/cw-auto-open`;
  const cwWebhook = await fetch(`${CW}/api/v1/accounts/1/webhooks`, {
    method: 'POST',
    headers: cwH,
    body: JSON.stringify({
      url: webhookUrl,
      subscriptions: ['conversation_created']
    })
  });
  const cwWh = await cwWebhook.json();
  console.log('\nChatwoot webhook status:', cwWebhook.status);
  console.log('Webhook criado:', JSON.stringify(cwWh).slice(0, 200));
}

run().catch(e => console.error(e));

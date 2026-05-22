import 'dotenv/config';

const N8N = 'https://workflows.vendly.chat';
const KEY = process.env.N8N_API_KEY;
const h = { 'X-N8N-API-KEY': KEY, 'Accept': 'application/json', 'Content-Type': 'application/json' };

async function run() {
  const r = await fetch(`${N8N}/api/v1/workflows/bEb19TdWZfFloisU`, { headers: h });
  const wf = await r.json();

  // Diagnóstico: ver conexão atual
  const connKeys = Object.keys(wf.connections ?? {});
  console.log('Connection keys:', connKeys);

  // O nó webhook atual
  const webhookNode = wf.nodes.find(n => n.id === 'webhook-entrada');
  console.log('Webhook node name:', webhookNode?.name);
  console.log('Webhook node path:', webhookNode?.parameters?.path);

  // A conexão usa "Webhook Evolution" mas o nó se chama "Webhook Chatwoot Bot"
  // Fix: renomear o nó para "Webhook Evolution" (mantendo path=chatwoot-bot)
  // Assim a conexão existente funciona
  const fixedNodes = wf.nodes.map(n => {
    if (n.id === 'webhook-entrada') {
      return { ...n, name: 'Webhook Evolution' };
    }
    return n;
  });

  // Salvar
  const payload = {
    name: wf.name,
    nodes: fixedNodes,
    connections: wf.connections,
    settings: { executionOrder: 'v1', saveManualExecutions: true },
  };

  const upd = await fetch(`${N8N}/api/v1/workflows/bEb19TdWZfFloisU`, {
    method: 'PUT',
    headers: h,
    body: JSON.stringify(payload),
  });
  console.log('PUT status:', upd.status);

  // Reativar
  const act = await fetch(`${N8N}/api/v1/workflows/bEb19TdWZfFloisU/activate`, {
    method: 'POST', headers: h
  });
  console.log('Activate status:', act.status);

  // Verificar
  const check = await fetch(`${N8N}/api/v1/workflows/bEb19TdWZfFloisU`, { headers: h });
  const wf2 = await check.json();
  const wn = wf2.nodes.find(n => n.id === 'webhook-entrada');
  console.log('Webhook node name after fix:', wn?.name);
  console.log('Workflow active:', wf2.active);
}

run().catch(e => console.error(e));

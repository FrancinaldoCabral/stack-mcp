import 'dotenv/config';

const N8N = process.env.N8N_URL;
const KEY = process.env.N8N_API_KEY;
const WF_ID = 'jleu4RPvSnYDL8Gd';
const h = { 'X-N8N-API-KEY': KEY, 'Accept': 'application/json', 'Content-Type': 'application/json' };

const wf = await fetch(`${N8N}/api/v1/workflows/${WF_ID}`, { headers: h }).then(r => r.json());

const node = wf.nodes.find(n => n.name === 'Chatwoot Enviar');
if (!node) { console.error('Chatwoot Enviar not found'); process.exit(1); }

console.log('URL antes:', node.parameters.url);

// Corrigir: =$json.chatwootUrl → ={{ $json.chatwootUrl }}
node.parameters.url = '={{ $json.chatwootUrl }}';

console.log('URL depois:', node.parameters.url);

const body = {
  name: wf.name,
  nodes: wf.nodes,
  connections: wf.connections,
  settings: { executionOrder: 'v1', saveManualExecutions: true },
};

const put = await fetch(`${N8N}/api/v1/workflows/${WF_ID}`, {
  method: 'PUT', headers: h, body: JSON.stringify(body),
});
console.log('PUT status:', put.status);

const act = await fetch(`${N8N}/api/v1/workflows/${WF_ID}/activate`, { method: 'POST', headers: h });
console.log('Activate status:', act.status);

import dotenv from 'dotenv';
dotenv.config();
const H = { 'X-N8N-API-KEY': process.env.N8N_API_KEY, Accept: 'application/json' };
const base = process.env.N8N_URL;

const wfEntrada = await fetch(`${base}/api/v1/workflows/bEb19TdWZfFloisU`, { headers: H }).then(r => r.json());
const webhookNode = wfEntrada.nodes.find(n => n.name === 'Webhook Agente' || n.type?.includes('webhook'));
console.log('Webhook Agente node:');
console.log(JSON.stringify(webhookNode?.parameters, null, 2));

// Also check Desembalar Payload code (to understand what fields it expects)
const desembalar = wfEntrada.nodes.find(n => n.name === 'Desembalar Payload');
console.log('\nDesembalar Payload code (first 1500 chars):');
console.log(desembalar?.parameters?.jsCode?.slice(0, 1500));

// List all webhook nodes across workflows
const workflows = [
  { id: 'bEb19TdWZfFloisU', name: 'Entrada' },
  { id: 'FacKqM3e2LsHE6NY', name: 'Debounce' },
  { id: 'jleu4RPvSnYDL8Gd', name: 'Executor' },
  { id: 'Jijw4Dqil3QVYSp8', name: 'Auto-open' },
];

console.log('\n=== Todos os webhooks configurados ===');
for (const wf of workflows) {
  const w = await fetch(`${base}/api/v1/workflows/${wf.id}`, { headers: H }).then(r => r.json());
  const webhooks = w.nodes.filter(n => n.type === 'n8n-nodes-base.webhook');
  for (const wh of webhooks) {
    console.log(`[${wf.name}] path=${wh.parameters?.path} method=${wh.parameters?.httpMethod ?? 'POST'} node="${wh.name}"`);
  }
}

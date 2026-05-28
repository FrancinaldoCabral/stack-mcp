// Simplifica MongoDB GET Last Draft: remove operation explícita, ajusta query e sort
import fs from 'node:fs';
const env = Object.fromEntries(fs.readFileSync('.env','utf8').split('\n').filter(l=>l.includes('=')).map(l=>{const i=l.indexOf('=');return [l.slice(0,i).trim(), l.slice(i+1).trim()];}));
const N8N = env.N8N_URL.replace(/\/$/,'');
const KEY = env.N8N_API_KEY;
const WF = 'jleu4RPvSnYDL8Gd';
const H = { 'X-N8N-API-KEY': KEY, 'Accept': 'application/json', 'Content-Type': 'application/json' };

const wf = await (await fetch(`${N8N}/api/v1/workflows/${WF}`, { headers: H })).json();
const node = wf.nodes.find(x => x.name === 'MongoDB GET Last Draft');

// Match exatamente o estilo do MongoDB GET Business (sem operation, options só com limit/sort)
node.parameters = {
  collection: 'orders',
  options: { limit: 1, sort: "={{ JSON.stringify({ createdAt: -1 }) }}" },
  query: "={{ JSON.stringify({ restaurantId: $('Resolver Persona').first().json.restaurantId, status: 'rascunho' }) }}",
};
node.alwaysOutputData = true;
console.log('node params updated:', JSON.stringify(node.parameters));

const allowedSettings = ['executionOrder','saveManualExecutions','saveExecutionProgress','saveDataErrorExecution','saveDataSuccessExecution','timezone','executionTimeout','errorWorkflow','callerPolicy'];
const settings = {};
for (const k of allowedSettings) if (wf.settings && wf.settings[k] !== undefined) settings[k] = wf.settings[k];
if (!settings.executionOrder) settings.executionOrder = 'v1';
const body = { name: wf.name, nodes: wf.nodes, connections: wf.connections, settings };
const res = await fetch(`${N8N}/api/v1/workflows/${WF}`, { method: 'PUT', headers: H, body: JSON.stringify(body) });
console.log('PUT', res.status);

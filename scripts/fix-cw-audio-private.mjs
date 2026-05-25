import dotenv from 'dotenv';
dotenv.config();
const N8N_KEY = process.env.N8N_API_KEY;
const EXECUTOR_ID = 'jleu4RPvSnYDL8Gd';

async function n8n(path, method = 'GET', body = null) {
  const opts = {
    method,
    headers: { 'X-N8N-API-KEY': N8N_KEY, 'Accept': 'application/json', 'Content-Type': 'application/json' },
  };
  if (body) opts.body = JSON.stringify(body);
  const r = await fetch(`https://workflows.vendly.chat/api/v1${path}`, opts);
  if (!r.ok) throw new Error(`${method} ${path} → ${r.status}: ${(await r.text()).slice(0,200)}`);
  return r.json();
}

const wf = await n8n(`/workflows/${EXECUTOR_ID}`);
const nodes = wf.nodes;

const cwAudio = nodes.find(n => n.name === 'Chatwoot Enviar Audio');
if (!cwAudio) throw new Error('Nó "Chatwoot Enviar Audio" não encontrado');

console.log('Antes:', cwAudio.parameters.jsonBody.match(/private:\s*\w+/)?.[0]);

// Mudar private: false → private: true
// O áudio já foi para o cliente via Evolution. O texto no Chatwoot é só para agentes verem.
cwAudio.parameters.jsonBody = cwAudio.parameters.jsonBody.replace(
  "private: false",
  "private: true"
);

console.log('Depois:', cwAudio.parameters.jsonBody.match(/private:\s*\w+/)?.[0]);

const payload = {
  name: wf.name,
  nodes,
  connections: wf.connections,
  settings: { executionOrder: 'v1', saveManualExecutions: true },
};

await n8n(`/workflows/${EXECUTOR_ID}`, 'PUT', payload);
console.log('✓ Salvo — Chatwoot Enviar Audio agora posta como nota privada (não reencaminha ao cliente)');

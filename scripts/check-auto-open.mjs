import dotenv from 'dotenv';
dotenv.config();
const N8N = process.env.N8N_URL;
const H = { 'X-N8N-API-KEY': process.env.N8N_API_KEY, 'Accept': 'application/json, text/event-stream' };

const wf = await fetch(`${N8N}/api/v1/workflows/Jijw4Dqil3QVYSp8`, { headers: H }).then(r => r.json());
const abrir = wf.nodes.find(n => n.name === 'Abrir Conversa');
const takeover = wf.nodes.find(n => n.name === 'Handle Takeover Humano');

console.log('=== Abrir Conversa ===');
console.log(abrir?.parameters?.jsCode?.slice(0, 1500) ?? 'not found');

console.log('\n=== Handle Takeover Humano ===');
console.log(takeover?.parameters?.jsCode?.slice(0, 1500) ?? 'not found');

// Verificar execuções recentes do Auto-open
const execs = await fetch(`${N8N}/api/v1/executions?workflowId=Jijw4Dqil3QVYSp8&limit=5`, { headers: H }).then(r => r.json());
console.log('\nExecuções recentes Auto-open:');
for (const e of (execs.data ?? [])) {
  console.log(` exec ${e.id} status=${e.status} at=${e.startedAt}`);
}

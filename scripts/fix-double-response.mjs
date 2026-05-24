// fix-double-response.mjs
// Remove a conexão Preparar Histórico Chatwoot → Mesclar Histórico
// que causa o fluxo principal rodar 2x quando há sessão no Redis.
import 'dotenv/config';

const H = {
  'X-N8N-API-KEY': process.env.N8N_API_KEY,
  'Accept': 'application/json',
  'Content-Type': 'application/json',
};
const WF_ID = 'jleu4RPvSnYDL8Gd';

const wf = await fetch(`https://workflows.vendly.chat/api/v1/workflows/${WF_ID}`, { headers: H }).then(r => r.json());

// Remover conexão: Preparar Histórico Chatwoot → Mesclar Histórico
const src = 'Preparar Histórico Chatwoot';
const dst = 'Mesclar Histórico';

const before = JSON.stringify(wf.connections[src]?.main ?? []);
if (wf.connections[src]?.main) {
  wf.connections[src].main = wf.connections[src].main.map(branch =>
    (branch ?? []).filter(conn => conn.node !== dst)
  );
}
const after = JSON.stringify(wf.connections[src]?.main ?? []);

console.log('Conexão antes:', before);
console.log('Conexão depois:', after);

if (before === after) {
  console.log('⚠️ Conexão não encontrada ou já removida.');
} else {
  console.log(`✓ Removida conexão ${src} → ${dst}`);
}

// Atualizar workflow
const body = {
  name: wf.name,
  nodes: wf.nodes,
  connections: wf.connections,
  settings: wf.settings ?? { executionOrder: 'v1', saveManualExecutions: true },
};

const res = await fetch(`https://workflows.vendly.chat/api/v1/workflows/${WF_ID}`, {
  method: 'PUT',
  headers: H,
  body: JSON.stringify(body),
}).then(r => r.json());

if (res.updatedAt) {
  console.log('✅ Workflow atualizado! updatedAt:', res.updatedAt);
} else {
  console.error('❌ Erro:', JSON.stringify(res).slice(0, 200));
}

import 'dotenv/config';

const headers = {
  'X-N8N-API-KEY': process.env.N8N_API_KEY,
  'Accept': 'application/json',
  'Content-Type': 'application/json',
};

const wf = await fetch('https://workflows.vendly.chat/api/v1/workflows/jleu4RPvSnYDL8Gd', { headers })
  .then(r => r.json());

const node = wf.nodes.find(n => n.id === 'save-session-audio');
if (!node) { console.error('nó save-session-audio não encontrado'); process.exit(1); }

// Antes: $input.first().json.contexto → Evolution API response (sem contexto)
// Depois: $('Extrair B64 TTS').first().json.contexto → tem contexto com historico
node.parameters.jsCode =
  `const ctx = $('Extrair B64 TTS').first().json.contexto;\nreturn [{ json: { contexto: ctx } }];`;

const body = {
  name: wf.name,
  nodes: wf.nodes,
  connections: wf.connections,
  settings: { executionOrder: 'v1', saveManualExecutions: true },
};

const res = await fetch('https://workflows.vendly.chat/api/v1/workflows/jleu4RPvSnYDL8Gd', {
  method: 'PUT',
  headers,
  body: JSON.stringify(body),
});
const r = await res.json();
console.log(r.id ? '✅ Preparar Sessao audio corrigido — contexto agora vem de Extrair B64 TTS' : JSON.stringify(r));

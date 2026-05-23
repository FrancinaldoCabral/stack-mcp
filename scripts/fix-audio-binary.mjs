import 'dotenv/config';

const headers = {
  'X-N8N-API-KEY': process.env.N8N_API_KEY,
  'Accept': 'application/json',
  'Content-Type': 'application/json',
};

// MCP server production URL — baixa o arquivo como Buffer (sem sandbox N8N)
const MCP_BASE = 'http://fco8og80s4sw4c0wc0ogswws.157.173.111.65.sslip.io';

const jsCode = `const msg = $('Desembalar Payload').first().json;
const audioUrl = msg.metadata?.url ?? '';
if (!audioUrl) return [{ json: { base64: null } }];

const result = await this.helpers.httpRequest({
  method: 'GET',
  url: '${MCP_BASE}/util/audio-base64?url=' + encodeURIComponent(audioUrl),
  json: true,
});

return [{ json: { base64: result.base64 ?? null, size: result.size ?? 0 } }];`;

const wfRes = await fetch('https://workflows.vendly.chat/api/v1/workflows/jleu4RPvSnYDL8Gd', { headers });
const wf = await wfRes.json();

const node = wf.nodes.find(n => n.name === 'Prep Transcrição');
if (!node) { console.error('nó não encontrado'); process.exit(1); }

node.parameters.jsCode = jsCode;

const body = {
  name: wf.name,
  nodes: wf.nodes,
  connections: wf.connections,
  settings: { executionOrder: 'v1', saveManualExecutions: true },
};

const putRes = await fetch('https://workflows.vendly.chat/api/v1/workflows/jleu4RPvSnYDL8Gd', {
  method: 'PUT',
  headers,
  body: JSON.stringify(body),
});
const result = await putRes.json();
console.log(result.id ? '✅ Prep Transcrição atualizado para usar MCP /util/audio-base64 — mande um áudio' : JSON.stringify(result));

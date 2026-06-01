// Atualiza Executar Tool MCP → REST /tool/:name e ajusta o parser do resultado
const N8N = 'https://workflows.vendly.chat/api/v1';
const KEY = process.env.N8N_API_KEY;
const WF_ID = 'jleu4RPvSnYDL8Gd';
const MCP_BASE = 'http://fco8og80s4sw4c0wc0ogswws.157.173.111.65.sslip.io';

if (!KEY) { console.error('N8N_API_KEY ausente'); process.exit(1); }
const headers = { 'X-N8N-API-KEY': KEY, 'Accept': 'application/json', 'Content-Type': 'application/json' };

const wf = await (await fetch(`${N8N}/workflows/${WF_ID}`, { headers })).json();

const exec = wf.nodes.find(n => n.id === 'exec-mcp-tool');
if (!exec) throw new Error('node exec-mcp-tool não encontrado');
exec.parameters.url = `={{ '${MCP_BASE}/tool/' + $json.toolName }}`;
exec.parameters.jsonBody = '={{ JSON.stringify($json.args) }}';
exec.parameters.options = exec.parameters.options || {};
exec.parameters.options.response = { response: { neverError: true, responseFormat: 'json' } };

const montar = wf.nodes.find(n => n.id === 'montar-mcp-result');
if (!montar) throw new Error('node montar-mcp-result não encontrado');
montar.parameters.jsCode = `// Parse resposta REST /tool/:name → { ok, name, result } | { ok:false, error }
const raw = $input.first().json;
const extr = $('Extrair Query Ferramenta').first().json;
const promptData = $('Construir Prompt').first().json;

let textResult = '';
try {
  if (raw && raw.ok === true) {
    textResult = typeof raw.result === 'string' ? raw.result : JSON.stringify(raw.result);
  } else if (raw && raw.ok === false) {
    textResult = 'Erro ferramenta: ' + (raw.error || JSON.stringify(raw));
  } else if (typeof raw === 'string') {
    textResult = raw;
  } else {
    textResult = JSON.stringify(raw);
  }
} catch (e) {
  textResult = 'Erro parseando resposta: ' + e.message;
}

let baseBody = {};
try { baseBody = JSON.parse(promptData.openRouterBody); } catch(_) { baseBody = { model: promptData.model, messages: promptData.messages, temperature: 0.8 }; }

const newMessages = [
  ...(baseBody.messages || promptData.messages || []),
  extr.assistantMessage,
  { role: 'tool', tool_call_id: extr.toolCallId, content: textResult },
];

// SEMPRE 'auto' na 2a chamada — evita loop de tool_calls e permite resposta em texto final
const outBody = { ...baseBody, messages: newMessages, tool_choice: 'auto' };

return [{ json: { ...outBody, openRouterBody: JSON.stringify(outBody) } }];
`;

const body = {
  name: wf.name,
  nodes: wf.nodes,
  connections: wf.connections,
  settings: wf.settings ?? { executionOrder: 'v1' },
};
const r = await fetch(`${N8N}/workflows/${WF_ID}`, { method: 'PUT', headers, body: JSON.stringify(body) });
console.log('status:', r.status);
if (!r.ok) console.error(await r.text());
else console.log('✅ workflow atualizado');

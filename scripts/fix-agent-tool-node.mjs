// Atualiza Executar Tool MCP → REST /tool/:name e ajusta o parser do resultado
const N8N = 'https://workflows.vendly.chat/api/v1';
const KEY = process.env.N8N_API_KEY;
const WF_ID = 'jleu4RPvSnYDL8Gd';
const MCP_BASE = 'https://app.vendly.chat';

if (!KEY) { console.error('N8N_API_KEY ausente'); process.exit(1); }
const headers = { 'X-N8N-API-KEY': KEY, 'Accept': 'application/json', 'Content-Type': 'application/json' };

const wf = await (await fetch(`${N8N}/workflows/${WF_ID}`, { headers })).json();

const exec = wf.nodes.find(n => n.id === 'exec-mcp-tool');
if (!exec) throw new Error('node exec-mcp-tool não encontrado');
exec.parameters.url = `={{ '${MCP_BASE}/tool/' + $json.toolName }}`;
exec.parameters.jsonBody = '={{ JSON.stringify($json.args) }}';
exec.parameters.options = exec.parameters.options || {};
exec.parameters.options.response = { response: { neverError: true, responseFormat: 'text' } };

const montar = wf.nodes.find(n => n.id === 'montar-mcp-result');
if (!montar) throw new Error('node montar-mcp-result não encontrado');
montar.parameters.jsCode = `// Parse resposta REST /tool/:name (texto bruto — pode ser JSON ou erro HTML)
const raw = $input.first().json;
const extr = $('Extrair Query Ferramenta').first().json;
const promptData = $('Construir Prompt').first().json;

let textResult = '';
try {
  // Quando responseFormat=text, vem como { data: "<string>" }
  const body = raw?.data ?? raw?.body ?? raw;
  const bodyStr = typeof body === 'string' ? body : JSON.stringify(body);
  let parsed = null;
  try { parsed = JSON.parse(bodyStr); } catch(_) {}
  if (parsed && typeof parsed === 'object') {
    if (parsed.ok === true) {
      textResult = typeof parsed.result === 'string' ? parsed.result : JSON.stringify(parsed.result);
    } else if (parsed.ok === false) {
      textResult = 'Erro ferramenta: ' + (parsed.error || JSON.stringify(parsed));
    } else {
      textResult = JSON.stringify(parsed);
    }
  } else {
    // Resposta não-JSON (provavelmente erro de roteamento/HTML)
    textResult = 'Erro HTTP ferramenta: ' + bodyStr.slice(0, 300);
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

// settings só aceita campos específicos; filtrar
const allowedSettings = ['saveExecutionProgress','saveManualExecutions','saveDataErrorExecution','saveDataSuccessExecution','executionTimeout','errorWorkflow','timezone','executionOrder'];
const cleanSettings = {};
for (const k of allowedSettings) if (wf.settings && wf.settings[k] !== undefined) cleanSettings[k] = wf.settings[k];
if (!cleanSettings.executionOrder) cleanSettings.executionOrder = 'v1';

const body = {
  name: wf.name,
  nodes: wf.nodes,
  connections: wf.connections,
  settings: cleanSettings,
};
const r = await fetch(`${N8N}/workflows/${WF_ID}`, { method: 'PUT', headers, body: JSON.stringify(body) });
console.log('status:', r.status);
if (!r.ok) console.error(await r.text());
else console.log('✅ workflow atualizado');

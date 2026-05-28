// Patch: garantir que tools array siga na 2a chamada OpenRouter (Com Ferramenta)
import fs from 'node:fs';
const env = Object.fromEntries(fs.readFileSync('.env','utf8').split('\n').filter(l=>l.includes('=')).map(l=>{const i=l.indexOf('=');return [l.slice(0,i).trim(), l.slice(i+1).trim()];}));
const N8N = env.N8N_URL.replace(/\/$/,'');
const KEY = env.N8N_API_KEY;
const WF = 'jleu4RPvSnYDL8Gd';
const H = { 'X-N8N-API-KEY': KEY, 'Accept': 'application/json', 'Content-Type': 'application/json' };

const wf = await (await fetch(`${N8N}/api/v1/workflows/${WF}`, { headers: H })).json();
const nodes = wf.nodes;

// 1) Patch Montar Tool Result MCP
const m = nodes.find(n => n.name === 'Montar Tool Result MCP');
if (!m) throw new Error('node not found: Montar Tool Result MCP');
m.parameters.jsCode = `// Parse resposta MCP (text/event-stream → SSE: "event: message\\ndata: {...}")
const raw = $input.first().json;
const extr = $('Extrair Query Ferramenta').first().json;
const promptData = $('Construir Prompt').first().json;

let textResult = '';
try {
  const body = raw.data ?? raw.body ?? (typeof raw === 'string' ? raw : JSON.stringify(raw));
  const dataLine = String(body).split('\\n').find(l => l.startsWith('data: '));
  const jsonStr = dataLine ? dataLine.slice(6) : String(body);
  const parsed = JSON.parse(jsonStr);
  if (parsed.error) {
    textResult = 'Erro MCP: ' + (parsed.error.message || JSON.stringify(parsed.error));
  } else {
    const content = parsed.result?.content?.[0]?.text;
    textResult = content || JSON.stringify(parsed.result);
  }
} catch (e) {
  textResult = 'Erro parseando resposta MCP: ' + e.message + ' | raw=' + String(raw).slice(0, 200);
}

// Reaproveita body original (model + tools + messages do sistema) e adiciona assistant tool_call + tool result
let baseBody = {};
try { baseBody = JSON.parse(promptData.openRouterBody); } catch(_) { baseBody = { model: promptData.model, messages: promptData.messages, temperature: 0.8 }; }

const newMessages = [
  ...(baseBody.messages || promptData.messages || []),
  extr.assistantMessage,
  { role: 'tool', tool_call_id: extr.toolCallId, content: textResult },
];

const outBody = { ...baseBody, messages: newMessages };

return [{ json: { ...outBody, openRouterBody: JSON.stringify(outBody) } }];
`;

// 2) Patch OpenRouter Com Ferramenta -> usa openRouterBody completo (com tools)
const orc = nodes.find(n => n.name === 'OpenRouter Com Ferramenta');
if (!orc) throw new Error('node not found: OpenRouter Com Ferramenta');
orc.parameters.jsonBody = '={{ $json.openRouterBody }}';

// PUT
const allowedSettings = ['executionOrder','saveManualExecutions','saveExecutionProgress','saveDataErrorExecution','saveDataSuccessExecution','timezone','executionTimeout','errorWorkflow','callerPolicy'];
const settings = {};
for (const k of allowedSettings) if (wf.settings && wf.settings[k] !== undefined) settings[k] = wf.settings[k];
if (!settings.executionOrder) settings.executionOrder = 'v1';

const body = { name: wf.name, nodes, connections: wf.connections, settings };
const res = await fetch(`${N8N}/api/v1/workflows/${WF}`, { method: 'PUT', headers: H, body: JSON.stringify(body) });
console.log('PUT', res.status, await res.text().then(t=>t.slice(0,200)));

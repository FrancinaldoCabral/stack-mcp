// Fix v3: Montar Tool Result MCP — usa formato correto OpenAI tool-use
// Ao invés de injetar na user message, monta a conversa correta:
// [...messages, assistant(tool_calls), tool(result)] com tool_choice: "none"
// Isso diz ao Gemini que a ferramenta JÁ foi executada e ele deve responder.
import 'dotenv/config';

const N8N_URL = process.env.N8N_URL;
const N8N_API_KEY = process.env.N8N_API_KEY;
const WF_ID = 'jleu4RPvSnYDL8Gd';

const res = await fetch(`${N8N_URL}/api/v1/workflows/${WF_ID}`, {
  headers: { 'X-N8N-API-KEY': N8N_API_KEY, 'Accept': 'application/json' }
});
const wf = await res.json();

const nodeIndex = wf.nodes.findIndex(n => n.id === 'montar-mcp-result');
if (nodeIndex === -1) throw new Error('Node montar-mcp-result not found');

const newCode = `// Fix v3: formato correto OpenAI tool-use para Montar Tool Result MCP
// Monta: [...messages, assistant(tool_calls), tool(result)]
// Com tool_choice: "none" → Gemini sabe que ferramenta foi executada e responde.
const raw = $input.first().json;
const extr = $('Extrair Query Ferramenta').first().json;
const promptData = $('Construir Prompt').first().json;

let textResult = '';
try {
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
    textResult = 'Erro HTTP ferramenta: ' + bodyStr.slice(0, 300);
  }
} catch (e) {
  textResult = 'Erro parseando resposta: ' + e.message;
}

let baseBody = {};
try { baseBody = JSON.parse(promptData.openRouterBody); } catch(_) {
  baseBody = { model: promptData.model, messages: promptData.messages, temperature: 0.8 };
}

// Formato correto OpenAI tool-use:
// 1. Mensagens originais (system + historico + user)
// 2. Resposta do assistant que chamou a ferramenta (com tool_calls)
// 3. Resultado da ferramenta (role: tool)
// Gemini vê conversa completa e sabe que deve responder com texto.
const baseMessages = [...(baseBody.messages || promptData.messages || [])];
const assistantMsg = extr.assistantMessage || {
  role: 'assistant',
  content: null,
  tool_calls: [{ id: extr.toolCallId, type: 'function', function: { name: extr.toolName, arguments: JSON.stringify(extr.args || {}) } }]
};
const toolResultMsg = {
  role: 'tool',
  tool_call_id: extr.toolCallId || 'call_1',
  content: textResult,
};

const outMessages = [...baseMessages, assistantMsg, toolResultMsg];
const outBody = {
  ...baseBody,
  messages: outMessages,
  tool_choice: 'none',  // garante que Gemini responde com texto, não chama outra ferramenta
};

return [{ json: { ...outBody, openRouterBody: JSON.stringify(outBody) } }];
`;

wf.nodes[nodeIndex].parameters.jsCode = newCode;

const putRes = await fetch(`${N8N_URL}/api/v1/workflows/${WF_ID}`, {
  method: 'PUT',
  headers: {
    'X-N8N-API-KEY': N8N_API_KEY,
    'Content-Type': 'application/json',
    'Accept': 'application/json',
  },
  body: JSON.stringify({
    name: wf.name,
    nodes: wf.nodes,
    connections: wf.connections,
    settings: { executionOrder: 'v1', saveManualExecutions: true },
  }),
});

const result = await putRes.json();
console.log('PUT status:', putRes.status);
console.log('updatedAt:', result.updatedAt);
if (putRes.status !== 200) {
  console.error('Error:', JSON.stringify(result).slice(0, 500));
}

import 'dotenv/config';
import fs from 'fs';
import https from 'https';

const WF_PATH = 'C:/Users/naldo/AppData/Roaming/Code/User/workspaceStorage/6373e82d89fe9051c2fa466fe02ca551/GitHub.copilot-chat/chat-session-resources/222752bc-8597-42ae-99be-d352f3a36400/toolu_bdrk_01CCx4p1uAR5fxzeUSC8gYc4__vscode-1780287134440/content.json';

const wf = JSON.parse(fs.readFileSync(WF_PATH, 'utf8'));
const mtrm = wf.nodes.find(n => n.name === 'Montar Tool Result MCP');
if (!mtrm) { console.error('Montar Tool Result MCP not found'); process.exit(1); }

// Current newMessages construction to be replaced:
const OLD = `const newMessages = [
  ...(baseBody.messages || promptData.messages || []),
  extr.assistantMessage,
  { role: 'tool', tool_call_id: extr.toolCallId, content: textResult },
];

// 'none' na 2a chamada: força o modelo a gerar texto, sem nova tool call
// Isso evita que o modelo tente encadear 2 tools (ex: draft_order → confirm_order) numa única rodada
const outBody = { ...baseBody, messages: newMessages };
// Remover tools e tool_choice da 2a chamada — sem tools, o modelo NÃO pode solicitar nova ferramenta
// (tool_choice:'none' é ignorado por Gemini 2.5 Flash quando tools está presente no body)
delete outBody.tools;
delete outBody.tool_choice;`;

const NEW = `// Para a 2ª chamada: NÃO incluir role:assistant+tool_calls nem role:tool no histórico.
// Gemini entra em "tool mode" ao ver esses papéis mesmo sem 'tools' no body.
// Convertemos o resultado da ferramenta para role:user com label explícito.
const assistantContent = extr.assistantMessage?.content || '';
const newMessages = [
  ...(baseBody.messages || promptData.messages || []),
  // Se o assistant gerou texto antes da tool call (incomum), preserva
  ...(assistantContent ? [{ role: 'assistant', content: assistantContent }] : []),
  // Resultado da ferramenta como mensagem do usuário — quebra o "tool mode"
  { role: 'user', content: \`[Resultado da ferramenta \${extr.toolName ?? 'consulta'}]:\\n\${textResult}\` },
];

const outBody = { ...baseBody, messages: newMessages };
delete outBody.tools;
delete outBody.tool_choice;`;

const newCode = mtrm.parameters.jsCode.replace(OLD, NEW);
if (newCode === mtrm.parameters.jsCode) {
  console.error('ERROR: replacement not found. Showing relevant lines:');
  mtrm.parameters.jsCode.split('\n').forEach((l, i) => {
    if (l.includes('newMessages') || l.includes('assistantMessage') || l.includes("role: 'tool'") || l.includes('outBody')) {
      console.error(`${i}: ${l}`);
    }
  });
  process.exit(1);
}

mtrm.parameters.jsCode = newCode;
console.log('Replacement OK. Verifying newMessages section:');
newCode.split('\n').forEach((l, i) => {
  if (l.includes('newMessages') || l.includes('assistantContent') || l.includes('tool mode') || l.includes('outBody')) {
    console.log(`${i}: ${l}`);
  }
});

const putBody = {
  name: wf.name,
  nodes: wf.nodes,
  connections: wf.connections,
  settings: { executionOrder: 'v1', saveManualExecutions: true }
};

const payload = JSON.stringify(putBody);
const n8nUrl = new URL(process.env.N8N_URL);

const req = https.request({
  hostname: n8nUrl.hostname,
  path: '/api/v1/workflows/jleu4RPvSnYDL8Gd',
  method: 'PUT',
  headers: {
    'X-N8N-API-KEY': process.env.N8N_API_KEY,
    'Content-Type': 'application/json',
    'Accept': 'application/json',
    'Content-Length': Buffer.byteLength(payload)
  }
}, res => {
  let d = '';
  res.on('data', c => d += c);
  res.on('end', () => {
    if (res.statusCode === 200) {
      const r = JSON.parse(d);
      console.log('\nPUT OK — updatedAt:', r.updatedAt);
    } else {
      console.log('PUT FAIL status:', res.statusCode);
      console.log(d.slice(0, 500));
    }
  });
});
req.on('error', e => console.error('Request error:', e.message));
req.write(payload);
req.end();

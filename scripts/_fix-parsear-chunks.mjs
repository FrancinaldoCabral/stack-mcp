import 'dotenv/config';
import fs from 'fs';
import https from 'https';

const WF_PATH = 'C:/Users/naldo/AppData/Roaming/Code/User/workspaceStorage/6373e82d89fe9051c2fa466fe02ca551/GitHub.copilot-chat/chat-session-resources/222752bc-8597-42ae-99be-d352f3a36400/toolu_bdrk_01CCx4p1uAR5fxzeUSC8gYc4__vscode-1780287134440/content.json';

const wf = JSON.parse(fs.readFileSync(WF_PATH, 'utf8'));
const parsear = wf.nodes.find(n => n.name === 'Parsear Chunks');
if (!parsear) { console.error('Parsear Chunks not found'); process.exit(1); }

const OLD = `} else if (_finishReason === 'tool_calls' && !_choice?.message?.content) {
  // LLM solicitou outra ferramenta mas o workflow suporta apenas 1 round - mensagem neutra
  content = 'Estou verificando aqui, um segundo... \u{1F9E0}';
} else {`;

const NEW = `} else {`;

const newCode = parsear.parameters.jsCode.replace(OLD, NEW);
if (newCode === parsear.parameters.jsCode) {
  console.error('ERROR: replacement string not found in code. Check exact match.');
  // Show the relevant section for debugging
  const lines = parsear.parameters.jsCode.split('\n');
  lines.forEach((l, i) => { if (i >= 8 && i <= 20) console.log(`${i}: ${l}`); });
  process.exit(1);
}

parsear.parameters.jsCode = newCode;
console.log('Replacement OK. Verifying lines 10-17:');
newCode.split('\n').forEach((l, i) => { if (i >= 10 && i <= 17) console.log(`${i}: ${l}`); });

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
      console.log('PUT OK — updatedAt:', r.updatedAt);
    } else {
      console.log('PUT FAIL status:', res.statusCode);
      console.log(d.slice(0, 500));
    }
  });
});
req.on('error', e => console.error('Request error:', e.message));
req.write(payload);
req.end();

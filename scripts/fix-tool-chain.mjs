/**
 * Corrige Montar Tool Result MCP: remove tools/tool_choice do body da 2a chamada
 * para evitar que Gemini 2.5 Flash ignore tool_choice:'none' e solicite outra tool call.
 */
import 'dotenv/config';
import https from 'https';

const N8N_URL = process.env.N8N_URL;
const N8N_KEY = process.env.N8N_API_KEY;

function n8nGet(path) {
  return new Promise((r, j) => {
    const u = new URL(N8N_URL + path);
    const req = https.request({
      hostname: u.hostname, path: u.pathname + u.search, method: 'GET',
      headers: { 'X-N8N-API-KEY': N8N_KEY, 'Accept': 'application/json' }
    }, res => { let d = ''; res.on('data', c => d += c); res.on('end', () => r(JSON.parse(d))); });
    req.on('error', j); req.end();
  });
}

function n8nPut(path, body) {
  return new Promise((r, j) => {
    const u = new URL(N8N_URL + path);
    const payload = JSON.stringify(body);
    const req = https.request({
      hostname: u.hostname, path: u.pathname, method: 'PUT',
      headers: { 'X-N8N-API-KEY': N8N_KEY, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload), 'Accept': 'application/json' }
    }, res => { let d = ''; res.on('data', c => d += c); res.on('end', () => r({ status: res.statusCode, body: d })); });
    req.on('error', j); req.write(payload); req.end();
  });
}

const wf = await n8nGet('/api/v1/workflows/jleu4RPvSnYDL8Gd');
const mtNode = wf.nodes.find(n => n.name === 'Montar Tool Result MCP');
if (!mtNode) throw new Error('Nó Montar Tool Result MCP não encontrado');

const oldCode = mtNode.parameters.jsCode;
const ANCHOR = "const outBody = { ...baseBody, messages: newMessages, tool_choice: 'none' };";

if (!oldCode.includes(ANCHOR)) {
  console.log('AVISO: padrão já foi substituído ou não encontrado. Código atual:');
  console.log(oldCode.slice(oldCode.indexOf('tool_choice') - 50, oldCode.indexOf('tool_choice') + 100));
  process.exit(0);
}

const REPLACEMENT = `const outBody = { ...baseBody, messages: newMessages };
// Remover tools e tool_choice da 2a chamada — sem tools, o modelo NÃO pode solicitar nova ferramenta
// (tool_choice:'none' é ignorado por Gemini 2.5 Flash quando tools está presente no body)
delete outBody.tools;
delete outBody.tool_choice;`;

mtNode.parameters.jsCode = oldCode.replace(ANCHOR, REPLACEMENT);
console.log('Patch preparado. Linhas alteradas:');
console.log('  ANTES:', ANCHOR);
console.log('  DEPOIS:', REPLACEMENT.split('\n')[0], '+ delete tools/tool_choice');

const res = await n8nPut('/api/v1/workflows/jleu4RPvSnYDL8Gd', {
  name: wf.name,
  nodes: wf.nodes,
  connections: wf.connections,
  settings: { executionOrder: 'v1', saveManualExecutions: true },
});

console.log('\nStatus HTTP:', res.status);
if (res.status !== 200) {
  console.log('Erro:', res.body.slice(0, 400));
} else {
  const updated = JSON.parse(res.body);
  console.log('✅ Workflow atualizado — updatedAt:', updated.updatedAt);
}

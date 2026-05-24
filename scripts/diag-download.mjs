import 'dotenv/config';

const H = { 'X-N8N-API-KEY': process.env.N8N_API_KEY, 'Accept': 'application/json', 'Content-Type': 'application/json' };
const WF_ID = 'jleu4RPvSnYDL8Gd';

// Tenta todas as variações de download para achar qual funciona
const DIAG_CODE = `const msg = $('Desembalar Payload').first().json;
const audioUrl = msg.metadata?.url ?? '';
if (!audioUrl) return [{ json: { ...msg, conteudo: '', transcricaoDisponivel: false } }];

let diag = {};

// Teste 1: responseType arraybuffer
try {
  const r1 = await this.helpers.httpRequest({ method: 'GET', url: audioUrl, responseType: 'arraybuffer', returnFullResponse: true, ignoreHttpStatusErrors: true });
  const buf = Buffer.isBuffer(r1.body) ? r1.body : Buffer.from(r1.body);
  diag.t1 = 'OK len=' + buf.length + ' type=' + typeof r1.body + ' ctor=' + r1.body?.constructor?.name;
} catch(e) { diag.t1 = 'ERR:' + String(e).slice(0,100); }

// Teste 2: encoding null (node-fetch style)
try {
  const r2 = await this.helpers.httpRequest({ method: 'GET', url: audioUrl, encoding: null, returnFullResponse: true, ignoreHttpStatusErrors: true });
  const buf = Buffer.isBuffer(r2.body) ? r2.body : Buffer.from(r2.body);
  diag.t2 = 'OK len=' + buf.length + ' type=' + typeof r2.body + ' ctor=' + r2.body?.constructor?.name;
} catch(e) { diag.t2 = 'ERR:' + String(e).slice(0,100); }

// Teste 3: sem opções especiais
try {
  const r3 = await this.helpers.httpRequest({ method: 'GET', url: audioUrl, returnFullResponse: true, ignoreHttpStatusErrors: true });
  diag.t3 = 'OK bodyType=' + typeof r3.body + ' ctor=' + r3.body?.constructor?.name + ' len=' + (r3.body?.length ?? r3.body?.byteLength) + ' statusCode=' + r3.statusCode;
} catch(e) { diag.t3 = 'ERR:' + String(e).slice(0,100); }

return [{ json: { ...msg, conteudo: '', transcricaoDisponivel: false, diag } }];`;

const wf = await fetch(`https://workflows.vendly.chat/api/v1/workflows/${WF_ID}`, { headers: H }).then(r => r.json());
const node = wf.nodes.find(n => n.name === 'Prep Transcrição');
node.parameters.jsCode = DIAG_CODE;

const body = { name: wf.name, nodes: wf.nodes, connections: wf.connections, settings: { executionOrder: 'v1', saveManualExecutions: true } };
const res = await fetch(`https://workflows.vendly.chat/api/v1/workflows/${WF_ID}`, { method: 'PUT', headers: H, body: JSON.stringify(body) }).then(r => r.json());
console.log(res.id ? '✅ Diag v3 (download variants) implantado' : '❌ ' + JSON.stringify(res).slice(0, 200));

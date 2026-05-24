/**
 * Diagnóstico: testa se getBinaryDataBuffer funciona no Code node
 * Substitui Prep Transcrição por versão que expõe o erro interno
 */
import 'dotenv/config';

const H = { 'X-N8N-API-KEY': process.env.N8N_API_KEY, 'Accept': 'application/json', 'Content-Type': 'application/json' };
const WF_ID = 'jleu4RPvSnYDL8Gd';

const DIAG_CODE = `const msg = $('Desembalar Payload').first().json;
const audioUrl = msg.metadata?.url ?? '';
if (!audioUrl) return [{ json: { ...msg, conteudo: '', transcricaoDisponivel: false } }];

let base64 = null;
let size = 0;
let mimeType = 'audio/ogg';
let diagError = '';

try {
  const item = $input.first();
  const binProp = item.binary?.data;
  diagError += 'binProp:' + JSON.stringify(!!binProp);
  diagError += ' helpers:' + JSON.stringify(Object.keys(this.helpers ?? {}));
  if (binProp) {
    const buffer = await this.helpers.getBinaryDataBuffer(item, 'data');
    diagError += ' bufLen:' + buffer?.length;
    base64 = buffer.toString('base64');
    size   = buffer.length;
    mimeType = (binProp.mimeType ?? 'audio/ogg').replace(/^application\\/ogg$/, 'audio/ogg');
  }
} catch (e) {
  diagError += ' ERR:' + e.message;
}

if (!base64) {
  return [{ json: { ...msg, conteudo: '', transcricaoDisponivel: false, base64: null, size: 0, diagError } }];
}

return [{ json: { ...msg, conteudo: 'BINARY_OK_size:' + size, transcricaoDisponivel: true, size, diagError } }];`;

const wf = await fetch(`https://workflows.vendly.chat/api/v1/workflows/${WF_ID}`, { headers: H }).then(r => r.json());
const node = wf.nodes.find(n => n.name === 'Prep Transcrição');
if (!node) throw new Error('Nó não encontrado');

node.parameters.jsCode = DIAG_CODE;

const body = { name: wf.name, nodes: wf.nodes, connections: wf.connections, settings: { executionOrder: 'v1', saveManualExecutions: true } };
const res = await fetch(`https://workflows.vendly.chat/api/v1/workflows/${WF_ID}`, { method: 'PUT', headers: H, body: JSON.stringify(body) }).then(r => r.json());
console.log(res.id ? '✅ Código diagnóstico implantado' : '❌ ' + JSON.stringify(res).slice(0, 200));

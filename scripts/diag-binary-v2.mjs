import 'dotenv/config';

const H = { 'X-N8N-API-KEY': process.env.N8N_API_KEY, 'Accept': 'application/json', 'Content-Type': 'application/json' };
const WF_ID = 'jleu4RPvSnYDL8Gd';

// Diagnóstico mais detalhado: captura stack completo e testa alternativas
const DIAG_CODE = `const msg = $('Desembalar Payload').first().json;
const audioUrl = msg.metadata?.url ?? '';
if (!audioUrl) return [{ json: { ...msg, conteudo: '', transcricaoDisponivel: false } }];

let base64 = null;
let size = 0;
let mimeType = 'audio/ogg';
let diagError = '';

const item = $input.first();
const binProp = item.binary?.data;
diagError += 'binProp:' + JSON.stringify(!!binProp);
diagError += ' dataField:' + JSON.stringify(binProp?.data?.slice?.(0, 40));
diagError += ' mimeType:' + binProp?.mimeType;
diagError += ' fileSize:' + binProp?.fileSize;
diagError += ' id:' + binProp?.id;

if (binProp) {
  // Abordagem 1: getBinaryDataBuffer
  try {
    const buffer = await this.helpers.getBinaryDataBuffer(item, 'data');
    base64 = buffer.toString('base64');
    size   = buffer.length;
    mimeType = (binProp.mimeType ?? 'audio/ogg').replace(/^application\\/ogg$/, 'audio/ogg');
    diagError += ' METHOD:getBinaryDataBuffer OK bufLen:' + buffer.length;
  } catch (e) {
    diagError += ' METHOD:getBinaryDataBuffer ERR:' + String(e) + ' stack:' + (e?.stack ?? '').slice(0, 200);
  }

  // Abordagem 2: binaryToBuffer (alternativa)
  if (!base64) {
    try {
      const stream = await this.helpers.getBinaryStream(item, 'data');
      const buf = await this.helpers.binaryToBuffer(stream);
      base64 = buf.toString('base64');
      size   = buf.length;
      mimeType = (binProp.mimeType ?? 'audio/ogg').replace(/^application\\/ogg$/, 'audio/ogg');
      diagError += ' METHOD:getBinaryStream+binaryToBuffer OK bufLen:' + buf.length;
    } catch (e2) {
      diagError += ' METHOD:binaryStream ERR:' + String(e2).slice(0, 100);
    }
  }
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
console.log(res.id ? '✅ Diag v2 implantado' : '❌ ' + JSON.stringify(res).slice(0, 200));

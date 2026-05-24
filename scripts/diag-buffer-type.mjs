import 'dotenv/config';

// Diagnóstico: testar o que httpRequest retorna exatamente
// Será implantado no N8N para ver o tipo real de retorno

const DIAG_CODE = `const audioUrl = 'https://upload.wikimedia.org/wikipedia/commons/c/c8/Example.ogg';
let results = {};

// Test encoding='base64' - N8N may support this
try {
  const body = await this.helpers.httpRequest({ method: 'GET', url: audioUrl, encoding: 'base64', ignoreHttpStatusErrors: true });
  results.base64 = { type: typeof body, len: body?.length, start: body?.slice(0, 30) };
} catch(e) { results.base64 = {err: e.message}; }

// Test returnFullResponse + encoding=base64
try {
  const r = await this.helpers.httpRequest({ method: 'GET', url: audioUrl, returnFullResponse: true, encoding: 'base64', ignoreHttpStatusErrors: true });
  results.fullBase64 = { bodyType: typeof r.body, len: r.body?.length, start: r.body?.slice(0, 30) };
} catch(e) { results.fullBase64 = {err: e.message}; }

// Windows-1252 decode test: use charCodeAt to get the original codepoints
// If N8N decoded as cp1252, char U+2018 = 0x91 in cp1252
const CP1252_MAP = [8364,129,8218,402,8222,8230,8224,8225,710,8240,352,8249,338,141,381,143,144,8216,8217,8220,8221,8226,8211,8212,732,8482,353,8250,339,157,382,376];
try {
  const body2 = await this.helpers.httpRequest({ method: 'GET', url: audioUrl, encoding: null, ignoreHttpStatusErrors: true });
  // Reverse cp1252: convert chars back to bytes using cp1252 table
  const bytes = new Uint8Array(body2.length);
  for (let i = 0; i < body2.length; i++) {
    const cp = body2.charCodeAt(i);
    if (cp < 128) { bytes[i] = cp; }
    else if (cp >= 160 && cp <= 255) { bytes[i] = cp; }
    else {
      const idx = CP1252_MAP.indexOf(cp);
      bytes[i] = idx >= 0 ? 128 + idx : 63;
    }
  }
  const buf = Buffer.from(bytes);
  results.cp1252Reverse = { len: buf.length, b64Start: buf.toString('base64').slice(0, 30) };
} catch(e) { results.cp1252Reverse = {err: e.message}; }

return [{ json: results }];`;

const H = { 'X-N8N-API-KEY': process.env.N8N_API_KEY, 'Accept': 'application/json', 'Content-Type': 'application/json' };
const wf = await fetch('https://workflows.vendly.chat/api/v1/workflows/jleu4RPvSnYDL8Gd', { headers: H }).then(r => r.json());

const prepNode = wf.nodes.find(n => n.name === 'Prep Transcrição');
const origCode = prepNode.parameters.jsCode;
prepNode.parameters.jsCode = DIAG_CODE;

const payload = { name: wf.name, nodes: wf.nodes, connections: wf.connections, settings: { executionOrder: 'v1', saveManualExecutions: true } };
const r = await fetch(`https://workflows.vendly.chat/api/v1/workflows/${wf.id}`, {
  method: 'PUT',
  headers: H,
  body: JSON.stringify(payload)
}).then(r => r.json());

console.log('Updated:', r.updatedAt ?? r.message ?? JSON.stringify(r).slice(0,100));
console.log('\nRun: node scripts/test-flow.mjs audio suporte-redatudo');
console.log('Then check with: node scripts/show-exec.mjs (update exec ID)');

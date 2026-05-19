import 'dotenv/config';
import https from 'https';

function req(method, path, body) {
  return new Promise((res, rej) => {
    const u = new URL(process.env.N8N_URL + path);
    const d = body ? JSON.stringify(body) : undefined;
    const opts = {
      hostname: u.hostname,
      path: u.pathname + u.search,
      method,
      headers: {
        'X-N8N-API-KEY': process.env.N8N_API_KEY,
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        ...(d ? { 'Content-Length': Buffer.byteLength(d) } : {}),
      },
    };
    const r = https.request(opts, (resp) => {
      let s = '';
      resp.on('data', x => s += x);
      resp.on('end', () => {
        try { res({ status: resp.statusCode, body: JSON.parse(s) }); }
        catch { res({ status: resp.statusCode, body: s }); }
      });
    });
    r.on('error', rej);
    if (d) r.write(d);
    r.end();
  });
}

const { status: getStatus, body: wf } = await req('GET', '/api/v1/workflows/FacKqM3e2LsHE6NY');
if (getStatus !== 200) { console.error('GET failed', getStatus, wf); process.exit(1); }

const parse = wf.nodes.find(n => n.name === 'Parse Item');
if (!parse) { console.error('Parse Item node not found'); process.exit(1); }

const newCode = `// Deserializa o item POPado da lista Redis
// O nó Redis pop pode retornar sob 'value' ou 'propertyName', como objeto ou string
const raw = $input.first().json;
const v = raw.value ?? raw.propertyName;
if (!v || v === 'nil' || v === 'null') return [];
try {
  if (typeof v === 'object') return [{ json: v }];
  return [{ json: JSON.parse(v) }];
} catch(e) {
  return [{ json: { conteudo: String(v), tipo: 'texto' } }];
}`;

parse.parameters.jsCode = newCode;

const { status, body: result } = await req('PUT', '/api/v1/workflows/FacKqM3e2LsHE6NY', {
  name: wf.name,
  nodes: wf.nodes,
  connections: wf.connections,
  settings: { executionOrder: 'v1', saveManualExecutions: true },
});

if (status === 200) {
  // Confirma que foi salvo
  const verify = wf.nodes.find(n => n.name === 'Parse Item');
  console.log('Status:', status);
  console.log('Código salvo (primeiros 100 chars):', result.nodes?.find(n => n.name === 'Parse Item')?.parameters?.jsCode?.slice(0, 100));
  console.log('OK');
} else {
  console.error('ERRO', status, JSON.stringify(result));
}

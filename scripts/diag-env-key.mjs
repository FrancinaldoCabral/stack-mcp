import 'dotenv/config';

const H = { 'X-N8N-API-KEY': process.env.N8N_API_KEY, 'Accept': 'application/json', 'Content-Type': 'application/json' };
const WF_ID = 'jleu4RPvSnYDL8Gd';

// Testa:
// 1. $env.OPENROUTER_API_KEY no Code node
// 2. Se sim: chama OpenRouter com httpRequest + Authorization manual
const DIAG_CODE = `const msg = $('Desembalar Payload').first().json;
const audioUrl = msg.metadata?.url ?? '';
if (!audioUrl) return [{ json: { ...msg, conteudo: '', transcricaoDisponivel: false } }];

let diag = {};

// Verificar acesso a env vars
diag.envAccess = typeof $env !== 'undefined' ? 'available' : 'NOT available';
const orKey = $env?.OPENROUTER_API_KEY ?? $env?.OPENROUTER_KEY ?? '';
diag.openrouterKey = orKey ? orKey.slice(0, 12) + '...' : 'NOT FOUND';
diag.envKeys = Object.keys($env ?? {}).filter(k => k.includes('OPEN') || k.includes('API') || k.includes('KEY')).slice(0, 10);

if (!orKey) {
  return [{ json: { ...msg, conteudo: '', transcricaoDisponivel: false, diag } }];
}

// Baixar áudio
let base64 = null;
let mimeType = 'audio/ogg';
try {
  const body = await this.helpers.httpRequest({ method: 'GET', url: audioUrl, encoding: null, ignoreHttpStatusErrors: true });
  const buf = Buffer.from(body, 'binary');
  base64 = buf.toString('base64');
  mimeType = 'audio/ogg';
  diag.downloadLen = buf.length;
  diag.isOgg = body.slice(0, 4) === 'OggS' ? 'YES' : 'prefix:' + Array.from(body.slice(0,4)).map(c=>c.charCodeAt(0).toString(16)).join(' ');
} catch(e) { diag.downloadErr = String(e).slice(0, 100); }

if (!base64) {
  return [{ json: { ...msg, conteudo: '', transcricaoDisponivel: false, diag } }];
}

// Chamar OpenRouter com httpRequest + Authorization manual
let transcription = '';
try {
  const payload = {
    model: 'google/gemini-2.0-flash-lite-001',
    messages: [{
      role: 'user',
      content: [
        { type: 'text', text: 'Transcreva este áudio para texto em português. Retorne SOMENTE o texto transcrito.' },
        { type: 'image_url', image_url: { url: \`data:\${mimeType};base64,\${base64}\` } },
      ],
    }],
  };
  const result = await this.helpers.httpRequest({
    method: 'POST',
    url: 'https://openrouter.ai/api/v1/chat/completions',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + orKey },
    body: JSON.stringify(payload),
    json: true,
  });
  transcription = result.choices?.[0]?.message?.content?.trim() ?? '';
  diag.orResult = transcription ? 'OK:' + transcription.slice(0, 100) : 'EMPTY:' + JSON.stringify(result).slice(0, 200);
} catch(e) {
  diag.orErr = String(e).slice(0, 200);
}

return [{ json: { ...msg, conteudo: transcription || '', transcricaoDisponivel: !!transcription, diag } }];`;

const wf = await fetch(`https://workflows.vendly.chat/api/v1/workflows/${WF_ID}`, { headers: H }).then(r => r.json());
const node = wf.nodes.find(n => n.name === 'Prep Transcrição');
node.parameters.jsCode = DIAG_CODE;

const body = { name: wf.name, nodes: wf.nodes, connections: wf.connections, settings: { executionOrder: 'v1', saveManualExecutions: true } };
const res = await fetch(`https://workflows.vendly.chat/api/v1/workflows/${WF_ID}`, { method: 'PUT', headers: H, body: JSON.stringify(body) }).then(r => r.json());
console.log(res.id ? '✅ Diag v5 ($env + httpRequest) implantado' : '❌ ' + JSON.stringify(res).slice(0, 200));

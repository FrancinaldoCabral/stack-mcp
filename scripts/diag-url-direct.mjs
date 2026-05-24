import 'dotenv/config';

const H = { 'X-N8N-API-KEY': process.env.N8N_API_KEY, 'Accept': 'application/json', 'Content-Type': 'application/json' };
const WF_ID = 'jleu4RPvSnYDL8Gd';

// Abordagem: enviar URL direta para Gemini (sem base64)
// Gemini suporta URLs externas no image_url
const DIAG_CODE = `const msg = $('Desembalar Payload').first().json;
const audioUrl = msg.metadata?.url ?? '';
if (!audioUrl) return [{ json: { ...msg, conteudo: '', transcricaoDisponivel: false } }];

let diag = { audioUrl: audioUrl.slice(0, 80) };

// Método 1: URL direta para Gemini (sem download)
try {
  const model = 'google/gemini-2.0-flash-lite-001';
  const payload = {
    model,
    messages: [{
      role: 'user',
      content: [
        { type: 'text', text: 'Transcreva este áudio para texto em português. Retorne SOMENTE o texto transcrito.' },
        { type: 'image_url', image_url: { url: audioUrl } },
      ],
    }],
  };
  const result = await this.helpers.httpRequestWithAuthentication('httpHeaderAuth', {
    method: 'POST',
    url: 'https://openrouter.ai/api/v1/chat/completions',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    json: true,
  });
  const transcript = result.choices?.[0]?.message?.content?.trim() ?? '';
  diag.method1 = transcript ? 'OK:' + transcript.slice(0, 100) : 'EMPTY choices=' + JSON.stringify(result.choices);
} catch(e) {
  diag.method1 = 'ERR:' + String(e).slice(0, 200);
}

// Método 2: string binary → Buffer.from(str, 'binary') → base64
try {
  const strBody = await this.helpers.httpRequest({
    method: 'GET',
    url: audioUrl,
    encoding: null,
    ignoreHttpStatusErrors: true,
  });
  // Tentar decodificar como binary
  const buf = Buffer.from(strBody, 'binary');
  const b64 = buf.toString('base64');
  diag.method2_len = buf.length;
  diag.method2_isOgg = strBody.slice(0, 4) === 'OggS' ? 'YES' : 'prefix:' + Array.from(strBody.slice(0,4)).map(c=>c.charCodeAt(0).toString(16)).join(' ');
  diag.method2_b64_prefix = b64.slice(0, 20);
} catch(e) {
  diag.method2 = 'ERR:' + String(e).slice(0, 100);
}

return [{ json: { ...msg, conteudo: '', transcricaoDisponivel: false, diag } }];`;

const wf = await fetch(`https://workflows.vendly.chat/api/v1/workflows/${WF_ID}`, { headers: H }).then(r => r.json());
const node = wf.nodes.find(n => n.name === 'Prep Transcrição');
node.parameters.jsCode = DIAG_CODE;

const body = { name: wf.name, nodes: wf.nodes, connections: wf.connections, settings: { executionOrder: 'v1', saveManualExecutions: true } };
const res = await fetch(`https://workflows.vendly.chat/api/v1/workflows/${WF_ID}`, { method: 'PUT', headers: H, body: JSON.stringify(body) }).then(r => r.json());
console.log(res.id ? '✅ Diag v4 (URL direta + binary decode) implantado' : '❌ ' + JSON.stringify(res).slice(0, 200));

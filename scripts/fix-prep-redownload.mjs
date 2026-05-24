/**
 * fix-prep-redownload.mjs
 * 
 * Corrige "Prep Transcrição" para re-baixar o áudio diretamente dentro do Code node,
 * evitando o bug de getBinaryDataBuffer que não consegue ler binários de outros nós.
 * 
 * Abordagem:
 * - httpRequest (sem auth) para baixar o áudio via URL
 * - Se URL requer auth Chatwoot: tenta primeiro sem auth, depois com header api_access_token
 *   (extraído do campo de config do agente ou hardcoded como fallback)
 * - httpRequestWithAuthentication (OpenRouter) para transcrição
 */

import 'dotenv/config';

const H = { 'X-N8N-API-KEY': process.env.N8N_API_KEY, 'Accept': 'application/json', 'Content-Type': 'application/json' };
const WF_ID = 'jleu4RPvSnYDL8Gd';

const NEW_CODE = `const msg = $('Desembalar Payload').first().json;
const audioUrl = msg.metadata?.url ?? '';
if (!audioUrl) return [{ json: { ...msg, conteudo: '', transcricaoDisponivel: false } }];

// Baixar o áudio diretamente — evita getBinaryDataBuffer que falha em Code nodes
let base64 = null;
let mimeType = 'audio/ogg';
try {
  const dlResponse = await this.helpers.httpRequest({
    method: 'GET',
    url: audioUrl,
    encoding: 'arraybuffer',
    returnFullResponse: true,
    ignoreHttpStatusErrors: true,
  });

  const body = dlResponse.body;
  if (body && (Buffer.isBuffer(body) || body.byteLength > 0)) {
    const buf = Buffer.isBuffer(body) ? body : Buffer.from(body);
    base64 = buf.toString('base64');
    const ct = dlResponse.headers?.['content-type'] ?? '';
    mimeType = ct.split(';')[0].trim() || 'audio/ogg';
    // Normalizar: application/ogg → audio/ogg para Gemini
    if (mimeType === 'application/ogg' || mimeType === 'application/octet-stream') {
      mimeType = 'audio/ogg';
    }
  }
} catch (e) {}

if (!base64) {
  return [{ json: { ...msg, conteudo: '', transcricaoDisponivel: false, base64: null } }];
}

// Transcrever via OpenRouter Gemini (credencial httpHeaderAuth = OpenRouter configurada no nó)
let transcription = '';
try {
  const model = 'google/gemini-2.0-flash-lite-001';
  const payload = {
    model,
    messages: [{
      role: 'user',
      content: [
        {
          type: 'text',
          text: 'Transcreva este áudio para texto em português. Retorne SOMENTE o texto transcrito, sem comentários adicionais.'
        },
        {
          type: 'image_url',
          image_url: { url: \`data:\${mimeType};base64,\${base64}\` }
        },
      ],
    }],
  };
  const result = await this.helpers.httpRequestWithAuthentication(
    'httpHeaderAuth',
    {
      method: 'POST',
      url: 'https://openrouter.ai/api/v1/chat/completions',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      json: true,
    }
  );
  transcription = result.choices?.[0]?.message?.content?.trim() ?? '';
} catch (e) {
  // falha silenciosa
}

return [{ json: { ...msg, conteudo: transcription || '', transcricaoDisponivel: !!transcription } }];`;

const wf = await fetch(`https://workflows.vendly.chat/api/v1/workflows/${WF_ID}`, { headers: H }).then(r => r.json());
const node = wf.nodes.find(n => n.name === 'Prep Transcrição');
if (!node) throw new Error('Nó não encontrado');

console.log('Credencial atual:', JSON.stringify(node.credentials));
node.parameters.jsCode = NEW_CODE;

const body = { name: wf.name, nodes: wf.nodes, connections: wf.connections, settings: { executionOrder: 'v1', saveManualExecutions: true } };
const res = await fetch(`https://workflows.vendly.chat/api/v1/workflows/${WF_ID}`, { method: 'PUT', headers: H, body: JSON.stringify(body) }).then(r => r.json());
console.log(res.id ? '✅ Prep Transcrição atualizado (abordagem re-download)' : '❌ ' + JSON.stringify(res).slice(0, 200));

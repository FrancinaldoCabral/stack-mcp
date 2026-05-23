import 'dotenv/config';

const headers = {
  'X-N8N-API-KEY': process.env.N8N_API_KEY,
  'Accept': 'application/json',
  'Content-Type': 'application/json',
};

const MCP_URL = 'http://fco8og80s4sw4c0wc0ogswws.157.173.111.65.sslip.io';

const wf = await fetch('https://workflows.vendly.chat/api/v1/workflows/jleu4RPvSnYDL8Gd', { headers })
  .then(r => r.json());

// 1. OpenRouter TTS → chama MCP /util/tts em vez de OpenRouter direto
//    Retorna JSON { base64, size } — sem binary data
const ttsNode = wf.nodes.find(n => n.id === 'openrouter-tts');
if (!ttsNode) { console.error('nó openrouter-tts não encontrado'); process.exit(1); }

ttsNode.type = 'n8n-nodes-base.httpRequest';
ttsNode.typeVersion = 4.2;
ttsNode.parameters = {
  method: 'POST',
  url: `${MCP_URL}/util/tts`,
  // Usa credencial OpenRouter para injetar Authorization: Bearer <key>
  // O MCP /util/tts lê o header e passa ao OpenRouter TTS API
  authentication: 'genericCredentialType',
  genericAuthType: 'httpHeaderAuth',
  sendBody: true,
  specifyBody: 'json',
  jsonBody: '={{ JSON.stringify({ text: $json.fullText, voice: \'alloy\' }) }}',
  options: {
    response: { response: { neverError: true } },
  },
};
ttsNode.credentials = { httpHeaderAuth: { id: 'H0XlPAbxjEUzplW4', name: 'OpenRouter' } };

// 2. Extrair B64 TTS → lê $json.base64 diretamente (JSON, não binary)
const extractNode = wf.nodes.find(n => n.id === 'extract-b64-tts');
if (!extractNode) { console.error('nó extract-b64-tts não encontrado'); process.exit(1); }

extractNode.parameters.jsCode = `const ttsResp = $input.first().json;
if (!ttsResp.base64) throw new Error('TTS falhou: ' + JSON.stringify(ttsResp));

const allChunks = $('Parsear Chunks').all();
const ctx = allChunks[allChunks.length - 1]?.json ?? {};

return [{
  json: {
    audioBase64: ttsResp.base64,
    instance: ctx.instance,
    remoteJid: ctx.remoteJid,
    evolutionAudioUrl: \`https://evolution.vendly.chat/message/sendWhatsAppAudio/\${ctx.instance}\`,
    evolutionAudioBody: { number: ctx.remoteJid, audio: ttsResp.base64, encoding: true },
    contexto: ctx.contexto,
  }
}];`;

const body = {
  name: wf.name,
  nodes: wf.nodes,
  connections: wf.connections,
  settings: { executionOrder: 'v1', saveManualExecutions: true },
};

const res = await fetch('https://workflows.vendly.chat/api/v1/workflows/jleu4RPvSnYDL8Gd', {
  method: 'PUT',
  headers,
  body: JSON.stringify(body),
});
const r = await res.json();
console.log(r.id
  ? '✅ OpenRouter TTS + Extrair B64 TTS atualizados — TTS agora via MCP /util/tts'
  : JSON.stringify(r));

// Restaura o caminho de TTS (OpenRouter TTS + Extrair B64 TTS) para o estado
// da tag v1.3.0, que sempre funcionou. O nó atual foi reescrito por engano para
// apontar para uma URL sslip do MCP e ler de $json.base64, mas o correto é
// chamar a OpenRouter direto e ler do binário.
//
// NÃO mexe em mais nada do workflow.

import 'dotenv/config';

const N8N_URL = process.env.N8N_URL || 'https://workflows.vendly.chat';
const N8N_KEY = process.env.N8N_API_KEY;
const WF_ID = 'jleu4RPvSnYDL8Gd';
const TTS_MODEL = process.env.OPENROUTER_TTS_MODEL || 'openai/gpt-4o-mini-tts';

if (!N8N_KEY) { console.error('N8N_API_KEY ausente'); process.exit(1); }

const headers = {
  'X-N8N-API-KEY': N8N_KEY,
  'Content-Type': 'application/json',
  'Accept': 'application/json',
};

const wf = await fetch(`${N8N_URL}/api/v1/workflows/${WF_ID}`, { headers }).then(r => r.json());

const ttsNode = wf.nodes.find(n => n.name === 'OpenRouter TTS');
const extractNode = wf.nodes.find(n => n.name === 'Extrair B64 TTS');
if (!ttsNode || !extractNode) {
  console.error('Nós OpenRouter TTS / Extrair B64 TTS não encontrados');
  process.exit(1);
}

// Pega o id da credencial OpenRouter já em uso por outro nó
const openrouterCredId = (wf.nodes.find(n => n.credentials?.httpHeaderAuth?.name === 'OpenRouter')?.credentials?.httpHeaderAuth?.id) || ttsNode.credentials?.httpHeaderAuth?.id;
if (!openrouterCredId) { console.error('Credencial OpenRouter não localizada nos nós'); process.exit(1); }

// === Restaurar OpenRouter TTS ===
ttsNode.type = 'n8n-nodes-base.httpRequest';
ttsNode.typeVersion = 4.2;
ttsNode.parameters = {
  method: 'POST',
  url: 'https://openrouter.ai/api/v1/audio/speech',
  authentication: 'genericCredentialType',
  genericAuthType: 'httpHeaderAuth',
  sendBody: true,
  specifyBody: 'json',
  jsonBody: `={{ JSON.stringify({ model: '${TTS_MODEL}', input: $json.fullText, voice: 'alloy', response_format: 'mp3' }) }}`,
  options: { response: { response: { responseFormat: 'file', neverError: true } } },
};
ttsNode.credentials = { httpHeaderAuth: { id: openrouterCredId, name: 'OpenRouter' } };

// === Restaurar Extrair B64 TTS ===
extractNode.type = 'n8n-nodes-base.code';
extractNode.typeVersion = 2;
extractNode.parameters = {
  jsCode: `const binaryData = $input.first().binary?.data;
if (!binaryData) throw new Error('TTS: sem dados de áudio na resposta');
const audioBase64 = binaryData.data;

const allChunks = $('Parsear Chunks').all();
const ctx = allChunks[allChunks.length - 1]?.json ?? {};

return [{
  json: {
    audioBase64,
    instance: ctx.instance,
    remoteJid: ctx.remoteJid,
    evolutionAudioUrl: \`https://evolution.vendly.chat/message/sendWhatsAppAudio/\${ctx.instance}\`,
    evolutionAudioBody: { number: ctx.remoteJid, audio: audioBase64, encoding: true },
    contexto: ctx.contexto,
  }
}];`,
};

// PUT só com os campos permitidos pela API N8N
const allowedSettingsKeys = ['saveExecutionProgress','saveManualExecutions','saveDataErrorExecution','saveDataSuccessExecution','executionTimeout','errorWorkflow','timezone','executionOrder'];
const filteredSettings = {};
for (const k of allowedSettingsKeys) {
  if (wf.settings && wf.settings[k] !== undefined) filteredSettings[k] = wf.settings[k];
}
if (!filteredSettings.executionOrder) filteredSettings.executionOrder = 'v1';
const body = {
  name: wf.name,
  nodes: wf.nodes,
  connections: wf.connections,
  settings: filteredSettings,
};
const res = await fetch(`${N8N_URL}/api/v1/workflows/${WF_ID}`, {
  method: 'PUT', headers, body: JSON.stringify(body),
});
const txt = await res.text();
if (!res.ok) { console.error('PUT falhou', res.status, txt); process.exit(1); }
console.log(`✅ Workflow ${WF_ID} atualizado (TTS restaurado para padrão v1.3.0, modelo=${TTS_MODEL})`);

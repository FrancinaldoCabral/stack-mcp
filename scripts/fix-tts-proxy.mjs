/**
 * fix-tts-proxy.mjs
 * Reverte OpenRouter TTS para usar o proxy /util/tts do MCP (app.vendly.chat)
 * em vez de chamar openrouter.ai/api/v1/audio/speech diretamente (que retorna 404/dados inválidos).
 * Também corrige Extrair B64 TTS para ler $input.first().json.base64 (JSON, não binary).
 */
import 'dotenv/config';

const N8N_URL = process.env.N8N_URL || 'https://workflows.vendly.chat';
const N8N_API_KEY = process.env.N8N_API_KEY;
const WF_ID = 'jleu4RPvSnYDL8Gd';

if (!N8N_API_KEY) { console.error('N8N_API_KEY not set'); process.exit(1); }

const headers = {
  'X-N8N-API-KEY': N8N_API_KEY,
  'Content-Type': 'application/json',
  'Accept': 'application/json, text/event-stream',
};

async function main() {
  // 1. Buscar workflow atual
  const r = await fetch(`${N8N_URL}/api/v1/workflows/${WF_ID}`, { headers });
  if (!r.ok) throw new Error(`GET failed: ${r.status} ${await r.text()}`);
  const wf = await r.json();

  const nodes = wf.nodes;

  // 2. Corrigir OpenRouter TTS
  const ttsNode = nodes.find(n => n.name === 'OpenRouter TTS');
  if (!ttsNode) throw new Error('Nó "OpenRouter TTS" não encontrado');

  const oldTtsUrl = ttsNode.parameters.url;
  console.log('OpenRouter TTS URL atual:', oldTtsUrl);

  // Substituir pela chamada ao proxy MCP (retorna JSON {base64, size})
  ttsNode.parameters = {
    method: 'POST',
    url: 'https://app.vendly.chat/util/tts',
    authentication: 'genericCredentialType',
    genericAuthType: 'httpHeaderAuth',
    sendBody: true,
    specifyBody: 'json',
    jsonBody: '={{ JSON.stringify({ text: $json.fullText }) }}',
    options: {
      response: {
        response: {
          neverError: true,
        },
      },
    },
  };

  // Manter credencial OpenRouter existente
  // (o proxy aceita Authorization Bearer para passar a chave adiante)

  // 3. Corrigir Extrair B64 TTS
  const b64Node = nodes.find(n => n.name === 'Extrair B64 TTS');
  if (!b64Node) throw new Error('Nó "Extrair B64 TTS" não encontrado');

  console.log('Extrair B64 TTS código atual (primeiros 100 chars):', b64Node.parameters.jsCode?.substring(0, 100));

  b64Node.parameters.jsCode = `const ttsResp = $input.first().json;
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

  // 4. Atualizar workflow via PUT
  const payload = {
    name: wf.name,
    nodes: wf.nodes,
    connections: wf.connections,
    settings: {
      executionOrder: 'v1',
      saveManualExecutions: true,
    },
  };

  const upd = await fetch(`${N8N_URL}/api/v1/workflows/${WF_ID}`, {
    method: 'PUT',
    headers,
    body: JSON.stringify(payload),
  });

  if (!upd.ok) {
    const body = await upd.text();
    throw new Error(`PUT failed: ${upd.status} ${body}`);
  }

  const result = await upd.json();
  console.log(`\n✅ Workflow ${result.id} atualizado com sucesso!`);
  console.log('OpenRouter TTS agora aponta para: https://app.vendly.chat/util/tts');
  console.log('Extrair B64 TTS agora lê $input.first().json.base64 (JSON, não binary)');
}

main().catch(e => { console.error('ERRO:', e.message); process.exit(1); });

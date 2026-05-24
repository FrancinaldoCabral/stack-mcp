import 'dotenv/config';

/**
 * Atualiza o workflow para usar o endpoint /util/audio-base64 do MCP
 * que faz o download correto e retorna base64 limpo.
 * 
 * Pipeline:
 *   IF Audio Input? → Prep Transcrição (Code, passa audioUrl) 
 *     → Baixar Áudio (HTTP Request, GET {MCP}/util/audio-base64?url={audioUrl})
 *     → Transcrever Áudio (HTTP Request, POST OpenRouter com base64)
 *     → Construir Prompt
 */

const H = { 'X-N8N-API-KEY': process.env.N8N_API_KEY, 'Accept': 'application/json', 'Content-Type': 'application/json' };
const WF_ID = 'jleu4RPvSnYDL8Gd';
const MCP_URL = process.env.MCP_URL ?? 'http://fco8og80s4sw4c0wc0ogswws.157.173.111.65.sslip.io';

console.log('Usando MCP URL:', MCP_URL);
console.log('Buscando workflow...');
const wf = await fetch(`https://workflows.vendly.chat/api/v1/workflows/${WF_ID}`, { headers: H }).then(r => r.json());
if (!wf.id) throw new Error('Workflow não encontrado');

const nodes = wf.nodes;
const conns = wf.connections;

// ── 1. Prep Transcrição: só passa audioUrl
const prepNode = nodes.find(n => n.name === 'Prep Transcrição');
prepNode.parameters.jsCode = `const msg = $('Desembalar Payload').first().json;
const audioUrl = msg.metadata?.url ?? '';
return [{ json: { ...msg, audioUrl, audioOk: !!audioUrl } }];`;
delete prepNode.credentials;
console.log('✓ Prep Transcrição simplificado');

// ── 2. Baixar Áudio: GET {MCP}/util/audio-base64?url={audioUrl}
const baixarNode = nodes.find(n => n.name === 'Baixar Áudio');
if (!baixarNode) throw new Error('Baixar Áudio não encontrado');

baixarNode.parameters = {
  method: 'GET',
  url: `={{ '${MCP_URL}/util/audio-base64?url=' + encodeURIComponent($json.audioUrl) }}`,
  options: {
    response: {
      response: {
        neverError: true,
      },
    },
  },
};
delete baixarNode.credentials;
console.log('✓ Baixar Áudio atualizado para usar MCP endpoint');

// ── 3. Transcrever Áudio: usa $json.base64 e $json.mimeType
const transcNode = nodes.find(n => n.name === 'Transcrever Áudio');
transcNode.parameters.jsonBody = `={{ JSON.stringify({
  model: 'google/gemini-2.0-flash-lite-001',
  messages: [{
    role: 'user',
    content: [
      { type: 'text', text: 'Transcreva este áudio para texto em português. Retorne SOMENTE o texto transcrito, sem comentários adicionais.' },
      { type: 'image_url', image_url: { url: 'data:' + ($json.mimeType ?? 'audio/ogg') + ';base64,' + $json.base64 } }
    ]
  }]
}) }}`;
console.log('✓ Transcrever Áudio atualizado para usar $json.base64');

// ── 4. Conexões: Prep → Baixar Áudio → Transcrever → Construir Prompt
conns['Prep Transcrição'] = { main: [[{ node: 'Baixar Áudio', type: 'main', index: 0 }]] };
conns['Baixar Áudio'] = { main: [[{ node: 'Transcrever Áudio', type: 'main', index: 0 }]] };
conns['Transcrever Áudio'] = { main: [[{ node: 'Construir Prompt', type: 'main', index: 0 }]] };
console.log('✓ Conexões atualizadas');

// ── 5. Salvar
const payload = { name: wf.name, nodes, connections: conns, settings: { executionOrder: 'v1', saveManualExecutions: true } };
const r = await fetch(`https://workflows.vendly.chat/api/v1/workflows/${WF_ID}`, {
  method: 'PUT', headers: H, body: JSON.stringify(payload)
}).then(r => r.json());
if (!r.updatedAt) { console.error('❌', JSON.stringify(r).slice(0,200)); process.exit(1); }
console.log('✅ Workflow atualizado! updatedAt:', r.updatedAt);

// Verificar MCP endpoint agora
console.log('\nTestando MCP endpoint /util/audio-base64...');
const testUrl = 'https://upload.wikimedia.org/wikipedia/commons/c/c8/Example.ogg';
const mcpR = await fetch(`${MCP_URL}/util/audio-base64?url=${encodeURIComponent(testUrl)}`).then(r => r.json()).catch(e => ({ error: e.message }));
if (mcpR.error) {
  console.log('MCP offline ou erro:', mcpR.error, '— aguardando redeploy Coolify');
} else {
  console.log('MCP OK: base64 len=', mcpR.base64?.length, 'size=', mcpR.size, 'mimeType=', mcpR.mimeType);
}

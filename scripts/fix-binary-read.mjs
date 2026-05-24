/**
 * fix-binary-read.mjs
 *
 * Corrige "Prep Transcrição" no [AGENT] Executor:
 * Bug: binProp.data contém 'filesystem-v2...' (referência FS do N8N), NÃO base64 real.
 * Fix: usa this.helpers.getBinaryDataBuffer() para ler o buffer real.
 * Também normaliza mimeType: 'application/ogg' → 'audio/ogg' para compatibilidade Gemini.
 */

import 'dotenv/config';

const N8N_URL = process.env.N8N_URL;
const API_KEY = process.env.N8N_API_KEY;
const WF_ID   = 'jleu4RPvSnYDL8Gd';

const H = {
  'X-N8N-API-KEY': API_KEY,
  'Accept': 'application/json',
  'Content-Type': 'application/json',
};

const NEW_CODE = `const msg = $('Desembalar Payload').first().json;
const audioUrl = msg.metadata?.url ?? '';
if (!audioUrl) return [{ json: { ...msg, conteudo: '', transcricaoDisponivel: false } }];

// Lê o áudio binário baixado pelo nó anterior "Baixar Áudio Chatwoot"
// IMPORTANTE: N8N armazena binários no filesystem (referência 'filesystem-v2...')
// Usar getBinaryDataBuffer() para obter o Buffer real e converter em base64.
let base64 = null;
let size = 0;
let mimeType = 'audio/ogg';
try {
  const item = $input.first();
  const binProp = item.binary?.data;
  if (binProp) {
    const buffer = await this.helpers.getBinaryDataBuffer(item, 'data');
    base64 = buffer.toString('base64');
    size   = buffer.length;
    // Normalizar: N8N pode retornar 'application/ogg' mas Gemini espera 'audio/ogg'
    mimeType = (binProp.mimeType ?? 'audio/ogg').replace(/^application\\/ogg$/, 'audio/ogg');
  }
} catch (e) {}

if (!base64) {
  return [{ json: { ...msg, conteudo: '', transcricaoDisponivel: false, base64: null, size: 0 } }];
}

// Transcreve via OpenRouter Gemini (credencial configurada no nó)
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
  // falha silenciosa — fallback em Construir Prompt
}

return [{ json: { ...msg, conteudo: transcription || '', transcricaoDisponivel: !!transcription, base64, size } }];`;

// 1. Buscar workflow
console.log('Buscando workflow [AGENT] Executor...');
const wf = await fetch(`${N8N_URL}/api/v1/workflows/${WF_ID}`, { headers: H }).then(r => r.json());
if (!wf.id) throw new Error('Workflow não encontrado: ' + JSON.stringify(wf).slice(0, 200));

// 2. Localizar nó
const node = wf.nodes.find(n => n.name === 'Prep Transcrição');
if (!node) throw new Error('Nó "Prep Transcrição" não encontrado');
console.log(`Nó encontrado: id=${node.id} | cred=${JSON.stringify(node.credentials)}`);

// Mostrar diferença
const oldBug = node.parameters.jsCode.includes("binProp.data") ? "base64 = binProp.data  ← BUG filesystem-v2" : '(não tem bug conhecido)';
console.log('Código atual:', oldBug);

// 3. Aplicar novo código
node.parameters.jsCode = NEW_CODE;

// 4. PUT workflow
const body = {
  name: wf.name,
  nodes: wf.nodes,
  connections: wf.connections,
  settings: {
    executionOrder: wf.settings?.executionOrder ?? 'v1',
    saveManualExecutions: wf.settings?.saveManualExecutions ?? true,
  },
};

console.log('Atualizando workflow...');
const res = await fetch(`${N8N_URL}/api/v1/workflows/${WF_ID}`, {
  method: 'PUT',
  headers: H,
  body: JSON.stringify(body),
});
const result = await res.json();

if (!result.id) {
  console.error('❌ Erro:', JSON.stringify(result).slice(0, 300));
  process.exit(1);
}
console.log('✅ Prep Transcrição corrigido!');
console.log('   updatedAt:', result.updatedAt);

// 5. Confirmar
const updNode = result.nodes.find(n => n.name === 'Prep Transcrição');
const hasFix = updNode?.parameters?.jsCode?.includes('getBinaryDataBuffer');
console.log('   getBinaryDataBuffer presente:', hasFix ? 'SIM ✅' : 'NÃO ❌');

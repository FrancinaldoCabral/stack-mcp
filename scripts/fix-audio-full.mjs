import 'dotenv/config';

const headers = {
  'X-N8N-API-KEY': process.env.N8N_API_KEY,
  'Accept': 'application/json',
  'Content-Type': 'application/json',
};

const wf = await fetch('https://workflows.vendly.chat/api/v1/workflows/jleu4RPvSnYDL8Gd', { headers })
  .then(r => r.json());

const MCP_URL = 'http://fco8og80s4sw4c0wc0ogswws.157.173.111.65.sslip.io';
let changed = 0;

// ── 1. Prep Transcrição: chamar /util/transcribe, retornar conteudo com transcrição ─────────────
const ptNode = wf.nodes.find(n => n.name === 'Prep Transcrição');
if (!ptNode) { console.error('Prep Transcrição NOT FOUND'); process.exit(1); }

const newPtCode = `const msg = $('Desembalar Payload').first().json;
const audioUrl = msg.metadata?.url ?? '';
if (!audioUrl) return [{ json: { ...msg, conteudo: '', transcricaoDisponivel: false } }];

const MCP_URL = '${MCP_URL}';
let transcription = '';
let base64 = null;
let size = 0;

// Transcrição via MCP /util/transcribe
try {
  const result = await this.helpers.httpRequest({
    method: 'POST',
    url: MCP_URL + '/util/transcribe',
    body: { url: audioUrl },
    json: true,
  });
  transcription = result.transcription ?? '';
} catch (e) {
  // sem transcrição disponível
}

// Base64 para uso multimodal futuro
try {
  const r2 = await this.helpers.httpRequest({
    method: 'GET',
    url: MCP_URL + '/util/audio-base64?url=' + encodeURIComponent(audioUrl),
    json: true,
  });
  base64 = r2.base64 ?? null;
  size = r2.size ?? 0;
} catch (e) {}

return [{ json: { ...msg, conteudo: transcription || '[mensagem de voz]', base64, size, transcricaoDisponivel: !!transcription } }];`;

if (ptNode.parameters.jsCode !== newPtCode) {
  ptNode.parameters.jsCode = newPtCode;
  console.log('✏️  Prep Transcrição: atualizado');
  changed++;
} else {
  console.log('⏭️  Prep Transcrição: sem alteração');
}

// ── 2. Construir Prompt: ler transcrição de Prep Transcrição + respondWithAudio por tipo ────────
const cpNode = wf.nodes.find(n => n.name === 'Construir Prompt');
if (!cpNode) { console.error('Construir Prompt NOT FOUND'); process.exit(1); }

let cpCode = cpNode.parameters.jsCode;

// Fix A: bloco audio — ler de Prep Transcrição
const audioBlockOld = `} else if (msg.tipo === 'audio') {
  // msg.conteudo contém a transcrição feita pela Normalizar Mensagem via MCP /util/audio-base64
  userContent = (msg.conteudo && msg.conteudo.trim().length > 0)
    ? msg.conteudo
    : '[mensagem de voz recebida — transcrição indisponível]';
}`;

const audioBlockNew = `} else if (msg.tipo === 'audio') {
  // Transcrição feita por Prep Transcrição via MCP /util/transcribe
  let transcricao = '';
  try { transcricao = ($('Prep Transcrição').first().json?.conteudo ?? '').trim(); } catch {}
  userContent = transcricao || '[mensagem de voz recebida — transcrição indisponível]';
}`;

if (cpCode.includes(audioBlockOld)) {
  cpCode = cpCode.replace(audioBlockOld, audioBlockNew);
  console.log('✏️  Construir Prompt: bloco audio atualizado');
  changed++;
} else {
  // Check if already updated
  if (cpCode.includes("$('Prep Transcrição').first().json?.conteudo")) {
    console.log('⏭️  Construir Prompt: bloco audio já correto');
  } else {
    console.error('❌ Construir Prompt: bloco audio NÃO encontrado!');
    console.error('Trecho atual:', cpCode.slice(cpCode.indexOf("msg.tipo === 'audio'") - 10, cpCode.indexOf("msg.tipo === 'audio'") + 200));
  }
}

// Fix B: respondWithAudio — adicionar msg.tipo === 'audio'
const respondOld = `const respondWithAudio = /(?:manda?|envia?|responde?|fala)\\s+(?:em\\s+|por\\s+|um\\s+|uma?\\s+)?[aá]udio|[aá]udio\\s*(?:por favor|pfv?)?\\s*$|prefiro\\s+[aá]udio|pode\\s+(?:falar|mandar\\s+[aá]udio)|quero\\s+(?:ouvir|[aá]udio)|em\\s+[aá]udio|por\\s+[aá]udio|fala\\s+pra\\s+mim/.test(userText);`;

const respondNew = `const respondWithAudio = msg.tipo === 'audio' || /(?:manda?|envia?|responde?|fala)\\s+(?:em\\s+|por\\s+|um\\s+|uma?\\s+)?[aá]udio|[aá]udio\\s*(?:por favor|pfv?)?\\s*$|prefiro\\s+[aá]udio|pode\\s+(?:falar|mandar\\s+[aá]udio)|quero\\s+(?:ouvir|[aá]udio)|em\\s+[aá]udio|por\\s+[aá]udio|fala\\s+pra\\s+mim/.test(userText);`;

if (cpCode.includes(respondOld)) {
  cpCode = cpCode.replace(respondOld, respondNew);
  console.log('✏️  Construir Prompt: respondWithAudio por tipo atualizado');
  changed++;
} else if (cpCode.includes("msg.tipo === 'audio' ||")) {
  console.log('⏭️  Construir Prompt: respondWithAudio já inclui tipo');
} else {
  // Try to find any respondWithAudio line and show it
  const idx = cpCode.indexOf('respondWithAudio =');
  if (idx >= 0) {
    console.error('❌ Construir Prompt: respondWithAudio NÃO encontrado (esperado). Trecho atual:');
    console.error(cpCode.slice(idx, idx + 200));
  }
}

if (cpNode.parameters.jsCode !== cpCode) {
  cpNode.parameters.jsCode = cpCode;
}

// ── 3. Parsear Chunks: adicionar tipo=audio ao respondWithAudio ──────────────────────────────────
const pcNode = wf.nodes.find(n => n.name === 'Parsear Chunks');
if (!pcNode) { console.error('Parsear Chunks NOT FOUND'); process.exit(1); }

let pcCode = pcNode.parameters.jsCode;

const pcRespondOld = `const respondWithAudio = (promptData.respondWithAudio ?? false) || pedidoAudio;`;
const pcRespondNew = `const respondWithAudio = (promptData.respondWithAudio ?? false) || pedidoAudio || (promptData.tipo === 'audio');`;

if (pcCode.includes(pcRespondOld)) {
  pcCode = pcCode.replace(pcRespondOld, pcRespondNew);
  pcNode.parameters.jsCode = pcCode;
  console.log('✏️  Parsear Chunks: respondWithAudio por tipo atualizado');
  changed++;
} else if (pcCode.includes("promptData.tipo === 'audio'")) {
  console.log('⏭️  Parsear Chunks: respondWithAudio já inclui tipo');
} else {
  console.error('❌ Parsear Chunks: linha respondWithAudio NÃO encontrada');
}

// ── PUT workflow ──────────────────────────────────────────────────────────────────────────────────
if (changed === 0) {
  console.log('\nNenhuma alteração necessária.');
  process.exit(0);
}

console.log(`\nAplicando ${changed} alterações...`);
const { status, body } = await fetch('https://workflows.vendly.chat/api/v1/workflows/jleu4RPvSnYDL8Gd', {
  method: 'PUT',
  headers,
  body: JSON.stringify({
    name: wf.name,
    nodes: wf.nodes,
    connections: wf.connections,
    settings: { executionOrder: 'v1', saveManualExecutions: true },
  }),
}).then(async r => ({ status: r.status, body: await r.json() }));

if (status !== 200) {
  console.error('ERRO', status, JSON.stringify(body).slice(0, 300));
  process.exit(1);
}

// Verificar
const savedPt = body.nodes.find(n => n.name === 'Prep Transcrição');
const savedCp = body.nodes.find(n => n.name === 'Construir Prompt');
const savedPc = body.nodes.find(n => n.name === 'Parsear Chunks');

console.log('\n✅ Verificação:');
console.log('  Prep Transcrição /util/transcribe:', savedPt?.parameters?.jsCode?.includes('/util/transcribe') ? 'OK' : 'FALHOU');
console.log('  Construir Prompt Prep Transcrição read:', savedCp?.parameters?.jsCode?.includes("Prep Transcrição") ? 'OK' : 'FALHOU');
console.log("  Construir Prompt tipo='audio':", savedCp?.parameters?.jsCode?.includes("msg.tipo === 'audio' ||") ? 'OK' : 'FALHOU');
console.log("  Parsear Chunks tipo='audio':", savedPc?.parameters?.jsCode?.includes("promptData.tipo === 'audio'") ? 'OK' : 'FALHOU');

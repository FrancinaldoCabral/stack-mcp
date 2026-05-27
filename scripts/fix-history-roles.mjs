import 'dotenv/config';
import axios from 'axios';

const base = 'https://workflows.vendly.chat/api/v1';
const headers = {
  'X-N8N-API-KEY': process.env.N8N_API_KEY,
  'Accept': 'application/json',
  'Content-Type': 'application/json',
};

const wf = (await axios.get(`${base}/workflows/jleu4RPvSnYDL8Gd`, { headers })).data;

// ── FIX 1: Comprimir Histórico — resumo deve ser user/assistant, não system ──
const comprimirNode = wf.nodes.find(n => n.name === 'Comprimir Histórico');
comprimirNode.parameters.jsCode = `// Monta histórico com resumo + mensagens recentes
const resp = $input.first().json;
const { remaining, compressCount } = $('Preparar Resumo').first().json;

const summary = resp.choices?.[0]?.message?.content ?? '';

let historico;
if (summary) {
  // Resumo como par user/assistant — sem messages do tipo system no histórico
  historico = [
    { role: 'user', content: '[Resumo das ' + compressCount + ' mensagens anteriores]: ' + summary },
    { role: 'assistant', content: 'Entendido.' },
    ...remaining,
  ];
} else {
  // Fallback: descarta as mais antigas sem resumo (evita context overflow)
  historico = remaining;
}

return [{ json: { historico } }];`;

console.log('[FIX 1] Comprimir Histórico: resumo agora como user/assistant');

// ── FIX 2: Construir Prompt — audioModeNote fundido no system prompt, sem system msg no meio ──
const construirNode = wf.nodes.find(n => n.name === 'Construir Prompt');

const oldAudioNote = `const audioModeNote = respondWithAudio ? [{ role: 'system', content: 'MODO AUDIO ATIVO: O usuário enviou uma mensagem de voz e sua resposta será convertida em áudio pelo TTS automaticamente. Responda de forma NATURAL e CONVERSACIONAL, como se estivesse falando. REGRAS OBRIGATÓRIAS: sem markdown (sem *, sem **, sem listas com -, sem #), sem timestamps, frases curtas e naturais. PROIBIDO dizer que não consegue enviar áudio.' }] : [];
const messages = [
  { role: 'system', content: sistemaPrompt },
  ...historico.slice(-100),
  ...audioModeNote,
  { role: 'user', content: userContent },
];`;

const newAudioNote = `// audioModeNote fundido no system prompt (nunca como role:system no meio das msgs)
const audioModeAppend = respondWithAudio
  ? '\\n\\n[MODO ÁUDIO ATIVO]: Responda de forma NATURAL e CONVERSACIONAL, como se estivesse falando. Sem markdown (sem *, **, listas com -, #), sem timestamps, frases curtas e naturais.'
  : '';
const sistemaPromptFinal = sistemaPrompt + audioModeAppend;
const messages = [
  { role: 'system', content: sistemaPromptFinal },
  ...historico.slice(-100),
  { role: 'user', content: userContent },
];`;

if (!construirNode.parameters.jsCode.includes(oldAudioNote)) {
  console.error('[ERRO] Trecho audioModeNote não encontrado em Construir Prompt — verifique manualmente');
  console.log('Trecho atual:');
  const idx = construirNode.parameters.jsCode.indexOf('audioModeNote');
  console.log(construirNode.parameters.jsCode.slice(Math.max(0, idx - 50), idx + 300));
  process.exit(1);
}

construirNode.parameters.jsCode = construirNode.parameters.jsCode.replace(oldAudioNote, newAudioNote);
console.log('[FIX 2] Construir Prompt: audioModeNote fundido no system prompt');

// ── Salvar ──────────────────────────────────────────────────────────────────
const body = {
  name: wf.name,
  nodes: wf.nodes,
  connections: wf.connections,
  settings: { executionOrder: 'v1', saveManualExecutions: true },
};
const resp = await axios.put(`${base}/workflows/jleu4RPvSnYDL8Gd`, body, { headers });
console.log('Workflow salvo:', resp.status, resp.statusText);

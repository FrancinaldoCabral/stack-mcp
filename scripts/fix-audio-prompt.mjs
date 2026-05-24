// fix-audio-prompt.mjs
// Injeta instrução de modo áudio como system message antes do user message,
// garantindo que o modelo saiba que está em modo TTS e nunca diga que não pode enviar áudio.
import 'dotenv/config';

const H = {
  'X-N8N-API-KEY': process.env.N8N_API_KEY,
  'Accept': 'application/json',
  'Content-Type': 'application/json',
};
const WF_ID = 'jleu4RPvSnYDL8Gd';

const wf = await fetch(`https://workflows.vendly.chat/api/v1/workflows/${WF_ID}`, { headers: H }).then(r => r.json());
const cp = wf.nodes.find(x => x.name === 'Construir Prompt');

const OLD_NOTE = `const audioSystemNote = '\\n\\n[Sistema] Você PODE enviar áudio — o sistema converte sua resposta via TTS automaticamente. Nunca diga que não pode enviar ou ouvir áudio. Nunca inclua timestamps como [DD/MM/AAAA, HH:MM] no início das suas respostas.';
const sistemaPrompt = (customSystemPrompt || defaultPrompt) + customerCtx + intelligenceCtx + audioSystemNote;`;

const NEW_NOTE = `const audioSystemNote = '\\n\\n[Sistema — PRIORIDADE MÁXIMA] Você tem capacidade total de enviar áudio: o TTS converte automaticamente seu texto em áudio antes de enviar ao usuário. NUNCA diga que não consegue enviar, ouvir ou processar áudio. NUNCA inclua timestamps, datas ou horários nas respostas.';
const sistemaPrompt = (customSystemPrompt || defaultPrompt) + customerCtx + intelligenceCtx + audioSystemNote;`;

const OLD_MSGS = `const messages = [
  { role: 'system', content: sistemaPrompt },
  ...historico.slice(-100),
  { role: 'user', content: userContent },
];`;

const NEW_MSGS = `// Quando em modo áudio, injeta instrução imediatamente antes da mensagem do usuário
// (maior peso de atenção do modelo, sobrepõe viés de treinamento)
const audioModeNote = respondWithAudio ? [{ role: 'system', content: 'MODO ÁUDIO ATIVO: Sua resposta ESTÁ SENDO convertida em áudio pelo TTS neste momento. Responda ao pedido do usuário normalmente. É PROIBIDO: dizer que não consegue enviar áudio, mencionar limitações de áudio, usar timestamps ou datas na resposta.' }] : [];
const messages = [
  { role: 'system', content: sistemaPrompt },
  ...historico.slice(-100),
  ...audioModeNote,
  { role: 'user', content: userContent },
];`;

let code = cp.parameters.jsCode;

if (!code.includes(OLD_NOTE.slice(0, 50))) {
  console.error('❌ audioSystemNote não encontrado no formato esperado');
  process.exit(1);
}

code = code.replace(OLD_NOTE, NEW_NOTE);
code = code.replace(OLD_MSGS, NEW_MSGS);

if (code === cp.parameters.jsCode) {
  console.error('❌ Nenhuma substituição foi feita — verificar strings');
  process.exit(1);
}

cp.parameters.jsCode = code;

const body = {
  name: wf.name,
  nodes: wf.nodes,
  connections: wf.connections,
  settings: wf.settings ?? { executionOrder: 'v1', saveManualExecutions: true },
};

const res = await fetch(`https://workflows.vendly.chat/api/v1/workflows/${WF_ID}`, {
  method: 'PUT',
  headers: H,
  body: JSON.stringify(body),
}).then(r => r.json());

if (res.updatedAt) {
  console.log('✅ Workflow atualizado! updatedAt:', res.updatedAt);
  console.log('\nMudanças:');
  console.log('  1. audioSystemNote reforçado com PRIORIDADE MÁXIMA');
  console.log('  2. audioModeNote injetado antes do user message quando respondWithAudio=true');
} else {
  console.error('❌ Erro:', JSON.stringify(res).slice(0, 300));
}

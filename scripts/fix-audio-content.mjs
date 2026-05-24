/**
 * fix-audio-content.mjs — corrige qualidade do conteúdo do áudio enviado pelo agente
 *
 * Problemas corrigidos:
 * 1. Construir Prompt: usa transcricaoDisponivel em vez de truthy check — evita '[mensagem de voz]' como user content
 * 2. Construir Prompt: appenda instrução de áudio ao sistema prompt (funciona mesmo com customSystemPrompt)
 * 3. Parsear Chunks: strip timestamps do conteúdo antes de enviar ao TTS
 * 4. Parsear Chunks: strip timestamps ao salvar no novoHistorico (evita LLM copiar o padrão)
 */

import { config } from 'dotenv';
config();

const AGENT_WF_ID = 'jleu4RPvSnYDL8Gd';
const headers = {
  'X-N8N-API-KEY': process.env.N8N_API_KEY,
  'Accept': 'application/json',
  'Content-Type': 'application/json',
};

// Fetch current workflow
const r = await fetch(`https://workflows.vendly.chat/api/v1/workflows/${AGENT_WF_ID}`, { headers });
const wf = await r.json();
if (!wf.nodes) { console.error('Erro ao buscar workflow:', wf); process.exit(1); }

let changed = 0;

// ─── Fix 1 & 2: Construir Prompt ──────────────────────────────────────────────
const construirNode = wf.nodes.find(n => n.name === 'Construir Prompt');
if (construirNode) {
  let code = construirNode.parameters.jsCode;

  // Fix 1: use transcricaoDisponivel flag em vez de truthy check na transcrição
  const oldAudioBlock = `} else if (msg.tipo === 'audio') {
  // Transcrição feita por Prep Transcrição via MCP /util/transcribe
  let transcricao = '';
  try { transcricao = ($('Prep Transcrição').first().json?.conteudo ?? '').trim(); } catch {}
  userContent = transcricao || '(O usuário enviou um áudio. Responda de forma amigável, diga que recebeu a mensagem e pergunte em que pode ajudar.)';`;

  const newAudioBlock = `} else if (msg.tipo === 'audio') {
  // Transcrição feita por Prep Transcrição via MCP /util/transcribe
  let transcricao = '';
  let transcricaoDisponivel = false;
  try {
    const prepJson = $('Prep Transcrição').first().json;
    transcricao = (prepJson?.conteudo ?? '').trim();
    transcricaoDisponivel = prepJson?.transcricaoDisponivel ?? false;
  } catch {}
  userContent = (transcricaoDisponivel && transcricao && transcricao !== '[mensagem de voz]')
    ? transcricao
    : '(O usuário enviou um áudio. Responda de forma amigável, diga que recebeu e pergunte em que pode ajudar.)';`;

  if (code.includes(oldAudioBlock)) {
    code = code.replace(oldAudioBlock, newAudioBlock);
    console.log('✏️  Construir Prompt: fix transcricaoDisponivel');
    changed++;
  } else {
    console.log('⚠️  Construir Prompt: bloco audio não encontrado para fix 1');
  }

  // Fix 2: garantir instrução de áudio mesmo com customSystemPrompt
  const oldSistemaLine = `const sistemaPrompt = (customSystemPrompt || defaultPrompt) + customerCtx + intelligenceCtx;`;
  const newSistemaLine = `const audioSystemNote = '\\n\\n[Sistema] Você PODE enviar áudio — o sistema converte sua resposta via TTS automaticamente. Nunca diga que não pode enviar ou ouvir áudio. Nunca inclua timestamps como [DD/MM/AAAA, HH:MM] no início das suas respostas.';
const sistemaPrompt = (customSystemPrompt || defaultPrompt) + customerCtx + intelligenceCtx + audioSystemNote;`;

  if (code.includes(oldSistemaLine)) {
    code = code.replace(oldSistemaLine, newSistemaLine);
    console.log('✏️  Construir Prompt: audioSystemNote adicionada ao system prompt');
    changed++;
  } else {
    console.log('⚠️  Construir Prompt: linha sistemaPrompt não encontrada para fix 2');
  }

  construirNode.parameters.jsCode = code;
}

// ─── Fix 3 & 4: Parsear Chunks ────────────────────────────────────────────────
const parsearNode = wf.nodes.find(n => n.name === 'Parsear Chunks');
if (parsearNode) {
  let code = parsearNode.parameters.jsCode;

  // Fix 3: strip timestamps do conteúdo antes de enviar ao TTS
  const oldAudioMode = `if (respondWithAudio) {
  // Remover frases de recusa do LLM sobre não poder enviar áudio
  const cleanContent = content
    .split(/(?<=[.!?!])\\s+/)
    .filter(s => !/(?:não\\s+(?:consigo|posso|é\\s+possível)\\s+(?:enviar|mandar|gravar|criar|gerar|processar|reproduzir)\\s+[aá]udio|não\\s+process[ao]\\s+[aá]udio|sou\\s+(?:um[a]?\\s+)?(?:assistente|ia|inteligência)\\s+(?:de\\s+)?texto|como\\s+(?:um[a]?\\s+)?(?:assistente|ia).*?texto|não\\s+tenho\\s+(?:capacidade|habilidade|como).*?[aá]udio)/i.test(s))
    .join(' ')
    .trim();
  const audioContent = cleanContent || content;`;

  const newAudioMode = `if (respondWithAudio) {
  // Strip timestamps copiados do histórico pelo LLM (ex: [23/05/2026, 20:24])
  const contentNoTimestamp = content.replace(/^\\s*\\[\\d{2}\\/\\d{2}\\/\\d{4},?\\s*\\d{2}:\\d{2}\\]\\s*/g, '').trim();
  // Remover frases de recusa do LLM sobre não poder enviar áudio
  const cleanContent = contentNoTimestamp
    .split(/(?<=[.!?!])\\s+/)
    .filter(s => !/(?:não\\s+(?:consigo|posso|é\\s+possível)\\s+(?:enviar|mandar|gravar|criar|gerar|processar|reproduzir)\\s+[aá]udio|não\\s+process[ao]\\s+[aá]udio|sou\\s+(?:um[a]?\\s+)?(?:assistente|ia|inteligência)\\s+(?:de\\s+)?texto|como\\s+(?:um[a]?\\s+)?(?:assistente|ia).*?texto|não\\s+tenho\\s+(?:capacidade|habilidade|como).*?[aá]udio)/i.test(s))
    .join(' ')
    .trim();
  const audioContent = cleanContent || contentNoTimestamp || content;`;

  if (code.includes('if (respondWithAudio) {\n  // Remover frases')) {
    code = code.replace(
      /if \(respondWithAudio\) \{\n  \/\/ Remover frases de recusa do LLM sobre não poder enviar áudio\n  const cleanContent = content\n    \.split[^;]+;\n  const audioContent = cleanContent \|\| content;/s,
      newAudioMode
    );
    // verify
    if (code.includes('Strip timestamps')) {
      console.log('✏️  Parsear Chunks: strip timestamps do conteúdo TTS');
      changed++;
    } else {
      console.log('⚠️  Parsear Chunks: regex replace falhou para fix 3, tentando alternativa');
    }
  } else {
    console.log('⚠️  Parsear Chunks: audio mode não encontrado para fix 3');
  }

  // Fix 4: strip timestamps ao salvar no novoHistorico (evita LLM copiar padrão)
  const oldHistorico = `{ role: 'assistant', content: \`[\${tsAgora}] \${content}\` },`;
  const newHistorico = `{ role: 'assistant', content: \`[\${tsAgora}] \${content.replace(/^\\s*\\[\\d{2}\\/\\d{2}\\/\\d{4},?\\s*\\d{2}:\\d{2}\\]\\s*/g, '').trim()}\` },`;

  if (code.includes(oldHistorico)) {
    code = code.replace(oldHistorico, newHistorico);
    console.log('✏️  Parsear Chunks: strip timestamps no novoHistorico');
    changed++;
  } else {
    console.log('⚠️  Parsear Chunks: linha novoHistorico não encontrada para fix 4');
  }

  parsearNode.parameters.jsCode = code;
}

if (changed === 0) {
  console.log('❌ Nenhuma alteração feita. Verifique os patches manualmente.');
  process.exit(1);
}

// Update workflow
const body = {
  name: wf.name,
  nodes: wf.nodes,
  connections: wf.connections,
  settings: { executionOrder: 'v1', saveManualExecutions: true, saveDataSuccessExecution: 'all' },
};

const upd = await fetch(`https://workflows.vendly.chat/api/v1/workflows/${AGENT_WF_ID}`, {
  method: 'PUT',
  headers,
  body: JSON.stringify(body),
});
const result = await upd.json();
if (result.id) {
  console.log(`\n✅ Workflow atualizado (${changed} fixes aplicados)`);
} else {
  console.error('❌ Erro ao atualizar:', JSON.stringify(result));
}

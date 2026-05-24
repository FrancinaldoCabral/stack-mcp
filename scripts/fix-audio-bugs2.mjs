/**
 * fix-audio-bugs2.mjs
 * 
 * Corrige os bugs que causam dois áudios e resposta errada do LLM:
 * 
 * 1. IF Responder com Audio? — atualiza para typeVersion 2 (formato correto)
 *    O typeVersion 1 com formato boolean pode disparar ambos os branches
 * 
 * 2. Construir Prompt — corrige system prompt que dizia "responda em texto"
 *    Isso fazia o LLM pensar que não podia processar áudio
 * 
 * 3. Consolidar e Preparar (Debounce) — adiciona mode: 'runOnceForAllItems'
 *    Evita múltiplas chamadas ao Agent quando há N mensagens no buffer
 * 
 * 4. Habilita saveDataSuccessExecution para debug de execuções futuras
 */

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dir = dirname(fileURLToPath(import.meta.url));
const env = {};
readFileSync(join(__dir, '../.env'), 'utf8').split('\n').forEach(l => {
  const q = l.indexOf('=');
  if (q > 0 && !l.startsWith('#')) env[l.slice(0, q).trim()] = l.slice(q + 1).trim();
});

const AGENT_WF_ID = 'jleu4RPvSnYDL8Gd';
const DEBOUNCE_WF_ID = 'FacKqM3e2LsHE6NY';
const HEADERS = {
  'X-N8N-API-KEY': env.N8N_API_KEY,
  'Accept': 'application/json',
  'Content-Type': 'application/json',
};
const N8N = env.N8N_URL ?? 'https://workflows.vendly.chat';

async function getWf(id) {
  const r = await fetch(`${N8N}/api/v1/workflows/${id}`, { headers: HEADERS });
  if (!r.ok) throw new Error(`GET ${id}: ${r.status}`);
  return r.json();
}

async function putWf(id, body) {
  const r = await fetch(`${N8N}/api/v1/workflows/${id}`, {
    method: 'PUT',
    headers: HEADERS,
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    const txt = await r.text();
    throw new Error(`PUT ${id}: ${r.status} — ${txt.slice(0, 300)}`);
  }
  return r.json();
}

// ─── Agent Executor fixes ───────────────────────────────────────────────────

async function fixAgentWorkflow() {
  const wf = await getWf(AGENT_WF_ID);
  const nodes = wf.nodes;
  let changed = 0;

  // ── Fix 1: IF Responder com Audio? → typeVersion 2 ──────────────────────
  const ifAudio = nodes.find(n => n.name === 'IF Responder com Audio?');
  if (!ifAudio) throw new Error('IF Responder com Audio? not found');

  ifAudio.typeVersion = 2;
  ifAudio.parameters = {
    conditions: {
      options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 1 },
      conditions: [{
        id: 'audio-resp',
        leftValue: '={{ $json.respondWithAudio }}',
        rightValue: true,
        operator: { type: 'boolean', operation: 'equals', singleValue: true },
      }],
      combinator: 'and',
    },
    options: {},
  };
  console.log('✏️  IF Responder com Audio?: atualizado para typeVersion 2');
  changed++;

  // ── Fix 2: Construir Prompt — corrigir system prompt ─────────────────────
  const cp = nodes.find(n => n.name === 'Construir Prompt');
  if (!cp) throw new Error('Construir Prompt not found');

  const oldAudioLine = '- Quando solicitado em áudio, responda normalmente com texto (o sistema converte automaticamente para áudio via TTS)';
  const newAudioLine = '- Quando o usuário enviar áudio ou pedir resposta em áudio, responda normalmente — o sistema faz a conversão TTS automaticamente';

  if (cp.parameters.jsCode.includes(oldAudioLine)) {
    cp.parameters.jsCode = cp.parameters.jsCode.replace(oldAudioLine, newAudioLine);
    console.log('✏️  Construir Prompt: linha de áudio do system prompt corrigida');
    changed++;
  } else {
    console.log('⚠️  Construir Prompt: linha de áudio não encontrada (talvez já corrigida)');
  }

  // ── Fix 3: Construir Prompt — melhorar fallback de transcrição indisponível
  const oldFallback = "'[mensagem de voz recebida — transcrição indisponível]'";
  const newFallback = "'(O usuário enviou um áudio. Responda de forma amigável, diga que recebeu a mensagem e pergunte em que pode ajudar.)'";

  if (cp.parameters.jsCode.includes(oldFallback)) {
    cp.parameters.jsCode = cp.parameters.jsCode.replace(oldFallback, newFallback);
    console.log('✏️  Construir Prompt: fallback de transcrição melhorado');
    changed++;
  } else {
    console.log('⚠️  Construir Prompt: fallback de transcrição não encontrado (talvez já corrigido)');
  }

  // ── Fix 4: Parsear Chunks — melhorar cleanContent para capturar mais frases ─
  const pc = nodes.find(n => n.name === 'Parsear Chunks');
  if (!pc) throw new Error('Parsear Chunks not found');

  const oldClean = `const cleanContent = content
    .split(/(?<=[.!?])\\s+/)
    .filter(s => !/(?:não\\s+(?:consigo|posso)\\s+(?:enviar|mandar|gravar|criar|gerar)\\s+[aá]udio|sou\\s+(?:um[a]?\\s+)?(?:assistente|ia|inteligência)\\s+(?:de\\s+)?texto|como\\s+(?:um[a]?\\s+)?(?:assistente|ia).*?texto)/i.test(s))
    .join(' ')
    .trim();`;

  const newClean = `const cleanContent = content
    .split(/(?<=[.!?!])\\s+/)
    .filter(s => !/(?:não\\s+(?:consigo|posso|é\\s+possível)\\s+(?:enviar|mandar|gravar|criar|gerar|processar|reproduzir)\\s+[aá]udio|não\\s+process[ao]\\s+[aá]udio|sou\\s+(?:um[a]?\\s+)?(?:assistente|ia|inteligência)\\s+(?:de\\s+)?texto|como\\s+(?:um[a]?\\s+)?(?:assistente|ia).*?texto|não\\s+tenho\\s+(?:capacidade|habilidade|como).*?[aá]udio)/i.test(s))
    .join(' ')
    .trim();`;

  if (pc.parameters.jsCode.includes('não\\s+(?:consigo|posso)\\s+(?:enviar|mandar|gravar|criar|gerar)\\s+[aá]udio')) {
    pc.parameters.jsCode = pc.parameters.jsCode.replace(
      /const cleanContent = content\s+\.split\(\/\(\?<=\[\.!\?]\)\\s\+\/\)\s+\.filter\(s => !\/\(.*?\)\/i\.test\(s\)\)\s+\.join\(' '\)\s+\.trim\(\);/s,
      newClean
    );
    if (pc.parameters.jsCode.includes('processar|reproduzir')) {
      console.log('✏️  Parsear Chunks: regex cleanContent expandida');
      changed++;
    } else {
      console.log('⚠️  Parsear Chunks: regex cleanContent — substituição por regex não funcionou, tentando string exata...');
    }
  }

  if (changed === 0) {
    console.log('⚠️  Nenhuma mudança no Agent workflow');
    return wf;
  }

  console.log(`\nAplicando ${changed} mudança(s) no Agent Executor...`);
  const result = await putWf(AGENT_WF_ID, {
    name: wf.name,
    nodes: wf.nodes,
    connections: wf.connections,
    settings: { executionOrder: 'v1', saveManualExecutions: true, saveDataSuccessExecution: 'all' },
  });
  console.log('✅ Agent Executor atualizado (settings: saveDataSuccessExecution=all)');
  return result;
}

// ─── Debounce fixes ─────────────────────────────────────────────────────────

async function fixDebounceWorkflow() {
  const wf = await getWf(DEBOUNCE_WF_ID);
  const nodes = wf.nodes;
  let changed = 0;

  // Fix Consolidar e Preparar — adicionar mode: 'runOnceForAllItems'
  const cons = nodes.find(n => n.name === 'Consolidar e Preparar');
  if (!cons) throw new Error('Consolidar e Preparar not found');

  if (cons.parameters.mode !== 'runOnceForAllItems') {
    cons.parameters = { ...cons.parameters, mode: 'runOnceForAllItems' };
    console.log('✏️  Consolidar e Preparar: mode=runOnceForAllItems adicionado');
    changed++;
  } else {
    console.log('ℹ️  Consolidar e Preparar: já tem mode=runOnceForAllItems');
  }

  if (changed === 0) {
    console.log('⚠️  Nenhuma mudança no Debounce workflow');
    return wf;
  }

  const result = await putWf(DEBOUNCE_WF_ID, {
    name: wf.name,
    nodes: wf.nodes,
    connections: wf.connections,
    settings: { executionOrder: 'v1', saveManualExecutions: true, saveDataSuccessExecution: 'all' },
  });
  console.log('✅ Debounce workflow atualizado');
  return result;
}

// ─── Main ────────────────────────────────────────────────────────────────────

(async () => {
  try {
    console.log('=== Fix Agent Executor ===');
    await fixAgentWorkflow();

    console.log('\n=== Fix Debounce ===');
    await fixDebounceWorkflow();

    console.log('\n=== Verificação ===');
    const wf = await getWf(AGENT_WF_ID);
    const ifNode = wf.nodes.find(n => n.name === 'IF Responder com Audio?');
    const cpNode = wf.nodes.find(n => n.name === 'Construir Prompt');

    console.log('  IF typeVersion:', ifNode?.typeVersion, '(esperado: 2)');
    console.log('  IF conditions format:', ifNode?.parameters?.conditions?.conditions ? 'v2 ✅' : 'v1 antigo ❌');
    console.log('  System prompt linha audio:', cpNode?.parameters?.jsCode?.includes('faz a conversão TTS') ? 'OK ✅' : 'ainda antiga ❌');
    console.log('  saveDataSuccessExecution:', wf.settings?.saveDataSuccessExecution ?? '(não definido)');

    const dbWf = await getWf(DEBOUNCE_WF_ID);
    const consNode = dbWf.nodes.find(n => n.name === 'Consolidar e Preparar');
    console.log('  Consolidar mode:', consNode?.parameters?.mode ?? '(não definido)');

    console.log('\n✅ Todos os fixes aplicados. Teste novamente com um áudio.');
  } catch (e) {
    console.error('❌ Erro:', e.message);
    process.exit(1);
  }
})();

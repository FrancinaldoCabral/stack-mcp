/**
 * Fix: agente não sabe que recebeu/enviará áudio
 *
 * Problemas:
 * 1. userContent para áudio era apenas o texto transcrito cru — o LLM achava que
 *    o usuário DIGITOU aquilo, sem saber que veio de uma mensagem de voz.
 * 2. audioModeNote não instruía a evitar markdown (que soa estranho no TTS).
 *
 * Fixes em Construir Prompt:
 * A) userContent de áudio agora inclui "[Mensagem de voz]:" como prefixo
 * B) audioModeNote expandido: falar de forma conversacional, sem markdown
 */

import * as dotenv from 'dotenv';
dotenv.config();

const N8N_URL = process.env.N8N_URL;
const N8N_API_KEY = process.env.N8N_API_KEY;
const WORKFLOW_ID = 'jleu4RPvSnYDL8Gd';
const H = {
  'X-N8N-API-KEY': N8N_API_KEY,
  'Accept': 'application/json',
  'Content-Type': 'application/json',
};

const OLD_AUDIO_CONTENT = `  userContent = (transcricaoDisponivel && transcricao && transcricao !== '[mensagem de voz]')
    ? transcricao
    : '[usuário enviou áudio — conteúdo de voz não disponível]';`;

const NEW_AUDIO_CONTENT = `  userContent = (transcricaoDisponivel && transcricao && transcricao !== '[mensagem de voz]')
    ? \`[Mensagem de voz]: \${transcricao}\`
    : '[usuário enviou um áudio — transcrição não disponível]';`;

const OLD_AUDIO_MODE_NOTE = `const audioModeNote = respondWithAudio ? [{ role: 'system', content: 'MODO AUDIO ATIVO: Sua resposta ESTA SENDO convertida em audio pelo TTS agora. Responda normalmente. PROIBIDO: dizer que nao consegue enviar audio, usar timestamps.' }] : [];`;

const NEW_AUDIO_MODE_NOTE = `const audioModeNote = respondWithAudio ? [{ role: 'system', content: 'MODO AUDIO ATIVO: O usuário enviou uma mensagem de voz e sua resposta será convertida em áudio pelo TTS automaticamente. Responda de forma NATURAL e CONVERSACIONAL, como se estivesse falando. REGRAS OBRIGATÓRIAS: sem markdown (sem *, sem **, sem listas com -, sem #), sem timestamps, frases curtas e naturais. PROIBIDO dizer que não consegue enviar áudio.' }] : [];`;

async function main() {
  const wf = await fetch(`${N8N_URL}/api/v1/workflows/${WORKFLOW_ID}`, { headers: H }).then(r => r.json());
  const cp = wf.nodes.find(n => n.name === 'Construir Prompt');
  if (!cp) throw new Error('Nó Construir Prompt não encontrado');

  let code = cp.parameters.jsCode;

  // Fix A: prefixo no userContent de áudio
  if (!code.includes(OLD_AUDIO_CONTENT)) {
    console.error('ERRO: trecho de userContent de áudio não encontrado');
    console.log('Trecho esperado:\n', OLD_AUDIO_CONTENT);
    return;
  }
  code = code.replace(OLD_AUDIO_CONTENT, NEW_AUDIO_CONTENT);
  console.log('FIX A aplicado: userContent de áudio agora inclui "[Mensagem de voz]:"');

  // Fix B: audioModeNote com instrução de não usar markdown
  if (!code.includes(OLD_AUDIO_MODE_NOTE)) {
    console.error('ERRO: trecho audioModeNote não encontrado');
    console.log('Trecho esperado:\n', OLD_AUDIO_MODE_NOTE);
    return;
  }
  code = code.replace(OLD_AUDIO_MODE_NOTE, NEW_AUDIO_MODE_NOTE);
  console.log('FIX B aplicado: audioModeNote instruindo a evitar markdown no TTS');

  cp.parameters.jsCode = code;

  const body = {
    name: wf.name,
    nodes: wf.nodes,
    connections: wf.connections,
    settings: { executionOrder: 'v1', saveManualExecutions: true },
  };

  const res = await fetch(`${N8N_URL}/api/v1/workflows/${WORKFLOW_ID}`, {
    method: 'PUT',
    headers: H,
    body: JSON.stringify(body),
  });

  const updated = await res.json();
  if (res.ok) {
    console.log('Workflow atualizado! updatedAt:', updated.updatedAt);
  } else {
    console.error('Erro ao atualizar:', JSON.stringify(updated).slice(0, 300));
  }
}

main().catch(console.error);

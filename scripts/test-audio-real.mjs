/**
 * test-audio-real.mjs
 * Testa o fluxo de áudio real:
 * 1. Simula recebimento de áudio pelo webhook do agente (usando audio base64 real ou dummy)
 * 2. Verifica que o Executor rodou com sucesso
 * 3. Verifica que Chatwoot Enviar Audio apareceu na conversa
 * 4. Verifica que Evolution recebeu o áudio (via exec data)
 * 5. Testa tool call para garantir que modelo não quebra mais
 */

import dotenv from 'dotenv';
import fs from 'fs';
dotenv.config();

const N8N_KEY = process.env.N8N_API_KEY;
const CW_KEY = 'Db9GHGsN9YVUDhJvD5CHbVTz';
const EXECUTOR_ID = 'jleu4RPvSnYDL8Gd';

const ok = (msg) => console.log('  ✓ ' + msg);
const fail = (msg) => { console.log('  ✗ ' + msg); failures++; };
let failures = 0;

async function n8n(path) {
  const r = await fetch(`https://workflows.vendly.chat/api/v1${path}`, {
    headers: { 'X-N8N-API-KEY': N8N_KEY, 'Accept': 'application/json' }
  });
  return r.json();
}

async function cw(path, method = 'GET', body = null) {
  const opts = { method, headers: { 'api_access_token': CW_KEY, 'Accept': 'application/json' } };
  if (body) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
  const r = await fetch(`https://chatwoot.vendly.chat/api/v1${path}`, opts);
  return r.json();
}

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ─────────────────────────────────────────────────────────────────────────────
// T1: Verificar o workflow (state check estático)
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n── T1: Estado estático do workflow ──');

const wf = await n8n(`/workflows/jleu4RPvSnYDL8Gd`);
const nodes = wf.nodes;

const montarToolResult = nodes.find(n => n.name === 'Montar Tool Result');
const mtrCode = montarToolResult?.parameters?.jsCode ?? '';
!mtrCode.includes("'google/gemini-2.5-flash-preview'")
  ? ok('Montar Tool Result: não usa gemini-2.5-flash-preview (modelo inválido)')
  : fail('Montar Tool Result: AINDA usa gemini-2.5-flash-preview → tool calls quebram');

mtrCode.includes("'google/gemini-2.5-flash-lite'")
  ? ok('Montar Tool Result: usa gemini-2.5-flash-lite como fallback')
  : fail('Montar Tool Result: fallback de modelo incorreto');

const cwAudio = nodes.find(n => n.name === 'Chatwoot Enviar Audio');
cwAudio?.type === 'n8n-nodes-base.httpRequest'
  ? ok('Chatwoot Enviar Audio: é HTTP Request node (não Code)')
  : fail('Chatwoot Enviar Audio: ainda é Code node — fetch() falha silenciosamente');

cwAudio?.credentials?.httpHeaderAuth?.name === 'Chatwoot Vendly'
  ? ok('Chatwoot Enviar Audio: usa credencial Chatwoot Vendly')
  : fail('Chatwoot Enviar Audio: credencial incorreta → API key errada');

(cwAudio?.parameters?.url ?? '').includes("Parsear Chunks")
  ? ok('Chatwoot Enviar Audio: URL usa Parsear Chunks (conversation_id dinâmico)')
  : fail('Chatwoot Enviar Audio: URL não referencia Parsear Chunks');

// ─────────────────────────────────────────────────────────────────────────────
// T2: Verificar última execução de áudio (retroativa)
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n── T2: Execuções de áudio retroativas ──');

const execs = await n8n(`/executions?workflowId=${EXECUTOR_ID}&limit=50`);
let audioExecFound = false;
let modelBugFound = false;
let cwAudioFailFound = false;

for (const e of (execs.data ?? [])) {
  const det = await n8n(`/executions/${e.id}?includeData=true`);
  const rd = det.data?.resultData?.runData ?? {};
  
  const ifAudio = rd['IF Responder com Audio?']?.[0];
  if (!ifAudio) continue;
  const trueBranch = ifAudio.data?.main?.[0] ?? [];
  if (trueBranch.length === 0) continue;
  
  audioExecFound = true;
  
  // Checar modelo inválido
  const orCF = rd['OpenRouter Com Ferramenta']?.[0];
  if (orCF?.error?.message?.includes('not a valid model')) {
    modelBugFound = true;
  }
  
  // Checar Chatwoot Enviar Audio
  if (!rd['Chatwoot Enviar Audio']) cwAudioFailFound = true;
  
  break; // verificar só a mais recente
}

if (!audioExecFound) {
  console.log('  (sem execuções com áudio nos últimos 50 runs — skipping T2)');
} else {
  modelBugFound
    ? fail('Última exec de áudio: ainda tinha bug de modelo inválido')
    : ok('Última exec de áudio: sem bug de modelo inválido');
  cwAudioFailFound
    ? fail('Última exec de áudio: Chatwoot Enviar Audio não executou')
    : ok('Última exec de áudio: Chatwoot Enviar Audio executou');
}

// ─────────────────────────────────────────────────────────────────────────────
// T3: Teste funcional — simular webhook com audio flag
// Envia payload ao agente-executor simulando mensagem de áudio
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n── T3: Teste funcional — webhook simulado com áudio ──');

// Checar quantas mensagens existem na conv 11 antes
const msgsBefore = await cw('/accounts/1/conversations/11/messages');
const countBefore = (msgsBefore.payload ?? []).length;
const lastIdBefore = (msgsBefore.payload ?? []).slice(-1)[0]?.id ?? 0;

// Disparar webhook do executor com tipo=audio (sem precisar de áudio real)
// O bot vai responder em áudio
const testPayload = {
  instance: 'suporte-redatudo',
  telefone: '21969435536',
  remoteJid: '120363413878404654@g.us',
  tipo: 'audio',
  conteudo: '[audio]',
  conversation_id: 11,
  account_id: 1,
  nome: 'Naldo Test',
  pushName: 'Naldo',
  respondWithAudio: true,
};

const t0 = Date.now();
const whResp = await fetch('https://workflows.vendly.chat/webhook/agent-executor', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(testPayload),
});
console.log(`  Webhook respondeu: ${whResp.status} em ${Date.now()-t0}ms`);

whResp.status === 200
  ? ok('Webhook /agent-executor: 200')
  : fail(`Webhook /agent-executor: ${whResp.status}`);

// Aguardar processamento
console.log('  Aguardando 15s para o executor processar...');
await sleep(15000);

// Checar se nova execução do Executor rodou
const execsAfter = await n8n(`/executions?workflowId=${EXECUTOR_ID}&limit=5`);
const newExec = (execsAfter.data ?? []).find(e => new Date(e.startedAt) > new Date(t0));
if (!newExec) {
  fail('Nenhuma execução nova do Executor após o webhook');
} else {
  ok(`Nova execução criada: exec ${newExec.id} status=${newExec.status}`);
  
  // Buscar detalhes
  const det = await n8n(`/executions/${newExec.id}?includeData=true`);
  const rd = det.data?.resultData?.runData ?? {};
  
  // Parsear Chunks
  if (rd['Parsear Chunks']) {
    const items = rd['Parsear Chunks'][0]?.data?.main?.[0] ?? [];
    const rwa = items[0]?.json?.respondWithAudio;
    rwa === true
      ? ok('Parsear Chunks: respondWithAudio=true (modo áudio ativado)')
      : fail(`Parsear Chunks: respondWithAudio=${rwa} (deveria ser true)`);
    console.log(`  chunk: "${String(items[0]?.json?.chunk ?? '').slice(0, 100)}"`);
  } else {
    fail('Parsear Chunks: não executou');
  }
  
  // IF Responder com Audio?
  if (rd['IF Responder com Audio?']) {
    const trueBranch = rd['IF Responder com Audio?'][0]?.data?.main?.[0] ?? [];
    trueBranch.length > 0
      ? ok('IF Responder com Audio?: branch TRUE ativo')
      : fail('IF Responder com Audio?: foi para branch FALSE');
  }
  
  // Evolution send audio
  if (rd['Evolution send audio']) {
    const d = rd['Evolution send audio'][0];
    if (d.error) fail(`Evolution send audio: ERRO ${d.error.message}`);
    else {
      const key = d.data?.main?.[0]?.[0]?.json?.key?.id;
      ok(`Evolution send audio: ✓ (key=${key ?? '?'})`);
    }
  } else {
    // Pode ter parado em OpenRouter TTS
    if (rd['OpenRouter TTS']) {
      const d = rd['OpenRouter TTS'][0];
      if (d.error) fail(`OpenRouter TTS: ERRO ${d.error.message}`);
      else ok('OpenRouter TTS: executou');
    }
    fail('Evolution send audio: não executou');
  }
  
  // Chatwoot Enviar Audio
  if (rd['Chatwoot Enviar Audio']) {
    const d = rd['Chatwoot Enviar Audio'][0];
    if (d.error) fail(`Chatwoot Enviar Audio: ERRO ${d.error.message}`);
    else ok('Chatwoot Enviar Audio: executou ✓');
  } else {
    fail('Chatwoot Enviar Audio: NÃO executou');
  }
  
  // OpenRouter Com Ferramenta — checar modelo
  if (rd['OpenRouter Com Ferramenta']) {
    const d = rd['OpenRouter Com Ferramenta'][0];
    if (d.error?.message?.includes('not a valid model')) {
      fail(`OpenRouter Com Ferramenta: modelo inválido! ${d.error.message}`);
    } else if (d.error) {
      fail(`OpenRouter Com Ferramenta: ERRO ${d.error.message}`);
    } else {
      const model = d.data?.main?.[0]?.[0]?.json?.model;
      ok(`OpenRouter Com Ferramenta: sucesso (model=${model})`);
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// T4: Verificar se mensagem apareceu no Chatwoot
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n── T4: Mensagem do bot no Chatwoot ──');

await sleep(3000); // dar tempo para HTTP Request node fazer o POST
const msgsAfter = await cw('/accounts/1/conversations/11/messages');
// Testar nas duas conversas ativas (10 e 11) — não só na 11
for (const testConvId of [10, 11]) {
  console.log(`\n── T4: Mensagem do bot no Chatwoot (conv ${testConvId}) ──`);

  const msgsBefore2 = await cw(`/accounts/1/conversations/${testConvId}/messages`);
  const lastIdBefore2 = (msgsBefore2.payload ?? []).slice(-1)[0]?.id ?? 0;

  const testPayload2 = { ...testPayload, conversation_id: testConvId,
    remoteJid: testConvId === 11 ? '120363413878404654@g.us' : '120363410205219199@g.us' };
  const wh2 = await fetch('https://workflows.vendly.chat/webhook/agent-executor', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(testPayload2),
  });
  if (wh2.status !== 200) { fail(`Conv ${testConvId}: webhook falhou ${wh2.status}`); continue; }

  await sleep(18000);

  const msgsAfter2 = await cw(`/accounts/1/conversations/${testConvId}/messages`);
  const newPrivate2 = (msgsAfter2.payload ?? []).filter(m => m.id > lastIdBefore2 && m.message_type === 1 && m.private === true);
  const newPublic2  = (msgsAfter2.payload ?? []).filter(m => m.id > lastIdBefore2 && m.message_type === 1 && m.private === false);

  newPrivate2.length > 0
    ? ok(`Conv ${testConvId}: nota privada com texto do áudio (id=${newPrivate2[0].id})`)
    : fail(`Conv ${testConvId}: nota privada não apareceu`);

  newPublic2.length > 0
    ? fail(`Conv ${testConvId}: ${newPublic2.length} msg PÚBLICA — vai duplicar no WhatsApp!`)
    : ok(`Conv ${testConvId}: nenhuma msg pública — cliente não recebe texto duplicado`);
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n' + '─'.repeat(50));
console.log(`Resultado: ${failures === 0 ? '✅ TUDO OK' : `❌ ${failures} falha(s)`}`);
if (failures > 0) process.exit(1);

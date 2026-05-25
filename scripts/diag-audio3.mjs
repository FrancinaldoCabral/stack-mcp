import dotenv from 'dotenv';
dotenv.config();
const N8N_KEY = process.env.N8N_API_KEY;
const EXECUTOR_ID = 'jleu4RPvSnYDL8Gd';

async function n8n(path) {
  const r = await fetch(`https://workflows.vendly.chat/api/v1${path}`, {
    headers: { 'X-N8N-API-KEY': N8N_KEY, 'Accept': 'application/json' }
  });
  return r.json();
}

// Pegar as últimas 20 execuções com dados
const execs = await n8n(`/executions?workflowId=${EXECUTOR_ID}&limit=20`);

console.log('=== ÚLTIMAS 5 EXECUÇÕES COM DADOS COMPLETOS ===\n');
for (const e of (execs.data ?? []).slice(0, 5)) {
  const detail = await n8n(`/executions/${e.id}?includeData=true`);
  const runData = detail.data?.resultData?.runData ?? {};
  const lastNode = detail.data?.resultData?.lastNodeExecuted ?? '?';
  const executedNodes = Object.keys(runData);

  console.log(`\n${'='.repeat(60)}`);
  console.log(`EXEC ${e.id} — ${e.startedAt?.slice(0, 19)} — ${e.status} — último nó: ${lastNode}`);
  console.log(`Nós executados (${executedNodes.length}): ${executedNodes.slice(0, 10).join(', ')}${executedNodes.length > 10 ? '...' : ''}`);

  // Ver Desembalar Payload (início) para entender o tipo de mensagem
  if (runData['Desembalar Payload']) {
    const items = runData['Desembalar Payload'][0]?.data?.main?.[0] ?? [];
    for (const it of items) {
      const j = it.json;
      console.log(`  tipo: ${j.tipo}, conteudo: "${String(j.conteudo ?? '').slice(0,60)}"`);
    }
  }

  // Ver Parsear Chunks
  if (runData['Parsear Chunks']) {
    const items = runData['Parsear Chunks'][0]?.data?.main?.[0] ?? [];
    const errs = runData['Parsear Chunks'][0]?.error;
    if (errs) console.log(`  Parsear Chunks ERRO: ${errs.message}`);
    else {
      console.log(`  Parsear Chunks → ${items.length} chunk(s):`);
      for (const it of items) {
        console.log(`    chunk="${String(it.json.chunk ?? '').slice(0,60)}" respondWithAudio=${it.json.respondWithAudio}`);
      }
    }
  }

  // Ver IF Responder com Audio?
  if (runData['IF Responder com Audio?']) {
    const d = runData['IF Responder com Audio?'][0];
    const trueBranch = d.data?.main?.[0] ?? [];
    const falseBranch = d.data?.main?.[1] ?? [];
    console.log(`  IF Audio? → TRUE=${trueBranch.length} FALSE=${falseBranch.length}`);
  }

  // Ver Evolution send audio
  if (runData['Evolution send audio']) {
    const d = runData['Evolution send audio'][0];
    if (d.error) console.log(`  ⚠ Evolution send audio ERRO: ${d.error.message}`);
    else {
      const items = d.data?.main?.[0] ?? [];
      const resp = items[0]?.json;
      console.log(`  Evolution send audio: key=${resp?.key?.id ?? '?'}`);
    }
  }

  // Ver Chatwoot Enviar Audio
  if (runData['Chatwoot Enviar Audio']) {
    const d = runData['Chatwoot Enviar Audio'][0];
    if (d.error) console.log(`  ⚠ Chatwoot Enviar Audio ERRO: ${d.error.message}`);
    else console.log(`  Chatwoot Enviar Audio: ✓`);
  } else if (runData['Evolution send audio']) {
    console.log(`  ⚠ Chatwoot Enviar Audio: NÃO executou (mas Evolution send audio executou!)`);
  }

  // Ver Chatwoot Enviar (modo texto)
  if (runData['Chatwoot Enviar']) {
    const d = runData['Chatwoot Enviar'][0];
    if (d.error) console.log(`  ⚠ Chatwoot Enviar ERRO: ${d.error.message}`);
    else console.log(`  Chatwoot Enviar (texto): ✓`);
  }

  // Mostrar erros em qualquer nó
  for (const [nodeName, nodeRuns] of Object.entries(runData)) {
    for (const run of nodeRuns) {
      if (run.error) {
        console.log(`  ⚠ ERRO em "${nodeName}": ${run.error.message}`);
      }
    }
  }
}

// Agora buscar especificamente execuções com áudio
console.log('\n\n' + '='.repeat(60));
console.log('Buscando execuções com fluxo de áudio (IF Audio? = true)...');
const allExecs = await n8n(`/executions?workflowId=${EXECUTOR_ID}&limit=50`);
let found = 0;
for (const e of (allExecs.data ?? [])) {
  const detail = await n8n(`/executions/${e.id}?includeData=true`);
  const runData = detail.data?.resultData?.runData ?? {};

  const ifAudio = runData['IF Responder com Audio?']?.[0];
  if (!ifAudio) continue;

  const trueBranch = ifAudio.data?.main?.[0] ?? [];
  if (trueBranch.length === 0) continue; // áudio não ativado nessa exec

  found++;
  console.log(`\nExec ${e.id} (${e.startedAt?.slice(0,19)}) — ÁUDIO ATIVADO:`);

  const pcItems = runData['Parsear Chunks']?.[0]?.data?.main?.[0] ?? [];
  if (pcItems[0]) {
    console.log(`  chunk: "${String(pcItems[0].json.chunk ?? '').slice(0,100)}"`);
  }

  if (runData['Evolution send audio']) {
    const d = runData['Evolution send audio'][0];
    if (d.error) console.log(`  Evolution send audio: ERRO ${d.error.message}`);
    else console.log(`  Evolution send audio: ✓`);
  } else {
    console.log(`  Evolution send audio: ✗ não executou`);
  }

  if (runData['Chatwoot Enviar Audio']) {
    const d = runData['Chatwoot Enviar Audio'][0];
    if (d.error) console.log(`  Chatwoot Enviar Audio: ERRO ${d.error.message}`);
    else console.log(`  Chatwoot Enviar Audio: ✓`);
  } else {
    console.log(`  Chatwoot Enviar Audio: ✗ NÃO EXECUTOU`);
  }

  if (runData['OpenRouter TTS']) {
    const d = runData['OpenRouter TTS'][0];
    if (d.error) console.log(`  OpenRouter TTS: ERRO ${d.error.message}`);
    else {
      const resp = d.data?.main?.[0]?.[0]?.json;
      console.log(`  OpenRouter TTS: ✓ base64=${resp?.base64 ? 'presente' : 'AUSENTE'}`);
    }
  } else {
    console.log(`  OpenRouter TTS: ✗ não executou`);
  }

  if (found >= 3) break;
}
if (found === 0) console.log('Nenhuma exec com respondWithAudio=true nos últimos 50 runs.');

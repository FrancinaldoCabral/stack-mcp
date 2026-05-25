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

// Pegar as últimas 20 execuções
const execs = await n8n(`/executions?workflowId=${EXECUTOR_ID}&limit=20`);

for (const e of (execs.data ?? []).slice(0, 5)) {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`EXEC ${e.id} — ${e.startedAt?.slice(0, 19)} — ${e.status}`);
  
  const detail = await n8n(`/executions/${e.id}`);
  const runData = detail.data?.resultData?.runData ?? {};
  
  const executedNodes = Object.keys(runData);
  console.log(`Nós que executaram (${executedNodes.length}): ${executedNodes.join(', ')}`);
  
  // Ver Parsear Chunks se executou
  if (runData['Parsear Chunks']) {
    const d = runData['Parsear Chunks'][0];
    const items = d.data?.main?.[0] ?? [];
    console.log(`\nParsear Chunks → ${items.length} item(s)`);
    for (const it of items) {
      const j = it.json;
      console.log(`  chunk="${String(j.chunk ?? '').slice(0,80)}" respondWithAudio=${j.respondWithAudio} escalar=${j.escalarHumano}`);
    }
  }
  
  // Ver IF Responder com Audio?
  if (runData['IF Responder com Audio?']) {
    const d = runData['IF Responder com Audio?'][0];
    const trueBranch = d.data?.main?.[0] ?? [];
    const falseBranch = d.data?.main?.[1] ?? [];
    console.log(`\nIF Responder com Audio? → true branch: ${trueBranch.length} | false branch: ${falseBranch.length}`);
  }
  
  // Ver Evolution send audio
  if (runData['Evolution send audio']) {
    const d = runData['Evolution send audio'][0];
    const err = d.error;
    const items = d.data?.main?.[0] ?? [];
    console.log(`\nEvolution send audio → items: ${items.length}`);
    if (err) console.log(`  ERRO: ${err.message}`);
    if (items[0]) console.log(`  resposta: ${JSON.stringify(items[0].json).slice(0, 300)}`);
  }
  
  // Ver Chatwoot Enviar Audio
  if (runData['Chatwoot Enviar Audio']) {
    const d = runData['Chatwoot Enviar Audio'][0];
    const err = d.error;
    const items = d.data?.main?.[0] ?? [];
    console.log(`\nChatwoot Enviar Audio → items: ${items.length}`);
    if (err) console.log(`  ERRO: ${err.message}`);
  } else {
    console.log(`\nChatwoot Enviar Audio: NÃO executou`);
  }
  
  // Ver nó que parou (erro)
  for (const [nodeName, nodeRuns] of Object.entries(runData)) {
    for (const run of nodeRuns) {
      if (run.error) {
        console.log(`\n⚠ ERRO em "${nodeName}": ${run.error.message}`);
      }
    }
  }
}

// Agora buscar execuções que tenham rodado o nó de áudio
console.log('\n\n' + '='.repeat(60));
console.log('Procurando execuções com Evolution send audio...');
const allExecs = await n8n(`/executions?workflowId=${EXECUTOR_ID}&limit=50`);
let found = 0;
for (const e of (allExecs.data ?? [])) {
  const detail = await n8n(`/executions/${e.id}`);
  const runData = detail.data?.resultData?.runData ?? {};
  if (runData['Evolution send audio'] || runData['IF Responder com Audio?']) {
    found++;
    console.log(`\nExec ${e.id} (${e.startedAt?.slice(0,19)}) TEM áudio:`);
    if (runData['IF Responder com Audio?']) {
      const d = runData['IF Responder com Audio?'][0];
      const trueBranch = d.data?.main?.[0] ?? [];
      const falseBranch = d.data?.main?.[1] ?? [];
      console.log(`  IF Audio? → true: ${trueBranch.length} | false: ${falseBranch.length}`);
    }
    if (runData['Evolution send audio']) {
      const d = runData['Evolution send audio'][0];
      const items = d.data?.main?.[0] ?? [];
      console.log(`  Evolution send audio: ${items.length} item(s)`);
      if (d.error) console.log(`  ERRO: ${d.error.message}`);
    }
    if (runData['Chatwoot Enviar Audio']) {
      console.log(`  Chatwoot Enviar Audio: ✓ executou`);
    } else {
      console.log(`  Chatwoot Enviar Audio: ✗ NÃO executou`);
    }
    if (found >= 5) break;
  }
}
if (found === 0) console.log('Nenhuma execução com áudio encontrada nos últimos 50 runs.');

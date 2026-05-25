import dotenv from 'dotenv';
import fs from 'fs';
dotenv.config();

const N8N_KEY = process.env.N8N_API_KEY;
const EXECUTOR_ID = 'jleu4RPvSnYDL8Gd';

async function n8n(path) {
  const r = await fetch(`https://workflows.vendly.chat/api/v1${path}`, {
    headers: { 'X-N8N-API-KEY': N8N_KEY, 'Accept': 'application/json' }
  });
  return r.json();
}

console.log('=== DIAGNÓSTICO DE ÁUDIO ===\n');

// 1. Buscar workflow Executor
const wf = await n8n(`/workflows/${EXECUTOR_ID}`);
const nodes = wf.nodes;

// 2. Todos os nós relacionados a áudio
const audioNodes = nodes.filter(n =>
  n.name.toLowerCase().includes('audio') ||
  (n.parameters?.jsCode ?? '').toLowerCase().includes('audio') ||
  (n.parameters?.url ?? '').toLowerCase().includes('audio') ||
  (n.parameters?.jsonBody ?? '').toLowerCase().includes('audio')
);

console.log(`Nós relacionados a áudio (${audioNodes.length}):`);
for (const n of audioNodes) {
  console.log(`\n--- ${n.name} [${n.type}] id=${n.id} ---`);
  if (n.parameters?.jsCode) {
    console.log('CODE (primeiros 1200 chars):');
    console.log(n.parameters.jsCode.substring(0, 1200));
  }
  if (n.parameters?.url) console.log('URL:', n.parameters.url);
  if (n.parameters?.jsonBody) console.log('JSON BODY:', n.parameters.jsonBody);
  if (n.parameters?.method) console.log('Method:', n.parameters.method);
  if (n.parameters?.operation) console.log('Op:', n.parameters.operation);
  if (n.parameters?.sendBody !== undefined) console.log('sendBody:', n.parameters.sendBody);
  if (n.parameters?.specifyBody) console.log('specifyBody:', n.parameters.specifyBody);
  if (n.parameters?.bodyParameters) console.log('bodyParameters:', JSON.stringify(n.parameters.bodyParameters));
}

// 3. Conexões dos nós de áudio
console.log('\n=== CONEXÕES ENVOLVENDO ÁUDIO ===');
const audioNames = new Set(audioNodes.map(n => n.name));
for (const [fromName, outs] of Object.entries(wf.connections ?? {})) {
  for (const branch of Object.values(outs)) {
    for (const targets of branch) {
      for (const t of targets) {
        if (audioNames.has(fromName) || audioNames.has(t.node)) {
          console.log(`  ${fromName} → ${t.node}`);
        }
      }
    }
  }
}

// 4. Parsear Chunks completo (para ver lógica de áudio)
const parsear = nodes.find(n => n.name === 'Parsear Chunks');
if (parsear) {
  console.log('\n=== PARSEAR CHUNKS (código completo) ===');
  console.log(parsear.parameters?.jsCode ?? '(sem código)');
}

// 5. IF Responder com Audio?
const ifAudio = nodes.find(n => n.name === 'IF Responder com Audio?');
if (ifAudio) {
  console.log('\n=== IF RESPONDER COM AUDIO? ===');
  console.log(JSON.stringify(ifAudio.parameters, null, 2));
}

// 6. Execuções recentes do Executor
console.log('\n=== 10 EXECUÇÕES RECENTES DO EXECUTOR ===');
const execs = await n8n(`/executions?workflowId=${EXECUTOR_ID}&limit=10`);
for (const e of (execs.data ?? [])) {
  const status = e.status ?? e.finished ? (e.stoppedAt ? 'finished' : 'running') : 'unknown';
  console.log(`  exec ${e.id}: status=${e.status ?? status} start=${e.startedAt?.slice(0,19)} mode=${e.mode}`);
}

// 7. Última execução com detalhes de nós de áudio
const lastExec = (execs.data ?? [])[0];
if (lastExec) {
  console.log(`\n=== DETALHES DA EXEC ${lastExec.id} ===`);
  const detail = await n8n(`/executions/${lastExec.id}`);
  const runData = detail.data?.resultData?.runData ?? {};
  for (const audioName of audioNames) {
    if (runData[audioName]) {
      console.log(`\nNó "${audioName}":`);
      const d = runData[audioName][0];
      console.log('  status:', d.executionStatus ?? d.error ? 'ERROR: ' + d.error?.message : 'ok');
      if (d.error) console.log('  error:', JSON.stringify(d.error, null, 2));
      const items = d.data?.main?.[0] ?? [];
      console.log('  output items:', items.length);
      if (items[0]) console.log('  first item:', JSON.stringify(items[0]).substring(0, 400));
    } else {
      console.log(`\nNó "${audioName}": NÃO EXECUTOU nesta exec`);
    }
  }
}

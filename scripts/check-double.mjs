import 'dotenv/config';

const h = {'X-N8N-API-KEY': process.env.N8N_API_KEY, 'Accept': 'application/json'};
const BASE = 'https://workflows.vendly.chat/api/v1';

async function execs(wfId, label) {
  const r = await fetch(`${BASE}/executions?limit=15&workflowId=${wfId}`, {headers: h});
  const d = await r.json();
  const items = d.data ?? [];
  console.log(`\n=== ${label} ===`);
  items.slice(0, 10).forEach(e => console.log(` ${e.id} ${e.startedAt?.slice(11,19)} ${e.status}`));
}

async function execDetail(execId) {
  const r = await fetch(`${BASE}/executions/${execId}`, {headers: h});
  const d = await r.json();
  return d;
}

await execs('bEb19TdWZfFloisU', '[CORE] Entrada');
await execs('FacKqM3e2LsHE6NY', '[CORE] Debounce');
await execs('jleu4RPvSnYDL8Gd', '[AGENT] Executor');

// Detalhe das 2 execuções mais recentes do Executor para ver se são do mesmo telefone
console.log('\n--- Detalhes Executor recentes ---');
const execsR = await fetch(`${BASE}/executions?limit=4&workflowId=jleu4RPvSnYDL8Gd`, {headers: h});
const execsD = await execsR.json();
for (const e of (execsD.data ?? []).slice(0,4)) {
  const det = await execDetail(e.id);
  const webhookData = det.data?.resultData?.runData?.['Webhook Agente']?.[0]?.data?.main?.[0]?.[0]?.json;
  const telefone = webhookData?.telefone ?? webhookData?.body?.telefone ?? '?';
  const instance = webhookData?.instance ?? webhookData?.body?.instance ?? '?';
  const tipo = webhookData?.tipo ?? webhookData?.body?.tipo ?? '?';
  console.log(` Exec ${e.id} @ ${e.startedAt?.slice(11,19)} | tel=${telefone} | inst=${instance} | tipo=${tipo} | status=${e.status}`);
}

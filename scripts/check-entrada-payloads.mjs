import 'dotenv/config';

const h = {'X-N8N-API-KEY': process.env.N8N_API_KEY, 'Accept': 'application/json'};
const BASE = 'https://workflows.vendly.chat/api/v1';

// Pegar TODAS as execuções do Entrada (mais que 10)
const r = await fetch(`${BASE}/executions?limit=50&workflowId=bEb19TdWZfFloisU`, {headers: h});
const d = await r.json();
const items = d.data ?? [];
console.log(`Total Entrada executions: ${items.length}`);

// Encontrar execuções ao redor de 00:40-00:42
const cluster = items.filter(e => {
  const t = e.startedAt ?? '';
  return t.includes('T00:40') || t.includes('T00:41') || t.includes('T01:05') || t.includes('T01:06');
});
console.log(`\nCluster executions: ${cluster.length}`);
cluster.forEach(e => console.log(` ${e.id} ${e.startedAt?.slice(11,19)}`));

// Detalhar as execuções do cluster para ver event/message_type
console.log('\n--- Detalhes de payload ---');
for (const e of cluster) {
  const r2 = await fetch(`${BASE}/executions/${e.id}`, {headers: h});
  const det = await r2.json();
  // Pegar o dado bruto do Webhook Trigger
  const triggerRuns = det.data?.resultData?.runData ?? {};
  const triggerNode = Object.keys(triggerRuns)[0]; // primeiro nó = webhook
  const triggerData = triggerRuns[triggerNode]?.[0]?.data?.main?.[0]?.[0]?.json ?? {};
  const event = triggerData.event ?? triggerData.message_type ?? '?';
  const msgId = triggerData.id ?? triggerData.message_id ?? '?';
  const msgType = triggerData.message_type ?? '?';
  const tipo = triggerData.tipo ?? '?';  // após normalização
  console.log(` Exec ${e.id} @ ${e.startedAt?.slice(11,19)} | event=${event} | msg_id=${msgId} | msg_type=${msgType} | tipo=${tipo}`);
}

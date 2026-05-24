import 'dotenv/config';

const h = {'X-N8N-API-KEY': process.env.N8N_API_KEY, 'Accept': 'application/json'};
const BASE = 'https://workflows.vendly.chat/api/v1/workflows';

async function execs(id, label) {
  const r = await fetch(`${BASE}/executions?limit=10&workflowId=${id}`, {headers: h});
  const d = await r.json();
  const items = Array.isArray(d) ? d : (d.data ?? []);
  console.log(`\n=== ${label} ===`);
  if (!items.length) { console.log(' (nenhuma)'); return; }
  items.forEach(e => console.log(' ', e.id, e.startedAt?.slice(11,19), e.status));
}

await execs('bEb19TdWZfFloisU', '[CORE] Entrada');
await execs('FacKqM3e2LsHE6NY', '[CORE] Debounce');
await execs('jleu4RPvSnYDL8Gd', '[AGENT] Executor');

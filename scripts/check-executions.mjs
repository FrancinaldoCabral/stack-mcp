import 'dotenv/config';

const N8N = 'https://workflows.vendly.chat';
const KEY = process.env.N8N_API_KEY;
const h = { 'X-N8N-API-KEY': KEY, 'Accept': 'application/json' };

async function checkWf(id, label) {
  const r = await fetch(`${N8N}/api/v1/executions?limit=5&workflowId=${id}`, { headers: h });
  const data = await r.json();
  console.log(`\n=== ${label} (${id}) ===`);
  const execs = data?.data ?? [];
  if (!execs.length) { console.log('  (nenhuma execução)'); return; }
  for (const e of execs) {
    console.log(`  ${e.id} | ${e.status} | ${new Date(e.startedAt).toISOString()}`);
    if (e.status === 'error') {
      // Buscar detalhes do erro
      const det = await fetch(`${N8N}/api/v1/executions/${e.id}`, { headers: h }).then(r => r.json());
      const errNode = Object.entries(det?.data?.resultData?.runData ?? {}).find(([,v]) => v?.[0]?.error);
      if (errNode) console.log(`    ERRO em "${errNode[0]}":`, errNode[1]?.[0]?.error?.message?.slice(0, 150));
    }
  }
}

async function run() {
  await checkWf('bEb19TdWZfFloisU', 'Entrada');
  await checkWf('FacKqM3e2LsHE6NY', 'Debounce');
  await checkWf('jleu4RPvSnYDL8Gd', 'Executor');
}

run().catch(e => console.error(e));

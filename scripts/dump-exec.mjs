import 'dotenv/config';

const h = {'X-N8N-API-KEY': process.env.N8N_API_KEY, 'Accept': 'application/json'};
const BASE = 'https://workflows.vendly.chat/api/v1';

// Detalhar exec 663 (first of 00:40 cluster) e 670 (00:41:02 cluster)
for (const execId of ['663', '666', '670', '674']) {
  const r = await fetch(`${BASE}/executions/${execId}`, {headers: h});
  const det = await r.json();
  
  // Dump das chaves de runData
  const runData = det.data?.resultData?.runData ?? {};
  const nodeNames = Object.keys(runData);
  console.log(`\nExec ${execId} nodes: ${nodeNames.join(', ')}`);
  
  // Para cada nó, pegar o primeiro item de saída
  for (const nodeName of nodeNames.slice(0, 3)) {
    const runs = runData[nodeName];
    if (!runs?.length) continue;
    const item = runs[0]?.data?.main?.[0]?.[0]?.json;
    if (!item) continue;
    console.log(`  ${nodeName}:`, JSON.stringify(item).slice(0, 300));
  }
}

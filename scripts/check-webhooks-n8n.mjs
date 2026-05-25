import dotenv from 'dotenv';
dotenv.config();
const N8N = process.env.N8N_URL;
const N8N_H = { 'X-N8N-API-KEY': process.env.N8N_API_KEY, 'Accept': 'application/json, text/event-stream' };

// Ver todos os workflows ativos (primeiro nó de cada um)
const wfs = await fetch(`${N8N}/api/v1/workflows?active=true&limit=30`, { headers: N8N_H }).then(r => r.json());
for (const wf of (wfs.data ?? [])) {
  const webhookNodes = wf.nodes?.filter(n => n.type === 'n8n-nodes-base.webhook');
  if (webhookNodes?.length > 0) {
    for (const wn of webhookNodes) {
      console.log(`Workflow "${wf.name}" (${wf.id}) → path: ${wn.parameters?.path}`);
    }
  }
}

// Ver [CORE] Auto-open especificamente
const autoOpen = await fetch(`${N8N}/api/v1/workflows/Jijw4Dqil3QVYSp8`, { headers: N8N_H }).then(r => r.json());
console.log('\n[CORE] Auto-open nodes:');
for (const n of (autoOpen.nodes ?? [])) {
  if (['n8n-nodes-base.webhook', 'n8n-nodes-base.code', 'n8n-nodes-base.if'].includes(n.type)) {
    console.log(`  ${n.name} (${n.type}) params: ${JSON.stringify(n.parameters).slice(0, 120)}`);
  }
}

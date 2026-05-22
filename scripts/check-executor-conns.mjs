import 'dotenv/config';

const N8N = 'https://workflows.vendly.chat';
const KEY = process.env.N8N_API_KEY;
const h = { 'X-N8N-API-KEY': KEY, 'Accept': 'application/json' };

const r = await fetch(`${N8N}/api/v1/workflows/jleu4RPvSnYDL8Gd`, { headers: h });
const wf = await r.json();

console.log('=== Nós ===');
wf.nodes.forEach(n => console.log(`  ${n.id.padEnd(30)} | ${n.name}`));

console.log('\n=== Conexões (A → B) ===');
Object.entries(wf.connections ?? {}).forEach(([from, outs]) => {
  (outs.main ?? []).forEach((targets, idx) => {
    (targets ?? []).forEach(t => console.log(`  "${from}" → "${t.node}"`));
  });
});

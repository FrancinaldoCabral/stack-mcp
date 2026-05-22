import 'dotenv/config';

const N8N = 'https://workflows.vendly.chat';
const KEY = process.env.N8N_API_KEY;
const h = { 'X-N8N-API-KEY': KEY, 'Accept': 'application/json' };

const r = await fetch(`${N8N}/api/v1/workflows/jleu4RPvSnYDL8Gd`, { headers: h });
const wf = await r.json();

const targets = ['save-session', 'prep-upsert-cliente', 'prep-log-conversa', 'gen-embedding', 'build-prompt'];
for (const id of targets) {
  const node = wf.nodes.find(n => n.id === id);
  if (!node) continue;
  const code = node.parameters?.jsCode ?? node.parameters?.jsonBody ?? '';
  // Mostrar referências a outros nós via $('...')
  const refs = [...new Set([...code.matchAll(/\$\(['"]([^'"]+)['"]\)/g)].map(m => m[1]))];
  console.log(`\n${node.name}: referencias → [${refs.join(', ')}]`);
  if (node.parameters?.jsCode) console.log(node.parameters.jsCode.slice(0, 300));
}

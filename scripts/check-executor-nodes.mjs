import 'dotenv/config';

const N8N = 'https://workflows.vendly.chat';
const KEY = process.env.N8N_API_KEY;
const h = { 'X-N8N-API-KEY': KEY, 'Accept': 'application/json' };

const r = await fetch(`${N8N}/api/v1/workflows/jleu4RPvSnYDL8Gd`, { headers: h });
const wf = await r.json();

// Nós que interessam para o diagnóstico
const targetIds = [
  'mesclar-historico', 'verificar-janela', 'if-resumir',
  'comprimir-historico', 'gen-embedding', 'qdrant-search-ctx',
  'build-prompt', 'prep-historico-cw', 'redis-get-sessao',
  'parse-agente', 'if-tem-agente'
];

for (const id of targetIds) {
  const node = wf.nodes.find(n => n.id === id);
  if (!node) { console.log(`${id}: NOT FOUND`); continue; }
  console.log(`\n=== ${node.name} (${id}) [${node.type.split('.').pop()}] ===`);
  const p = node.parameters;
  if (p.jsCode) console.log('jsCode:', p.jsCode.slice(0, 400));
  else if (p.query) console.log('query:', JSON.stringify(p.query).slice(0, 200));
  else if (p.url) console.log('url:', p.url);
  else if (p.conditions) console.log('conditions:', JSON.stringify(p.conditions).slice(0, 200));
  else if (p.mode) console.log('mode:', p.mode, '| options:', JSON.stringify(p.options ?? {}).slice(0, 100));
  else console.log('params:', JSON.stringify(p).slice(0, 200));
}

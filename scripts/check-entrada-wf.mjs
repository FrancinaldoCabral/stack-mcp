import 'dotenv/config';

const N8N = 'https://workflows.vendly.chat';
const KEY = process.env.N8N_API_KEY;
const h = { 'X-N8N-API-KEY': KEY, 'Accept': 'application/json' };

async function run() {
  const r = await fetch(`${N8N}/api/v1/workflows/bEb19TdWZfFloisU`, { headers: h });
  const wf = await r.json();
  
  // Normalizar Mensagem node
  const norm = wf.nodes.find(n => n.name.toLowerCase().includes('normalizar'));
  console.log('=== Normalizar Mensagem ===');
  console.log('Code:\n', norm?.parameters?.jsCode ?? norm?.parameters?.functionCode ?? '(não encontrado)');
  
  // Ver todos os nós com seus tipos
  console.log('\n=== Nós do Entrada ===');
  wf.nodes.forEach(n => console.log(`  ${n.id} | ${n.type.split('.')[1]} | ${n.name}`));
  
  // Ver conexões
  console.log('\n=== Conexões ===');
  Object.entries(wf.connections ?? {}).forEach(([from, outs]) => {
    (outs.main ?? []).forEach((targets, idx) => {
      (targets ?? []).forEach(t => console.log(`  ${from} → ${t.node}`));
    });
  });
}

run().catch(e => console.error(e));

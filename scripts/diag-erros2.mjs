import fs from 'node:fs';
const env = Object.fromEntries(fs.readFileSync('.env','utf8').split(/\r?\n/).filter(l=>l&&!l.startsWith('#')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i),l.slice(i+1)]}));
const N8N=env.N8N_URL, KEY=env.N8N_API_KEY;
const H={'X-N8N-API-KEY':KEY,'Accept':'application/json'};

// 1. Exec 3218 - OpenRouter Com Ferramenta JSON inválido
// 2. Exec 3013 - Construir Prompt: personaKey not defined
// Queremos ver o input que causou o erro e o contexto
async function getExecData(id, nodeNames) {
  const e = await fetch(`${N8N}/api/v1/executions/${id}?includeData=true`,{headers:H}).then(r=>r.json());
  const rd = e.data?.resultData?.runData || {};
  console.log(`\n=== Exec ${id} — ${e.startedAt?.slice(0,19)} ===`);
  for (const name of nodeNames) {
    const run = rd[name]?.[0];
    if (!run) { console.log(`  [${name}]: sem dados`); continue; }
    if (run.error) console.log(`  [${name}] ERRO: ${run.error.message}`);
    const inp = run.data?.main?.[0]?.[0]?.json;
    const out = run.data?.main?.[0];
    if (inp) {
      const preview = JSON.stringify(inp).slice(0,300);
      console.log(`  [${name}] input: ${preview}`);
    }
  }
}

// Exec 3218: problema no OpenRouter
await getExecData(3218, ['Buscar Sessao', 'Construir Prompt', 'OpenRouter Com Ferramenta']);

// Exec 3013: personaKey not defined
await getExecData(3013, ['Resolver Persona', 'Construir Prompt']);

// Exec 3035: Chatwoot Enviar URL undefined
await getExecData(3035, ['Parsear Chunks', 'Aguardar Digitacao', 'Chatwoot Enviar']);

// Check current Construir Prompt code for personaKey reference
const wf = await fetch(`${N8N}/api/v1/workflows/jleu4RPvSnYDL8Gd`,{headers:H}).then(r=>r.json());
const cp = wf.nodes.find(n=>n.name==='Construir Prompt');
console.log('\n=== Construir Prompt: linhas com personaKey ===');
if (cp) {
  cp.parameters.jsCode.split('\n').forEach((l,i)=>{
    if (l.includes('personaKey')) console.log(`  L${i+1}: ${l}`);
  });
}
const orNode = wf.nodes.find(n=>n.name==='OpenRouter Com Ferramenta');
console.log('\n=== OpenRouter Com Ferramenta: jsonBody/specifyBody ===');
if (orNode) {
  console.log('  specifyBody:', orNode.parameters?.specifyBody);
  console.log('  jsonBody:', (orNode.parameters?.jsonBody||'').slice(0,300));
  console.log('  body:', (orNode.parameters?.body||'').slice(0,300));
}

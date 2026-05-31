import fs from 'node:fs';
const env = Object.fromEntries(fs.readFileSync('.env','utf8').split(/\r?\n/).filter(l=>l&&!l.startsWith('#')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i),l.slice(i+1)]}));
const N8N=env.N8N_URL, KEY=env.N8N_API_KEY;
const H={'X-N8N-API-KEY':KEY,'Accept':'application/json'};

// 1. Exec 3218: ver o que Construir Prompt produziu como openRouterBody
const e3218 = await fetch(`${N8N}/api/v1/executions/3218?includeData=true`,{headers:H}).then(r=>r.json());
const rd218 = e3218.data?.resultData?.runData || {};
const cpOut = rd218['Construir Prompt']?.[0]?.data?.main?.[0]?.[0]?.json;
console.log('=== Exec 3218 — Construir Prompt output ===');
if (cpOut) {
  console.log('  keys:', Object.keys(cpOut));
  const ob = cpOut.openRouterBody;
  console.log('  openRouterBody type:', typeof ob);
  if (typeof ob === 'string') {
    console.log('  openRouterBody é STRING (esse é o problema!)');
    console.log('  primeiros 200 chars:', ob.slice(0,200));
  } else if (ob) {
    console.log('  model:', ob.model);
    console.log('  messages count:', ob.messages?.length);
    const last = ob.messages?.slice(-1)[0];
    console.log('  última mensagem:', JSON.stringify(last)?.slice(0,200));
  }
}

// 2. Exec 3035: ver o que Chatwoot Enviar precisava de conversation_id
const e3035 = await fetch(`${N8N}/api/v1/executions/3035?includeData=true`,{headers:H}).then(r=>r.json());
const rd35 = e3035.data?.resultData?.runData || {};
const chIn = rd35['Chatwoot Enviar']?.[0]?.data?.main?.[0]?.[0]?.json;
console.log('\n=== Exec 3035 — Chatwoot Enviar input ===');
if (chIn) {
  console.log('  conversation_id:', chIn.contexto?.conversation_id);
  console.log('  telefone:', chIn.contexto?.telefone);
  console.log('  instance:', chIn.contexto?.instance);
  console.log('  todas as keys do contexto:', Object.keys(chIn.contexto || chIn));
}

// 3. Ver configuração atual do nó OpenRouter Com Ferramenta e Chatwoot Enviar
const wf = await fetch(`${N8N}/api/v1/workflows/jleu4RPvSnYDL8Gd`,{headers:H}).then(r=>r.json());
const orNode = wf.nodes.find(n=>n.name==='OpenRouter Com Ferramenta');
const cwNode = wf.nodes.find(n=>n.name==='Chatwoot Enviar');
console.log('\n=== OpenRouter Com Ferramenta config ===');
console.log('  jsonBody:', orNode?.parameters?.jsonBody?.slice(0,100));
console.log('  specifyBody:', orNode?.parameters?.specifyBody);

console.log('\n=== Chatwoot Enviar config ===');
console.log('  url:', cwNode?.parameters?.url?.slice(0,120));

// 4. Ver Construir Prompt: como openRouterBody é criado (linhas relevantes)
const cp = wf.nodes.find(n=>n.name==='Construir Prompt');
console.log('\n=== Construir Prompt: linhas openRouterBody ===');
cp.parameters.jsCode.split('\n').forEach((l,i)=>{
  if (l.includes('openRouterBody') || l.includes('JSON.stringify') || l.includes('return [')) 
    console.log(`  L${i+1}: ${l.slice(0,120)}`);
});

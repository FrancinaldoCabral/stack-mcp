import fs from 'node:fs';
const env = Object.fromEntries(fs.readFileSync('.env','utf8').split(/\r?\n/).filter(l=>l&&!l.startsWith('#')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i),l.slice(i+1)]}));
const N8N=env.N8N_URL, KEY=env.N8N_API_KEY;
const NH={'X-N8N-API-KEY':KEY,'Accept':'application/json'};

const wf = await fetch(`${N8N}/api/v1/workflows/jleu4RPvSnYDL8Gd`, {headers:NH}).then(r=>r.json());

// Construir Prompt node
const cp = wf.nodes.find(n=>n.name==='Construir Prompt');
console.log('=== Construir Prompt type:', cp?.type);
console.log('=== Construir Prompt jsCode:');
console.log(cp?.parameters?.jsCode || '(sem jsCode)');

// IF Tem Agente? - o que verifica?
const ifNode = wf.nodes.find(n=>n.name==='IF Tem Agente?');
console.log('\n=== IF Tem Agente? conditions:');
console.log(JSON.stringify(ifNode?.parameters?.conditions, null, 2));

// Parse Agente Config
const pac = wf.nodes.find(n=>n.name==='Parse Agente Config');
console.log('\n=== Parse Agente Config jsCode:');
console.log(pac?.parameters?.jsCode?.slice(0,1000) || JSON.stringify(pac?.parameters).slice(0,1000));

// Redis GET Persona Routes
const rpr = wf.nodes.find(n=>n.name==='Redis GET Persona Routes');
console.log('\n=== Redis GET Persona Routes params:');
console.log(JSON.stringify(rpr?.parameters, null, 2));

// Conexões do AGENT - path completo do loop
console.log('\n=== Todas conexões relevantes ===');
const conn = wf.connections;
const nodes = ['Loop Chunks','Preparar Envio','Presence Digitando','Aguardar Digitacao','Evolution Enviar','Chatwoot Enviar'];
for (const n of nodes) {
  const out = conn[n]?.main?.[0]?.map(d=>d.node);
  const out1 = conn[n]?.main?.[1]?.map(d=>d.node);
  if (out) console.log(`  ${n} [0] → [${out}]`);
  if (out1) console.log(`  ${n} [1] → [${out1}]`);
}

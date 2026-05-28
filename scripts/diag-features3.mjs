import fs from 'node:fs';
const env = Object.fromEntries(fs.readFileSync('.env','utf8').split(/\r?\n/).filter(l=>l&&!l.startsWith('#')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i),l.slice(i+1)]}));
const N8N=env.N8N_URL, KEY=env.N8N_API_KEY;
const NH={'X-N8N-API-KEY':KEY,'Accept':'application/json'};

const [core, agent, autoopen] = await Promise.all([
  fetch(`${N8N}/api/v1/workflows/bEb19TdWZfFloisU`, {headers:NH}).then(r=>r.json()),
  fetch(`${N8N}/api/v1/workflows/jleu4RPvSnYDL8Gd`, {headers:NH}).then(r=>r.json()),
  fetch(`${N8N}/api/v1/workflows/Jijw4Dqil3QVYSp8`, {headers:NH}).then(r=>r.json()),
]);

// CORE - mapa completo de conexões
console.log('=== CORE - TODAS conexões (de → para) ===');
for (const [from, outConn] of Object.entries(core.connections)) {
  for (let i=0; i<(outConn.main?.length||0); i++) {
    const targets = outConn.main?.[i]?.map(d=>d.node)||[];
    if (targets.length) console.log(`  ${from} [${i}] → [${targets.join(', ')}]`);
  }
}

// CORE - código dos nós relevantes
const coreNodesFull = ['Auto-Aceitar Conversa','Aplicar Filtro Contatos'];
for (const nn of coreNodesFull) {
  const n = core.nodes.find(x=>x.name===nn);
  if (n?.parameters?.jsCode) {
    console.log(`\n--- CORE "${nn}" code ---`);
    console.log(n.parameters.jsCode);
  }
}
// Redis GET human_takeover - o que faz com o valor?
const coreHt = core.nodes.find(n=>n.name==='Redis GET human_takeover');
console.log('\n--- Redis GET human_takeover params ---');
console.log(JSON.stringify(coreHt?.parameters, null, 2));

// AGENT - Parsear Chunks code completo
const parsearChunks = agent.nodes.find(n=>n.name==='Parsear Chunks');
console.log('\n\n=== AGENT - Parsear Chunks ===');
console.log(parsearChunks?.parameters?.jsCode);

// AGENT - Escalada Humano code completo
const escNode = agent.nodes.find(n=>n.name==='Escalada Humano');
console.log('\n=== AGENT - Escalada Humano (completo) ===');
console.log(escNode?.parameters?.jsCode);

// AGENT - Redis SET Takeover Escalada
const rsets = agent.nodes.find(n=>n.name==='Redis SET Takeover Escalada');
console.log('\n=== AGENT - Redis SET Takeover Escalada ===');
console.log(JSON.stringify(rsets?.parameters, null, 2));

// AUTO-OPEN - Handle Takeover Humano code completo
const handle = autoopen.nodes.find(n=>n.name==='Handle Takeover Humano');
console.log('\n\n=== AUTO-OPEN - Handle Takeover Humano (completo) ===');
console.log(handle?.parameters?.jsCode);

// AUTO-OPEN - Abrir Conversa code completo
const abrir = autoopen.nodes.find(n=>n.name==='Abrir Conversa');
console.log('\n=== AUTO-OPEN - Abrir Conversa (completo) ===');
console.log(abrir?.parameters?.jsCode);

// AUTO-OPEN - Toggle Status
const toggle = autoopen.nodes.find(n=>n.name==='Toggle Status');
console.log('\n=== AUTO-OPEN - Toggle Status ===');
console.log(JSON.stringify(toggle?.parameters, null, 2));

// AUTO-OPEN - todas conexões
console.log('\n=== AUTO-OPEN - TODAS conexões ===');
for (const [from, outConn] of Object.entries(autoopen.connections)) {
  for (let i=0; i<(outConn.main?.length||0); i++) {
    const targets = outConn.main?.[i]?.map(d=>d.node)||[];
    if (targets.length) console.log(`  ${from} [${i}] → [${targets.join(', ')}]`);
  }
}

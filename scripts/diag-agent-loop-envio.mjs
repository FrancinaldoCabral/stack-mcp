import fs from 'node:fs';
const env = Object.fromEntries(fs.readFileSync('.env','utf8').split(/\r?\n/).filter(l=>l&&!l.startsWith('#')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i),l.slice(i+1)]}));
const N8N=env.N8N_URL, KEY=env.N8N_API_KEY;
const NH={'X-N8N-API-KEY':KEY,'Accept':'application/json'};

const wf = await fetch(`${N8N}/api/v1/workflows/jleu4RPvSnYDL8Gd`, {headers:NH}).then(r=>r.json());

// Mostrar conexões do subfluxo Loop Chunks → ...
console.log('=== Conexões do loop de envio ===');
const conn = wf.connections;
const targets = ['Loop Chunks','Preparar Envio','Presence Digitando','Evolution Enviar','Evolution Send','Chatwoot Enviar','Aguardar Digitacao'];
for (const src of targets) {
  if (conn[src]) {
    for (const [outputIdx, dests] of Object.entries(conn[src]?.main||{})) {
      const destNames = (dests||[]).map(d=>d.node);
      console.log(`  "${src}" [${outputIdx}] → ${destNames.join(', ')}`);
    }
  }
}

// Preparar Envio - código completo
console.log('\n=== Preparar Envio - código ===');
const pe = wf.nodes.find(n=>n.name==='Preparar Envio');
console.log(pe?.parameters?.jsCode || '(sem jsCode)');

// Chatwoot Enviar - parâmetros
console.log('\n=== Chatwoot Enviar - params ===');
const ce = wf.nodes.find(n=>n.name==='Chatwoot Enviar');
console.log(JSON.stringify(ce?.parameters, null, 2).slice(0,800));

// Evolution Enviar
console.log('\n=== Evolution Enviar (último) - params ===');
const ee = wf.nodes.find(n=>n.name==='Evolution Enviar');
console.log('url:', ee?.parameters?.url);
console.log('body:', ee?.parameters?.jsonBody?.slice?.(0,200) || JSON.stringify(ee?.parameters).slice(0,200));

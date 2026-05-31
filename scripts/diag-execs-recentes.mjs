import fs from 'node:fs';
const env = Object.fromEntries(fs.readFileSync('.env','utf8').split(/\r?\n/).filter(l=>l&&!l.startsWith('#')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i),l.slice(i+1)]}));
const N8N=env.N8N_URL, KEY=env.N8N_API_KEY;
const H={'X-N8N-API-KEY':KEY,'Accept':'application/json'};

const [agent, core, debounce] = await Promise.all([
  fetch(N8N+'/api/v1/executions?workflowId=jleu4RPvSnYDL8Gd&limit=30',{headers:H}).then(r=>r.json()),
  fetch(N8N+'/api/v1/executions?workflowId=bEb19TdWZfFloisU&limit=30',{headers:H}).then(r=>r.json()),
  fetch(N8N+'/api/v1/executions?workflowId=FacKqM3e2LsHE6NY&limit=30',{headers:H}).then(r=>r.json()),
]);

console.log('=== AGENT (últimas 30 execuções) ===');
for(const e of (agent.data||[])) {
  const dur = e.stoppedAt ? ((new Date(e.stoppedAt)-new Date(e.startedAt))/1000).toFixed(1)+'s' : '?';
  console.log(` ${e.id} ${e.status.padEnd(8)} ${e.startedAt?.slice(0,19)} dur=${dur}`);
}

console.log('\n=== CORE (últimas 30 execuções) ===');
for(const e of (core.data||[])) console.log(` ${e.id} ${e.status.padEnd(8)} ${e.startedAt?.slice(0,19)}`);

console.log('\n=== DEBOUNCE (últimas 30 execuções) ===');
for(const e of (debounce.data||[])) console.log(` ${e.id} ${e.status.padEnd(8)} ${e.startedAt?.slice(0,19)}`);

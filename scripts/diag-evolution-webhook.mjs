import fs from 'node:fs';
const env = Object.fromEntries(fs.readFileSync('.env','utf8').split(/\r?\n/).filter(l=>l && !l.startsWith('#')).map(l=>{const i=l.indexOf('=');return [l.slice(0,i), l.slice(i+1)]}));
const N8N=env.N8N_URL, KEY=env.N8N_API_KEY, EV=env.EVOLUTION_API_KEY;
const H={'X-N8N-API-KEY':KEY,'Accept':'application/json'};

// 1) Webhook config Evolution
console.log('=== EVOLUTION WEBHOOK livraison-totale ===');
const wb = await fetch('https://evolution.vendly.chat/webhook/find/livraison-totale', {headers:{apikey:EV}}).then(r=>r.json());
console.log(JSON.stringify(wb, null, 2));

console.log('\n=== EVOLUTION WEBHOOK suporte-redatudo ===');
try {
  const wb2 = await fetch('https://evolution.vendly.chat/webhook/find/suporte-redatudo', {headers:{apikey:EV}}).then(r=>r.json());
  console.log(JSON.stringify(wb2, null, 2));
} catch(e){console.log('not found')}

// 2) Instance state
console.log('\n=== EVOLUTION INSTANCES ===');
const insts = await fetch('https://evolution.vendly.chat/instance/fetchInstances', {headers:{apikey:EV}}).then(r=>r.json());
for (const i of (insts||[])) {
  console.log(`  ${i.name || i.instance?.instanceName} state=${i.connectionStatus || i.instance?.state} ownerJid=${i.ownerJid}`);
}

// 3) Ultimas 10 execucoes do AGENT — remoteJid de cada
console.log('\n=== ULTIMAS 10 EXEC AGENT remoteJid ===');
const list = await fetch(`${N8N}/api/v1/executions?workflowId=jleu4RPvSnYDL8Gd&limit=10`, {headers:H}).then(r=>r.json());
for (const e of (list.data||[])) {
  const det = await fetch(`${N8N}/api/v1/executions/${e.id}?includeData=true`, {headers:H}).then(r=>r.json());
  const rd = det.data?.resultData?.runData;
  const wbh = rd?.['Webhook Agente']?.[0]?.data?.main?.[0]?.[0]?.json;
  const body = wbh?.body || wbh;
  const persona = rd?.['Resolver Persona']?.[0]?.data?.main?.[0]?.[0]?.json;
  console.log(`exec ${e.id} status=${e.status} mode=${e.mode} remoteJid=${body?.telefone||body?.remoteJid} personaKey=${persona?.personaKey || persona?.__deliveryCtx?.personaKey} restaurantId=${persona?.restaurantId}`);
}

// 4) Ultimas execucoes do Debounce (FacKqM3e2LsHE6NY)
console.log('\n=== ULTIMAS 5 EXEC DEBOUNCE ===');
const db = await fetch(`${N8N}/api/v1/executions?workflowId=FacKqM3e2LsHE6NY&limit=5`, {headers:H}).then(r=>r.json());
for (const e of (db.data||[])) {
  console.log(`  exec ${e.id} status=${e.status} mode=${e.mode} startedAt=${e.startedAt}`);
}

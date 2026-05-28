// 1. Pegar Redis GET Persona Routes output da ultima exec AGENT
// 2. Ver primeiro no do CORE webhook e o que ele recebe de verdade
import fs from 'node:fs';
const env = Object.fromEntries(fs.readFileSync('.env','utf8').split(/\r?\n/).filter(l=>l && !l.startsWith('#')).map(l=>{const i=l.indexOf('=');return [l.slice(0,i), l.slice(i+1)]}));
const N8N=env.N8N_URL, KEY=env.N8N_API_KEY;
const H={'X-N8N-API-KEY':KEY,'Accept':'application/json'};

// 1) Ultima exec AGENT -> ver Redis GET Persona Routes
const ex = await fetch(`${N8N}/api/v1/executions/3138?includeData=true`, {headers:H}).then(r=>r.json());
const rd = ex.data?.resultData?.runData;
const pr = rd?.['Redis GET Persona Routes']?.[0]?.data?.main?.[0]?.[0]?.json;
console.log('=== persona_routes:livraison-totale (Redis cache) ===');
console.log(JSON.stringify(pr, null, 2));

// 2) CORE workflow: ver Webhook node e o que aceita
const wf = await fetch(`${N8N}/api/v1/workflows/bEb19TdWZfFloisU`, {headers:H}).then(r=>r.json());
console.log('\n=== CORE nodes (primeiros) ===');
const sorted = [...wf.nodes].sort((a,b)=> (a.position[0]+a.position[1]) - (b.position[0]+b.position[1]));
for (const n of sorted.slice(0,12)) console.log(`  ${n.name} type=${n.type}`);

// CORE: ultimas 30 execs - count por tipo de webhook
console.log('\n=== CORE last 30 execs - source breakdown ===');
const list = await fetch(`${N8N}/api/v1/executions?workflowId=bEb19TdWZfFloisU&limit=30`, {headers:H}).then(r=>r.json());
const counts = {};
for (const e of (list.data||[])) {
  const det = await fetch(`${N8N}/api/v1/executions/${e.id}?includeData=true`, {headers:H}).then(r=>r.json());
  const rd2 = det.data?.resultData?.runData;
  const fn = Object.keys(rd2||{})[0];
  const wbh = rd2?.[fn]?.[0]?.data?.main?.[0]?.[0]?.json;
  const body = wbh?.body || wbh;
  // identifica origem
  let origem='?';
  if (body?.event && body?.account?.id) origem = `chatwoot:${body.event}`;
  else if (body?.event === 'messages.upsert' || body?.data?.key?.remoteJid) origem = `evolution:messages.upsert`;
  else if (body?.instance && body?.data) origem = `evolution:other`;
  else origem = `unknown:${JSON.stringify(body).slice(0,80)}`;
  counts[origem] = (counts[origem]||0)+1;
}
console.log(counts);

// 3) Ver QUAIS sao os webhooks registrados no CORE
console.log('\n=== Webhook nodes no CORE ===');
const wbn = wf.nodes.filter(n => n.type === 'n8n-nodes-base.webhook');
for (const w of wbn) console.log(`  ${w.name} path=${w.parameters.path} method=${w.parameters.httpMethod}`);

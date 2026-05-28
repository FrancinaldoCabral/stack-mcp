import fs from 'node:fs';
const env = Object.fromEntries(fs.readFileSync('.env','utf8').split(/\r?\n/).filter(l=>l&&!l.startsWith('#')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i),l.slice(i+1)]}));
const N8N=env.N8N_URL, KEY=env.N8N_API_KEY;
const CW=env.CHATWOOT_URL, CWK=env.CHATWOOT_API_KEY, ACCID=env.CHATWOOT_ACCOUNT_ID||1;
const NH={'X-N8N-API-KEY':KEY,'Accept':'application/json'};
const CWH={'api_access_token':CWK,'Content-Type':'application/json'};

// 1. Chatwoot inboxes com raw response
console.log('=== CHATWOOT inboxes raw ===');
const r1 = await fetch(`${CW}/api/v1/accounts/${ACCID}/inboxes`, {headers:CWH});
console.log('status:', r1.status);
const t1 = await r1.text();
try { const j = JSON.parse(t1); console.log(JSON.stringify(j, null, 2).slice(0, 3000)); } catch { console.log(t1.slice(0,1000)); }

// 2. Ver o workflow Auto-open Conversas Pending
console.log('\n=== workflow Auto-open ===');
const wf = await fetch(`${N8N}/api/v1/workflows/Jijw4Dqil3QVYSp8`, {headers:NH}).then(r=>r.json());
for (const n of (wf.nodes||[])) {
  const s = JSON.stringify(n);
  if (s.includes('suporte-redatudo')) {
    console.log(`  nó "${n.name}" type=${n.type}`);
    console.log('  ', JSON.stringify(n.parameters).slice(0,500));
  }
}

// 3. Ver detalhes de erro nas execs recentes CORE
console.log('\n=== CORE exec 3215 erro detalhes ===');
const exc = await fetch(`${N8N}/api/v1/executions/3215?includeData=true`, {headers:NH}).then(r=>r.json());
const rd = exc.data?.resultData;
console.log('error:', JSON.stringify(rd?.error).slice(0,400));
// ver último nó que executou
const runs = rd?.runData || {};
const nodes = Object.keys(runs);
console.log('nós executados:', nodes);
for (const n of nodes) {
  const item = runs[n]?.[0];
  const err = item?.error;
  if (err) console.log(`  ERRO em "${n}":`, JSON.stringify(err).slice(0,300));
}

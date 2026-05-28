import fs from 'node:fs';
const env = Object.fromEntries(fs.readFileSync('.env','utf8').split(/\r?\n/).filter(l=>l&&!l.startsWith('#')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i),l.slice(i+1)]}));
const N8N=env.N8N_URL, KEY=env.N8N_API_KEY, CW=env.CHATWOOT_URL, CWK=env.CHATWOOT_API_KEY, ACCID=env.CHATWOOT_ACCOUNT_ID||1;
const NH={'X-N8N-API-KEY':KEY,'Accept':'application/json'};
const CWH={'api_access_token':CWK,'Content-Type':'application/json'};

// Chatwoot inboxes - endpoint correto
console.log('=== CHATWOOT inboxes v2 ===');
const r = await fetch(`${CW}/api/v2/accounts/${ACCID}/inboxes`, {headers:CWH});
console.log('v2 status:', r.status);
const j = await r.json().catch(()=>({}));
console.log(JSON.stringify(j?.payload?.map(i=>({id:i.id,name:i.name,channel:i.channel_type,webhook:i.webhook_url?.slice(0,60),agent_bot:i.agent_bot?.id}))||j).slice(0,2000));

// Tenta v1 com path diferente
console.log('\n=== v1 inboxes list ===');
const r2 = await fetch(`${CW}/api/v1/accounts/${ACCID}/inboxes`, {headers:{...CWH,'Accept':'application/json'}});
console.log('status:', r2.status);
const raw2 = await r2.text();
// parse and extract payload
try {
  const j2 = JSON.parse(raw2);
  const payload = j2.payload || j2.inboxes || [];
  if (Array.isArray(payload)) {
    for (const ib of payload) console.log(`  id=${ib.id} name="${ib.name}" channel=${ib.channel_type} wb="${(ib.webhook_url||'').slice(0,60)}" bot=${ib.agent_bot?.id||'none'}`);
  } else {
    console.log(raw2.slice(0,500));
  }
} catch { console.log(raw2.slice(0,500)); }

// workflow Auto-open completo
console.log('\n=== [CORE] Auto-open: nó Handle Takeover Humano - código completo ===');
const wf = await fetch(`${N8N}/api/v1/workflows/Jijw4Dqil3QVYSp8`, {headers:NH}).then(r=>r.json());
for (const n of (wf.nodes||[])) {
  if (JSON.stringify(n).includes('suporte-redatudo')) {
    console.log(`nó: "${n.name}"`);
    console.log(n.parameters?.jsCode || JSON.stringify(n.parameters).slice(0,2000));
  }
}
console.log('\n=== todos os nós do Auto-open ===');
for (const n of (wf.nodes||[])) console.log(` "${n.name}" type=${n.type}`);

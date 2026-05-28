import fs from 'node:fs';
const env = Object.fromEntries(fs.readFileSync('.env','utf8').split(/\r?\n/).filter(l=>l&&!l.startsWith('#')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i),l.slice(i+1)]}));
const N8N=env.N8N_URL, KEY=env.N8N_API_KEY, CW=env.CHATWOOT_URL, CWK=env.CHATWOOT_API_KEY;
const NH={'X-N8N-API-KEY':KEY,'Accept':'application/json'};

// 1. Verificar estado atual do AGENT
const wf = await fetch(`${N8N}/api/v1/workflows/jleu4RPvSnYDL8Gd`, {headers:NH}).then(r=>r.json());
const conn = wf.connections;
console.log('=== AGENT loop connections ===');
console.log('Aguardar Digitacao [0]:', conn['Aguardar Digitacao']?.main?.[0]?.map(d=>d.node));
console.log('Evolution Enviar [0]:', conn['Evolution Enviar']?.main?.[0]?.map(d=>d.node));
console.log('Chatwoot Enviar [0]:', conn['Chatwoot Enviar']?.main?.[0]?.map(d=>d.node));

// 2. Verificar inbox 12 webhook_url
const inbox = await fetch(`${CW}/api/v1/accounts/1/inboxes`, {headers:{'api_access_token':CWK}}).then(r=>r.json());
const i12 = (inbox.payload||[]).find(i=>i.id===12);
console.log('\n=== Inbox 12 ===');
console.log('webhook_url:', JSON.stringify(i12?.webhook_url));
console.log('name:', i12?.name, '| channel_type:', i12?.channel_type);

// 3. Verificar msgs recentes no Chatwoot (conv 21, 22, 23)
console.log('\n=== Chatwoot msgs recentes (status esperado: sent) ===');
for (const cid of [21, 22, 23]) {
  const msgs = await fetch(`${CW}/api/v1/accounts/1/conversations/${cid}/messages`, {headers:{'api_access_token':CWK}}).then(r=>r.json()).catch(()=>({}));
  const last3 = (msgs.payload||[]).slice(-3);
  console.log(`conv ${cid}:`);
  for (const m of last3) {
    const type = m.message_type===0?'in':'out';
    console.log(`  msg ${m.id} ${type} status=${m.status} "${(m.content||'').slice(0,60)}"`);
  }
}

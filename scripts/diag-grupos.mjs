// Investigar:
// 1) Quais grupos estao mandando msg pro CORE (verificar webhooks Evolution)
// 2) Persona mapping no Mongo
// 3) Estado das conversations no Chatwoot
import fs from 'node:fs';
const env = Object.fromEntries(fs.readFileSync('.env','utf8').split(/\r?\n/).filter(l=>l && !l.startsWith('#')).map(l=>{const i=l.indexOf('=');return [l.slice(0,i), l.slice(i+1)]}));
const N8N=env.N8N_URL, KEY=env.N8N_API_KEY, CW=env.CHATWOOT_API_KEY, EV=env.EVOLUTION_API_KEY;
const H={'X-N8N-API-KEY':KEY,'Accept':'application/json'};

// 1) Ultimas 15 execucoes CORE: olhar remoteJid de cada
console.log('=== ULTIMAS 15 EXEC CORE (webhook input) ===');
const list = await fetch(`${N8N}/api/v1/executions?workflowId=bEb19TdWZfFloisU&limit=15`, {headers:H}).then(r=>r.json());
for (const e of (list.data||[])) {
  const det = await fetch(`${N8N}/api/v1/executions/${e.id}?includeData=true`, {headers:H}).then(r=>r.json());
  const rd = det.data?.resultData?.runData;
  const wbh = rd?.['Webhook']?.[0]?.data?.main?.[0]?.[0]?.json || rd?.[Object.keys(rd||{})[0]]?.[0]?.data?.main?.[0]?.[0]?.json;
  const body = wbh?.body || wbh;
  const evt = body?.event;
  const remote = body?.data?.key?.remoteJid;
  const fromMe = body?.data?.key?.fromMe;
  const conteudo = body?.data?.message?.conversation || body?.data?.message?.extendedTextMessage?.text || JSON.stringify(body?.data?.message||{}).slice(0,60);
  console.log(`${e.id} status=${e.status} evt=${evt} remote=${remote} fromMe=${fromMe} msg=${(conteudo||'').slice(0,60)}`);
}

// 2) Conversations Chatwoot
console.log('\n=== CHATWOOT CONVERSATIONS (account 1) ===');
const conv = await fetch('https://chatwoot.vendly.chat/api/v1/accounts/1/conversations?status=open&page=1', {headers:{api_access_token:CW}}).then(r=>r.json());
const meta = conv.data?.meta;
console.log('total open:', meta?.all_count, 'unassigned:', meta?.unassigned_count);
for (const c of (conv.data?.payload||[]).slice(0,15)) {
  console.log(`  conv ${c.id} inbox=${c.inbox_id} status=${c.status} contact=${c.meta?.sender?.name} identifier=${c.meta?.sender?.identifier} last=${(c.last_non_activity_message?.content||'').slice(0,40)}`);
}

// 3) Inboxes
console.log('\n=== INBOXES ===');
const inboxes = await fetch('https://chatwoot.vendly.chat/api/v1/accounts/1/inboxes', {headers:{api_access_token:CW}}).then(r=>r.json());
for (const i of (inboxes.payload||[])) {
  console.log(`  inbox ${i.id} name=${i.name} channel=${i.channel_type}`);
}

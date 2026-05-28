// Verificar:
// 1) Ultimas execs CORE - quais remoteJid chegam de verdade do Evolution
// 2) Contacts no Chatwoot - qual identifier mapeia a qual grupo
// 3) Persona routes no Redis e Mongo

import fs from 'node:fs';
const env = Object.fromEntries(fs.readFileSync('.env','utf8').split(/\r?\n/).filter(l=>l && !l.startsWith('#')).map(l=>{const i=l.indexOf('=');return [l.slice(0,i), l.slice(i+1)]}));
const N8N=env.N8N_URL, KEY=env.N8N_API_KEY, CW=env.CHATWOOT_API_KEY, EV=env.EVOLUTION_API_KEY;
const H={'X-N8N-API-KEY':KEY,'Accept':'application/json'};

// 1) CORE: last 15 execs, identificar remoteJid REAL do Evolution (não webhooks do Chatwoot)
console.log('=== CORE webhooks - so payload Evolution ===');
const list = await fetch(`${N8N}/api/v1/executions?workflowId=bEb19TdWZfFloisU&limit=30`, {headers:H}).then(r=>r.json());
let i=0;
for (const e of (list.data||[])) {
  if (i>=15) break;
  const det = await fetch(`${N8N}/api/v1/executions/${e.id}?includeData=true`, {headers:H}).then(r=>r.json());
  const rd = det.data?.resultData?.runData;
  // Webhook input - primeiro no
  const firstNode = Object.keys(rd||{})[0];
  const wbh = rd?.[firstNode]?.[0]?.data?.main?.[0]?.[0]?.json;
  const body = wbh?.body || wbh;
  // Evolution payload tem event=messages.upsert e data.key.remoteJid
  if (body?.event === 'messages.upsert' || body?.data?.key?.remoteJid) {
    const remote = body.data?.key?.remoteJid;
    const fromMe = body.data?.key?.fromMe;
    const conteudo = body.data?.message?.conversation || body.data?.message?.extendedTextMessage?.text || '';
    console.log(`exec ${e.id} EVOLUTION remote=${remote} fromMe=${fromMe} msg="${conteudo.slice(0,60)}" startedAt=${e.startedAt}`);
    i++;
  }
}

// 2) Contacts Chatwoot - olhar todos
console.log('\n=== CHATWOOT CONTACTS ===');
const ct = await fetch('https://chatwoot.vendly.chat/api/v1/accounts/1/contacts?page=1&include[]=contact_inboxes', {headers:{api_access_token:CW}}).then(r=>r.json());
for (const c of (ct.payload||[]).slice(0,30)) {
  const cis = (c.contact_inboxes||[]).map(ci=>`inbox${ci.inbox?.id || ci.inbox_id}:src=${ci.source_id}`).join(', ');
  console.log(`  contact ${c.id} name="${c.name}" identifier=${c.identifier} phone=${c.phone_number} [${cis}]`);
}

// 3) Conversation 21 e 23 - olhar source contact_inbox
console.log('\n=== CONV 21 detail ===');
const c21 = await fetch('https://chatwoot.vendly.chat/api/v1/accounts/1/conversations/21', {headers:{api_access_token:CW}}).then(r=>r.json());
console.log('contact_inbox source_id:', c21.contact_inbox?.source_id, ' contact:', c21.meta?.sender?.name, c21.meta?.sender?.identifier);

console.log('\n=== CONV 23 detail ===');
const c23 = await fetch('https://chatwoot.vendly.chat/api/v1/accounts/1/conversations/23', {headers:{api_access_token:CW}}).then(r=>r.json());
console.log('contact_inbox source_id:', c23.contact_inbox?.source_id, ' contact:', c23.meta?.sender?.name, c23.meta?.sender?.identifier);

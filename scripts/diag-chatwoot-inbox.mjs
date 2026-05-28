import fs from 'node:fs';
const env = Object.fromEntries(fs.readFileSync('.env','utf8').split(/\r?\n/).filter(l=>l&&!l.startsWith('#')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i),l.slice(i+1)]}));
const CW=env.CHATWOOT_URL, CWK=env.CHATWOOT_API_KEY, ACCID=env.CHATWOOT_ACCOUNT_ID||1;
const EVO=env.EVOLUTION_URL;
const H={'api_access_token':CWK,'Content-Type':'application/json'};

// Busca todos os inboxes via endpoint correto
console.log('=== Inboxes ===');
const r = await fetch(`${CW}/auth/sign_in`, {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({email:'placeholder'})});
// Usa user token via API key diretamente
const r2 = await fetch(`${CW}/api/v1/accounts/${ACCID}/inboxes`, {headers: H});
const raw = await r2.text();
const j2 = JSON.parse(raw);
const payload = j2.payload || [];
console.log(`Total inboxes: ${payload.length}`);
for (const ib of payload) {
  console.log(`\n  id=${ib.id} name="${ib.name}" channel=${ib.channel_type}`);
  console.log(`  webhook_url="${ib.webhook_url||'(vazio)'}"`);
  console.log(`  agent_bot=${JSON.stringify(ib.agent_bot)}`);
}

// Verifica inbox 12 especificamente
console.log('\n=== Inbox 12 detalhes ===');
const ib12 = await fetch(`${CW}/api/v1/accounts/${ACCID}/inboxes/12`, {headers: H}).then(r=>r.json()).catch(()=>null);
if (ib12) {
  console.log(JSON.stringify(ib12, null, 2).slice(0,1000));
} else {
  console.log('Inbox 12 não encontrado');
}

// Verifica msgs recentes com failed
console.log('\n=== Conversações recentes ===');
const convs = await fetch(`${CW}/api/v1/accounts/${ACCID}/conversations?page=1`, {headers:H}).then(r=>r.json()).catch(()=>({}));
const data = convs.data?.payload || convs.payload || [];
for (const c of data.slice(0,5)) {
  console.log(`  conv ${c.id} inbox_id=${c.inbox_id} status=${c.status} msgs=${c.messages_count}`);
  // Pega últimas msgs
  const msgs = await fetch(`${CW}/api/v1/accounts/${ACCID}/conversations/${c.id}/messages`, {headers:H}).then(r=>r.json()).catch(()=>({}));
  const mlist = msgs.payload || [];
  for (const m of mlist.slice(-3)) {
    console.log(`    msg id=${m.id} type=${m.message_type} status="${m.status||'ok'}" content="${(m.content||'').slice(0,60)}"`);
  }
}

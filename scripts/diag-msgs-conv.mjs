// Ver mensagens recentes nas conv 21 (Restaurante 1) e conv 23 (LT Restaurante 1)
// E ver como Chatwoot webhook está configurado
import fs from 'node:fs';
const env = Object.fromEntries(fs.readFileSync('.env','utf8').split(/\r?\n/).filter(l=>l && !l.startsWith('#')).map(l=>{const i=l.indexOf('=');return [l.slice(0,i), l.slice(i+1)]}));
const CW=env.CHATWOOT_API_KEY;

for (const cid of [21, 22, 23]) {
  console.log(`\n=== CONV ${cid} messages (last 10) ===`);
  const m = await fetch(`https://chatwoot.vendly.chat/api/v1/accounts/1/conversations/${cid}/messages`, {headers:{api_access_token:CW}}).then(r=>r.json());
  const msgs = (m.payload||[]).slice(-10);
  for (const msg of msgs) {
    const dt = new Date(msg.created_at*1000).toISOString().slice(11,19);
    const type = msg.message_type===0 ? 'IN' : msg.message_type===1 ? 'OUT' : 'OTHER';
    console.log(`  [${dt}] ${type} id=${msg.id} status=${msg.status} src=${msg.source_id||'-'} content="${(msg.content||'').slice(0,80)}"`);
  }
}

// Webhooks/automations Chatwoot
console.log('\n=== AGENT_BOTS ===');
const ab = await fetch('https://chatwoot.vendly.chat/api/v1/accounts/1/agent_bots', {headers:{api_access_token:CW}}).then(r=>r.json());
console.log(JSON.stringify(ab, null, 2));

console.log('\n=== INBOX 12 detalhes ===');
const ib = await fetch('https://chatwoot.vendly.chat/api/v1/accounts/1/inboxes/12', {headers:{api_access_token:CW}}).then(r=>r.json());
console.log('agent_bot:', ib.agent_bot, ' webhook_url:', ib.webhook_url, ' channel:', JSON.stringify(ib).slice(0,300));

console.log('\n=== WEBHOOKS ===');
const wh = await fetch('https://chatwoot.vendly.chat/api/v1/accounts/1/webhooks', {headers:{api_access_token:CW}}).then(r=>r.json());
console.log(JSON.stringify(wh, null, 2));

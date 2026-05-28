import fs from 'node:fs';
const env = Object.fromEntries(fs.readFileSync('.env','utf8').split(/\r?\n/).filter(l=>l&&!l.startsWith('#')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i),l.slice(i+1)]}));
const N8N=env.N8N_URL, KEY=env.N8N_API_KEY, CW=env.CHATWOOT_URL, CWK=env.CHATWOOT_API_KEY;
const NH={'X-N8N-API-KEY':KEY,'Accept':'application/json'};

const d = await fetch(`${N8N}/api/v1/executions/3218?includeData=true`, {headers:NH}).then(r=>r.json());
const rd = d.data?.resultData?.runData || {};
console.log('Nós executados:', Object.keys(rd));

for (const [name, runs] of Object.entries(rd)) {
  const run = runs[0];
  if (run?.error) {
    console.log(`\nERRO em "${name}":`);
    console.log(JSON.stringify(run.error).slice(0,500));
  }
  const item = run?.data?.main?.[0]?.[0]?.json;
  if (item) {
    const keys = Object.keys(item);
    if (keys.length < 15) console.log(`  "${name}" output keys:`, keys.join(', '));
  }
}

// Ver conv 22 mensagens para ver se chegou algo novo
console.log('\nMsgs conv 22 (últimas 6):');
const msgs = await fetch(`${CW}/api/v1/accounts/1/conversations/22/messages`, {headers:{'api_access_token':CWK}}).then(r=>r.json());
for (const m of (msgs.payload||[]).slice(-6)) {
  console.log(`  msg ${m.id} type=${m.message_type===0?'in':'out'} status=${m.status} "${(m.content||'').slice(0,60)}"`);
}

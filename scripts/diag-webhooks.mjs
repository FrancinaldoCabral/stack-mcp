import fs from 'node:fs';
const env = Object.fromEntries(fs.readFileSync('.env','utf8').split(/\r?\n/).filter(l=>l&&!l.startsWith('#')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i),l.slice(i+1)]}));
const CW=env.CHATWOOT_URL, CWK=env.CHATWOOT_API_KEY;

// Webhooks Chatwoot
console.log('=== Chatwoot Webhooks ===');
const resp = await fetch(`${CW}/api/v1/accounts/1/integrations/webhooks`, {headers:{'api_access_token':CWK}}).then(r=>r.json()).catch(e=>({error:e.message}));
console.log(JSON.stringify(resp, null, 2));

// Verificar também: conversas recentes por inbox para entender fluxo
console.log('\n=== Conversas recentes inbox 12 ===');
const convs = await fetch(`${CW}/api/v1/accounts/1/conversations?page=1`, {headers:{'api_access_token':CWK}}).then(r=>r.json());
const inbox12Convs = (convs.data?.payload||[]).filter(c=>c.inbox_id===12);
for (const c of inbox12Convs.slice(0,5)) {
  console.log(`  conv ${c.id} status=${c.status} assignee=${c.meta?.assignee?.name||'none'} msgs=${c.messages_count}`);
}

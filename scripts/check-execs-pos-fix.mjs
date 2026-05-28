import fs from 'node:fs';
const env = Object.fromEntries(fs.readFileSync('.env','utf8').split(/\r?\n/).filter(l=>l&&!l.startsWith('#')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i),l.slice(i+1)]}));
const N8N=env.N8N_URL, KEY=env.N8N_API_KEY, CW=env.CHATWOOT_URL, CWK=env.CHATWOOT_API_KEY;
const NH={'X-N8N-API-KEY':KEY,'Accept':'application/json'};

// CORE
const c = await fetch(`${N8N}/api/v1/executions?workflowId=bEb19TdWZfFloisU&limit=8`, {headers:NH}).then(r=>r.json());
console.log('CORE execs:');
for (const e of (c.data||[])) console.log(' ',e.id,'status='+e.status, e.startedAt?.slice(11,19));

// AGENT
const a = await fetch(`${N8N}/api/v1/executions?workflowId=jleu4RPvSnYDL8Gd&limit=5`, {headers:NH}).then(r=>r.json());
console.log('AGENT execs:');
for (const e of (a.data||[])) {
  const d = await fetch(`${N8N}/api/v1/executions/${e.id}?includeData=true`, {headers:NH}).then(r=>r.json());
  const rd = d.data?.resultData?.runData;
  const cwe = rd?.['Chatwoot Enviar']?.[0]?.data?.main?.[0]?.[0]?.json;
  const evo = rd?.['Evolution Enviar']?.[0];
  console.log(' ',e.id,'status='+e.status, e.startedAt?.slice(11,19));
  console.log('    Chatwoot Enviar: msg_id='+cwe?.id+' status='+cwe?.status);
  console.log('    Evolution Enviar: '+(evo ? 'EXECUTOU ❌' : 'não executou ✅'));
}

// Msgs da conv 21 no Chatwoot
console.log('\nMensagens conv 21:');
const msgs = await fetch(`${CW}/api/v1/accounts/1/conversations/21/messages`, {headers:{'api_access_token':CWK}}).then(r=>r.json());
for (const m of (msgs.payload||[]).slice(-6)) {
  const t = m.message_type===0?'in':'out';
  console.log(' ',m.id, t, 'status='+m.status, '"'+(m.content||'').slice(0,50)+'"');
}

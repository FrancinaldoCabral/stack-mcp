// Fixes:
// 1) presenceBody no formato V2: {number, presence:'composing', delay} na raiz (sem options)
// 2) Conversations Chatwoot pending -> open
// 3) Inbox 11 (suporte-redatudo) deletar
import fs from 'node:fs';
const env = Object.fromEntries(fs.readFileSync('.env','utf8').split(/\r?\n/).filter(l=>l && !l.startsWith('#')).map(l=>{const i=l.indexOf('=');return [l.slice(0,i), l.slice(i+1)]}));
const N8N=env.N8N_URL, KEY=env.N8N_API_KEY, CW=env.CHATWOOT_API_KEY;
const H={'X-N8N-API-KEY':KEY,'Content-Type':'application/json','Accept':'application/json'};

// 1) Fix Preparar Envio: presenceBody formato V2
const wf = await fetch(`${N8N}/api/v1/workflows/jleu4RPvSnYDL8Gd`, {headers:H}).then(r=>r.json());
const prep = wf.nodes.find(n=>n.name==='Preparar Envio');
prep.parameters.jsCode = `const item = $input.first().json;
const { instance, remoteJid, chunk, delay, conversation_id, account_id } = item;
return [{
  json: {
    ...item,
    presenceUrl: \`https://evolution.vendly.chat/chat/sendPresence/\${instance}\`,
    presenceBody: {
      number: remoteJid,
      presence: 'composing',
      delay: delay ?? 800,
    },
    evolutionUrl: \`https://evolution.vendly.chat/message/sendText/\${instance}\`,
    evolutionBody: { number: remoteJid, text: chunk },
    chatwootUrl: \`https://chatwoot.vendly.chat/api/v1/accounts/\${account_id || '1'}/conversations/\${conversation_id}/messages\`,
    chatwootBody: { content: chunk, message_type: 'outgoing', private: false },
  }
}];`;

const allowed=['executionOrder','saveManualExecutions','saveExecutionProgress','saveDataErrorExecution','saveDataSuccessExecution','timezone','executionTimeout','errorWorkflow','callerPolicy'];
const settings = Object.fromEntries(Object.entries(wf.settings||{executionOrder:'v1'}).filter(([k])=>allowed.includes(k)));
const r1 = await fetch(`${N8N}/api/v1/workflows/jleu4RPvSnYDL8Gd`, {method:'PUT', headers:H, body:JSON.stringify({name:wf.name, nodes:wf.nodes, connections:wf.connections, settings})});
console.log('PUT workflow', r1.status);

// 2) Conversations pending -> open
console.log('\n=== Abrindo conversas pending ===');
const pend = await fetch('https://chatwoot.vendly.chat/api/v1/accounts/1/conversations?status=pending', {headers:{api_access_token:CW}}).then(r=>r.json());
for (const c of (pend.data?.payload||[])) {
  if (c.inbox_id !== 12) continue;
  const rr = await fetch(`https://chatwoot.vendly.chat/api/v1/accounts/1/conversations/${c.id}/toggle_status`, {
    method: 'POST', headers: {api_access_token:CW, 'Content-Type':'application/json'},
    body: JSON.stringify({ status: 'open' })
  });
  console.log(`  conv ${c.id} (${c.meta?.sender?.name}) -> ${rr.status}`);
}

// 3) Deletar inbox 11 suporte-redatudo (instance close, orfao)
console.log('\n=== Deletando inbox 11 suporte-redatudo ===');
const di = await fetch('https://chatwoot.vendly.chat/api/v1/accounts/1/inboxes/11', {
  method: 'DELETE', headers: {api_access_token:CW}
});
console.log('DELETE inbox 11:', di.status);

console.log('\nDONE');

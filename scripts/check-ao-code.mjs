import fs from 'node:fs';
const env = Object.fromEntries(fs.readFileSync('.env','utf8').split(/\r?\n/).filter(l=>l&&!l.startsWith('#')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i),l.slice(i+1)]}));
const N8N=env.N8N_URL, KEY=env.N8N_API_KEY;
const NH={'X-N8N-API-KEY':KEY,'Accept':'application/json'};
const wf = await fetch(`${N8N}/api/v1/workflows/Jijw4Dqil3QVYSp8`,{headers:NH}).then(r=>r.json());

const ht = wf.nodes.find(n=>n.name==='Handle Takeover Humano');
const ac = wf.nodes.find(n=>n.name==='Abrir Conversa');
console.log('=== Handle Takeover Humano (linhas com phone/identifier) ===');
ht.parameters.jsCode.split('\n').forEach((l,i)=>{
  if(l.includes('phone')||l.includes('identifier')||l.includes('isGroup')||l.includes('takeover_key')||l.includes('resolvedInbox'))
    console.log(`  L${i+1}: ${l}`);
});
console.log('\n=== Abrir Conversa (linhas com inbox/inboxId) ===');
ac.parameters.jsCode.split('\n').forEach((l,i)=>{
  if(l.includes('inbox')||l.includes('Inbox')||l.includes('!=='))
    console.log(`  L${i+1}: ${l}`);
});

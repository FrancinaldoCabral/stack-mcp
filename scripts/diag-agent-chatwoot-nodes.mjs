import fs from 'node:fs';
const env = Object.fromEntries(fs.readFileSync('.env','utf8').split(/\r?\n/).filter(l=>l&&!l.startsWith('#')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i),l.slice(i+1)]}));
const N8N=env.N8N_URL, KEY=env.N8N_API_KEY;
const NH={'X-N8N-API-KEY':KEY,'Accept':'application/json'};

const wf = await fetch(`${N8N}/api/v1/workflows/jleu4RPvSnYDL8Gd`, {headers:NH}).then(r=>r.json());
console.log('AGENT nós:');
for (const n of wf.nodes) {
  const hasCW = JSON.stringify(n).toLowerCase().includes('chatwoot');
  const hasEvo = JSON.stringify(n).toLowerCase().includes('evolution') || JSON.stringify(n).toLowerCase().includes('sendtext') || JSON.stringify(n).toLowerCase().includes('sendmessage');
  console.log(`  "${n.name}" type=${n.type}${hasCW?' [CHATWOOT]':''}${hasEvo?' [EVOLUTION]':''}`);
}

// Quais nós mencionam chatwoot ou post message
console.log('\n--- nós com Chatwoot ---');
for (const n of wf.nodes) {
  const s = JSON.stringify(n);
  if (s.toLowerCase().includes('chatwoot')) {
    console.log(`\n"${n.name}":`);
    // URL ou jsCode snippet
    const url = n.parameters?.url || '';
    const code = (n.parameters?.jsCode || '').slice(0,300);
    if (url) console.log('  url:', url);
    if (code) console.log('  code:', code);
  }
}

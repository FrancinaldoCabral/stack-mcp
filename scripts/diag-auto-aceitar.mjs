import fs from 'node:fs';
const env = Object.fromEntries(fs.readFileSync('.env','utf8').split(/\r?\n/).filter(l=>l && !l.startsWith('#')).map(l=>{const i=l.indexOf('=');return [l.slice(0,i), l.slice(i+1)]}));
const N8N=env.N8N_URL, KEY=env.N8N_API_KEY, CW=env.CHATWOOT_API_KEY;
const H={'X-N8N-API-KEY':KEY,'Accept':'application/json'};

// 1) jsCode Auto-Aceitar Conversa
const wf = await fetch(`${N8N}/api/v1/workflows/bEb19TdWZfFloisU`, {headers:H}).then(r=>r.json());
const aa = wf.nodes.find(n=>n.name==='Auto-Aceitar Conversa');
console.log('=== Auto-Aceitar Conversa jsCode ===');
console.log(aa?.parameters?.jsCode);

// 2) Exec 3165 (restaurante - parou em Auto-Aceitar): output do Auto-Aceitar
const e1 = await fetch(`${N8N}/api/v1/executions/3165?includeData=true`, {headers:H}).then(r=>r.json());
const rd1 = e1.data?.resultData?.runData;
console.log('\n=== exec 3165 (restaurant) - output Auto-Aceitar Conversa ===');
console.log('Aplicar Filtro out:', JSON.stringify(rd1?.['Aplicar Filtro Contatos']?.[0]?.data?.main?.[0]?.[0]?.json).slice(0,400));
console.log('GET human_takeover:', JSON.stringify(rd1?.['Redis GET human_takeover']?.[0]?.data?.main?.[0]?.[0]?.json));
const aa1 = rd1?.['Auto-Aceitar Conversa']?.[0];
console.log('Auto-Aceitar Conversa data.main[0]:', JSON.stringify(aa1?.data?.main?.[0]).slice(0,400));
console.log('Auto-Aceitar Conversa error:', aa1?.error?.message);

// 3) Exec 3138 (entregadores - chegou ao fim): output do Auto-Aceitar
const e2 = await fetch(`${N8N}/api/v1/executions/3138?includeData=true`, {headers:H}).then(r=>r.json());
const rd2 = e2.data?.resultData?.runData;
const aa2 = rd2?.['Auto-Aceitar Conversa']?.[0];
console.log('\n=== exec 3138 (deliverer) - output Auto-Aceitar Conversa ===');
console.log('Aplicar Filtro out:', JSON.stringify(rd2?.['Aplicar Filtro Contatos']?.[0]?.data?.main?.[0]?.[0]?.json).slice(0,400));
console.log('GET human_takeover:', JSON.stringify(rd2?.['Redis GET human_takeover']?.[0]?.data?.main?.[0]?.[0]?.json));
console.log('Auto-Aceitar Conversa data.main[0]:', JSON.stringify(aa2?.data?.main?.[0]).slice(0,400));

// 4) Tentar set_agent_bot com agent_bot_id
console.log('\n=== set_agent_bot retry (agent_bot_id) ===');
const r2 = await fetch('https://chatwoot.vendly.chat/api/v1/accounts/1/inboxes/12/set_agent_bot', {
  method: 'POST', headers: { api_access_token: CW, 'Content-Type':'application/json' },
  body: JSON.stringify({ agent_bot_id: 1 })
});
console.log('agent_bot_id status:', r2.status, await r2.text().then(t=>t.slice(0,200)));

const ib = await fetch('https://chatwoot.vendly.chat/api/v1/accounts/1/inboxes/12', {headers:{api_access_token:CW}}).then(r=>r.json());
console.log('inbox 12 after retry - agent_bot:', JSON.stringify(ib.agent_bot));

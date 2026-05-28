// Pega payload de uma exec CORE agentbot recente (formato Chatwoot agentbot)
// Modifica para apontar ao grupo Restaurante (conv 21, jid 120363410205219199)
// Re-dispara webhook chatwoot-bot
import fs from 'node:fs';
const env = Object.fromEntries(fs.readFileSync('.env','utf8').split(/\r?\n/).filter(l=>l && !l.startsWith('#')).map(l=>{const i=l.indexOf('=');return [l.slice(0,i), l.slice(i+1)]}));
const N8N=env.N8N_URL, KEY=env.N8N_API_KEY;
const H={'X-N8N-API-KEY':KEY,'Accept':'application/json'};

// Pega exec 3165 (que tinha msg do restaurante e parou em Auto-Aceitar) - payload original
const det = await fetch(`${N8N}/api/v1/executions/3165?includeData=true`, {headers:H}).then(r=>r.json());
const rd = det.data?.resultData?.runData;
const wbh = rd?.['Webhook Evolution']?.[0]?.data?.main?.[0]?.[0]?.json;
const body = wbh?.body || wbh;

console.log('payload type:', body?.message_type, ' conv:', body?.conversation?.id, ' content:', (body?.content||'').slice(0,80));

// modifica conteudo
body.content = 'oi pessoal, teste apos limpeza takeover ' + Date.now();

// Re-dispara webhook chatwoot-bot
const r = await fetch(`${N8N.replace('/api/v1','')}/webhook/chatwoot-bot`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body)
});
console.log('webhook chatwoot-bot status:', r.status);
console.log((await r.text()).slice(0,200));

// aguarda 30s (buffer debounce)
await new Promise(r=>setTimeout(r,35000));

// Olha execs novas
console.log('\n=== execs CORE recentes ===');
const list = await fetch(`${N8N}/api/v1/executions?workflowId=bEb19TdWZfFloisU&limit=5`, {headers:H}).then(r=>r.json());
for (const e of (list.data||[])) console.log(`  ${e.id} status=${e.status} startedAt=${e.startedAt}`);

console.log('\n=== execs AGENT recentes ===');
const lae = await fetch(`${N8N}/api/v1/executions?workflowId=jleu4RPvSnYDL8Gd&limit=3`, {headers:H}).then(r=>r.json());
for (const e of (lae.data||[])) {
  const dd = await fetch(`${N8N}/api/v1/executions/${e.id}?includeData=true`, {headers:H}).then(r=>r.json());
  const rd2 = dd.data?.resultData?.runData;
  const w = rd2?.['Webhook Agente']?.[0]?.data?.main?.[0]?.[0]?.json;
  const b = w?.body || w;
  const ev = rd2?.['Evolution Enviar']?.[0]?.data?.main?.[0]?.[0]?.json;
  console.log(`  ${e.id} status=${e.status} jid=${b?.telefone} msg="${(b?.conteudo||'').slice(0,40)}" reply.id=${ev?.key?.id} reply.text="${(ev?.message?.conversation||'').slice(0,60)}"`);
}

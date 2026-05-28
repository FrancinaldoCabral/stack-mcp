// Pega o payload real de uma execucao anterior e re-dispara o webhook agent-executor
// Depois verifica a nova execucao: Evolution Enviar status, e busca msg no grupo via Evolution chat/findMessages.
import fs from 'node:fs';
const env = Object.fromEntries(fs.readFileSync('.env','utf8').split(/\r?\n/).filter(l=>l && !l.startsWith('#')).map(l=>{const i=l.indexOf('=');return [l.slice(0,i), l.slice(i+1)]}));
const N8N = env.N8N_URL, KEY = env.N8N_API_KEY, EV = env.EVOLUTION_API_KEY;
const H = { 'X-N8N-API-KEY': KEY, 'Accept':'application/json' };

// 1) pega execucao 3014 com data, descobre payload do Webhook Agente
const ex = await fetch(`${N8N}/api/v1/executions/3014?includeData=true`, { headers: H }).then(r=>r.json());
const runData = ex.data?.resultData?.runData || JSON.parse(ex.data || '{}').resultData?.runData;
const wbh = runData?.['Webhook Agente']?.[0]?.data?.main?.[0]?.[0]?.json;
if (!wbh) { console.log('no webhook data'); console.log(Object.keys(runData||{}).slice(0,30)); process.exit(1); }
const body = wbh.body || wbh;
console.log('payload keys:', Object.keys(body));
console.log('instance:', body.instance, 'telefone:', body.telefone, 'mensagem:', (body.mensagem||'').slice(0,80));

// 2) altera mensagem pra testar
body.mensagem = 'teste real evolution direto ' + Date.now();

// 3) dispara webhook
const wbUrl = `${N8N.replace('/api/v1','')}/webhook/agent-executor`;
console.log('POST', wbUrl);
const r = await fetch(wbUrl, { method:'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(body) });
console.log('webhook status', r.status);
console.log('resp:', (await r.text()).slice(0,300));

// 4) aguarda 30s e busca ultima execucao
await new Promise(r=>setTimeout(r,30000));
const list = await fetch(`${N8N}/api/v1/executions?workflowId=jleu4RPvSnYDL8Gd&limit=3`, { headers: H }).then(r=>r.json());
const last = list.data?.[0];
console.log('\nlast exec:', last?.id, 'status:', last?.status, 'finished:', last?.finished);

// 5) Detalhes do Evolution Enviar
const det = await fetch(`${N8N}/api/v1/executions/${last.id}?includeData=true`, { headers: H }).then(r=>r.json());
const rd = det.data?.resultData?.runData || JSON.parse(det.data||'{}').resultData?.runData;
const evNode = rd?.['Evolution Enviar']?.[0];
console.log('\nEvolution Enviar executed:', !!evNode);
if (evNode) {
  console.log('exec time ms:', evNode.executionTime);
  const out = evNode.data?.main?.[0]?.[0]?.json;
  console.log('Evolution response:', JSON.stringify(out).slice(0,500));
  const err = evNode.error;
  if (err) console.log('Evolution ERROR:', JSON.stringify(err).slice(0,500));
}
const cwNode = rd?.['Chatwoot Enviar']?.[0];
if (cwNode) console.log('Chatwoot Enviar response:', JSON.stringify(cwNode.data?.main?.[0]?.[0]?.json).slice(0,300));

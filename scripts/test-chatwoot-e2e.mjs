import fs from 'node:fs';
const env = Object.fromEntries(fs.readFileSync('.env','utf8').split(/\r?\n/).filter(l=>l&&!l.startsWith('#')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i),l.slice(i+1)]}));
const N8N=env.N8N_URL, KEY=env.N8N_API_KEY, CW=env.CHATWOOT_URL, CWK=env.CHATWOOT_API_KEY;
const NH={'X-N8N-API-KEY':KEY,'Accept':'application/json'};
const CWH={'api_access_token':CWK,'Content-Type':'application/json'};

// Dispara uma mensagem de teste pelo webhook chatwoot-bot (usando payload de conv 22 - privado naldocabral)
// para não poluir o grupo restaurante com mensagens de teste
const det = await fetch(`${N8N}/api/v1/executions/3178?includeData=true`, {headers:NH}).then(r=>r.json());
const rd = det.data?.resultData?.runData;
const wbh = rd?.['Webhook Evolution']?.[0]?.data?.main?.[0]?.[0]?.json;
const body = wbh?.body || wbh;

if (!body) { console.log('exec 3178 sem payload, buscando outro...'); process.exit(1); }
body.content = 'teste fix webhook ' + Date.now();
console.log('conv:', body?.conversation?.id, 'tel:', body?.conversation?.meta?.sender?.phone_number);

const r = await fetch(`${N8N.replace('/api/v1','')}/webhook/chatwoot-bot`, {
  method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(body)
});
console.log('webhook status:', r.status);

// aguarda 40s (debounce + agent)
console.log('aguardando 40s...');
await new Promise(r=>setTimeout(r,42000));

// Verifica execs AGENT recentes
console.log('\n=== AGENT execs recentes ===');
const list = await fetch(`${N8N}/api/v1/executions?workflowId=jleu4RPvSnYDL8Gd&limit=3`, {headers:NH}).then(r=>r.json());
for (const e of (list.data||[])) {
  const d = await fetch(`${N8N}/api/v1/executions/${e.id}?includeData=true`, {headers:NH}).then(r=>r.json());
  const rd2 = d.data?.resultData?.runData;
  const cw = rd2?.['Chatwoot Enviar']?.[0]?.data?.main?.[0]?.[0]?.json;
  const evoEnv = rd2?.['Evolution Enviar']?.[0];
  console.log(`  exec ${e.id} status=${e.status}`);
  console.log(`    Chatwoot Enviar: ${cw ? 'executou, msg_id='+cw.id+' status='+cw.status : 'não executou'}`);
  console.log(`    Evolution Enviar: ${evoEnv ? 'executou (INESPERADO!)' : 'não executou ✅'}`);
}

// Verifica msgs da conversa no Chatwoot
const convId = body?.conversation?.id;
if (convId) {
  console.log(`\n=== Mensagens da conv ${convId} no Chatwoot ===`);
  const msgs = await fetch(`${CW}/api/v1/accounts/1/conversations/${convId}/messages`, {headers:CWH}).then(r=>r.json()).catch(()=>({}));
  for (const m of (msgs.payload||[]).slice(-5)) {
    console.log(`  msg ${m.id} type=${m.message_type} status="${m.status}" content="${(m.content||'').slice(0,60)}"`);
  }
}

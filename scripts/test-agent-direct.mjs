import fs from 'node:fs';
const env = Object.fromEntries(fs.readFileSync('.env','utf8').split(/\r?\n/).filter(l=>l&&!l.startsWith('#')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i),l.slice(i+1)]}));
const N8N=env.N8N_URL, KEY=env.N8N_API_KEY, CW=env.CHATWOOT_URL, CWK=env.CHATWOOT_API_KEY;
const EVO=env.EVOLUTION_URL, EK=env.EVOLUTION_API_KEY;
const NH={'X-N8N-API-KEY':KEY,'Accept':'application/json'};

// 1. Verificar se Evolution webhook Chatwoot está acessível
console.log('=== Test Evolution Chatwoot webhook endpoint ===');
const ewh = await fetch(`${EVO}/chatwoot/webhook/livraison-totale`, {
  method: 'POST',
  headers: {'Content-Type':'application/json', 'apikey': EK},
  body: JSON.stringify({ event: 'ping' }) // payload inválido mas verifica se o endpoint existe
}).catch(e=>({_err: String(e)}));
if (ewh._err) { console.log('ERRO conexão:', ewh._err); }
else { console.log('status:', ewh.status, await ewh.text().then(t=>t.slice(0,200))); }

// 2. Buscar exec AGENT mais recente e ver o payload completo que CORE enviou ao AGENT
console.log('\n=== Formato payload que CORE manda ao AGENT (exec 3199) ===');
const ae = await fetch(`${N8N}/api/v1/executions/3199?includeData=true`, {headers:NH}).then(r=>r.json());
const rd = ae.data?.resultData?.runData;
const wh = rd?.['Webhook Agente']?.[0]?.data?.main?.[0]?.[0]?.json;
const wb = wh?.body || wh;
console.log('campos:', Object.keys(wb||{}).join(', '));
console.log('instance:', wb?.instance, 'telefone:', wb?.telefone, 'conv_id:', wb?.conversation_id, 'account_id:', wb?.account_id);

// 3. Dispara AGENT diretamente com esse payload (para verificar fluxo)
if (wb?.instance) {
  wb.conteudo = 'ola, teste pos-fix webhook_url ' + Date.now();
  console.log('\n=== Disparando AGENT direto ===');
  const r = await fetch(`${N8N.replace('/api/v1','')}/webhook/agent-executor`, {
    method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(wb)
  });
  console.log('agent-executor status:', r.status);

  // Aguarda 15s
  await new Promise(r=>setTimeout(r,15000));

  // Verifica
  const al = await fetch(`${N8N}/api/v1/executions?workflowId=jleu4RPvSnYDL8Gd&limit=2`, {headers:NH}).then(r=>r.json());
  for (const e of (al.data||[])) {
    const d = await fetch(`${N8N}/api/v1/executions/${e.id}?includeData=true`, {headers:NH}).then(r=>r.json());
    const rd2 = d.data?.resultData?.runData;
    const cwe = rd2?.['Chatwoot Enviar']?.[0]?.data?.main?.[0]?.[0]?.json;
    const evo = rd2?.['Evolution Enviar']?.[0]?.data?.main?.[0]?.[0]?.json;
    console.log(`AGENT ${e.id} status=${e.status}`);
    console.log(`  Chatwoot Enviar: msg_id=${cwe?.id} status=${cwe?.status}`);
    console.log(`  Evolution Enviar: ${evo ? 'EXECUTOU id='+evo?.key?.id : 'não executou ✅'}`);
  }

  // Verificar msgs da conversa no Chatwoot
  const convId = wb.conversation_id;
  if (convId) {
    const msgs = await fetch(`${CW}/api/v1/accounts/1/conversations/${convId}/messages`, {headers:{'api_access_token':CWK}}).then(r=>r.json());
    console.log(`\nMsgs conv ${convId} (últimas 5):`);
    for (const m of (msgs.payload||[]).slice(-5)) {
      console.log(`  msg ${m.id} type=${m.message_type===0?'in':'out'} status=${m.status} "${(m.content||'').slice(0,60)}"`);
    }
  }
}

import fs from 'node:fs';
const env = Object.fromEntries(fs.readFileSync('.env','utf8').split(/\r?\n/).filter(l=>l&&!l.startsWith('#')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i),l.slice(i+1)]}));
const N8N=env.N8N_URL, KEY=env.N8N_API_KEY, CW=env.CHATWOOT_URL, CWK=env.CHATWOOT_API_KEY;
const NH={'X-N8N-API-KEY':KEY,'Accept':'application/json'};

// Ver CORE 3216 em detalhe - chegou a disparar debounce?
console.log('=== CORE 3216 detalhes ===');
const c216 = await fetch(`${N8N}/api/v1/executions/3216?includeData=true`, {headers:NH}).then(r=>r.json());
const rd = c216.data?.resultData?.runData || {};
console.log('Nós executados:', Object.keys(rd));
// Ver o que saiu do nó HTTP para debounce
const debNode = rd['HTTP POST Debounce'] || rd['Dispara Debounce'] || rd['HTTP Debounce'] || rd['Debounce Trigger'];
if (debNode) console.log('Debounce trigger result:', JSON.stringify(debNode[0]?.data?.main?.[0]?.[0]?.json).slice(0,200));
// Ver erros
for (const [name, runs] of Object.entries(rd)) {
  if (runs[0]?.error) console.log('ERRO em', name, ':', JSON.stringify(runs[0].error).slice(0,200));
}
// Ver instância e telefone processados
for (const name of Object.keys(rd)) {
  const item = rd[name]?.[0]?.data?.main?.[0]?.[0]?.json;
  const inst = item?.instance || item?.body?.instance;
  const tel = item?.telefone || item?.body?.telefone;
  if (inst || tel) { console.log('  ['+name+'] instance='+inst+' tel='+tel); break; }
}

// Ver Debounce execs recentes
console.log('\n=== DEBOUNCE execs recentes ===');
const d = await fetch(`${N8N}/api/v1/executions?workflowId=FacKqM3e2LsHE6NY&limit=5`, {headers:NH}).then(r=>r.json());
for (const e of (d.data||[])) console.log(' ',e.id,'status='+e.status, e.startedAt?.slice(11,19));

// Dispara teste direto no Evolution webhook (simula msg chegando do WhatsApp para conv privada naldocabral)
// Usa payload de exec CORE anterior que processou conv 22
console.log('\n=== Disparando teste CORE direto ===');
const prevCore = await fetch(`${N8N}/api/v1/executions/3207?includeData=true`, {headers:NH}).then(r=>r.json());
const crd = prevCore.data?.resultData?.runData;
const wbhNode = Object.keys(crd||{}).find(k=>k.toLowerCase().includes('webhook'));
const wbhData = wbhNode ? crd[wbhNode]?.[0]?.data?.main?.[0]?.[0]?.json : null;
const wb = wbhData?.body || wbhData;
console.log('payload instance='+wb?.instance, 'tel='+wb?.telefone, 'conv='+wb?.conversation_id);
if (wb) {
  wb.content = 'ola, teste pos-fix chatwoot ' + Date.now();
  const rt = await fetch(`${N8N.replace('/api/v1','')}/webhook/chatwoot-bot`, {
    method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(wb)
  });
  console.log('dispatch status:', rt.status);
}

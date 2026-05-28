import fs from 'node:fs';
const env = Object.fromEntries(fs.readFileSync('.env','utf8').split(/\r?\n/).filter(l=>l&&!l.startsWith('#')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i),l.slice(i+1)]}));
const CWK=env.CHATWOOT_API_KEY, N8N=env.N8N_URL, KEY=env.N8N_API_KEY;
const NH={'X-N8N-API-KEY':KEY,'Accept':'application/json'};

// 1. Auto-open recent execs
const ao = await fetch(`${N8N}/api/v1/executions?workflowId=Jijw4Dqil3QVYSp8&limit=10`,{headers:NH}).then(r=>r.json());
console.log('=== Auto-open execuções recentes ===');
for(const e of (ao.data||[])) console.log(' ',e.id,e.status,e.startedAt?.slice(0,19));
if(!ao.data?.length) console.log('  (nenhuma execução recente)');

// 2. Chatwoot webhooks
for(const path of [
  '/api/v1/accounts/1/integrations/webhooks',
  '/api/v1/accounts/1/webhooks',
]) {
  const r = await fetch(`https://chatwoot.vendly.chat${path}`,{headers:{'api_access_token':CWK}});
  console.log(`\nChatwoot ${path}: status=${r.status}`);
  if(r.status===200) {
    const d = await r.json();
    console.log(JSON.stringify(d).slice(0,600));
  }
}

// 3. Check se existe Redis key human_takeover residual
const REDIS=env.REDIS_URL;
// via N8N exec test não é possível direto, mas podemos checar via execução AGENT
console.log('\n=== Verificação: keys human_takeover no Redis ===');
console.log('(não é possível verificar diretamente sem acesso Redis — checar via dashboard)');

// 4. Verificar se Auto-open webhook URL está correto no N8N
const aoWf = await fetch(`${N8N}/api/v1/workflows/Jijw4Dqil3QVYSp8`,{headers:NH}).then(r=>r.json());
const aoWh = aoWf.nodes.find(n=>n.name==='Webhook Auto-Open');
const aoPath = aoWh?.parameters?.path || 'cw-auto-open';
console.log(`\n=== Auto-open webhook URL esperado: ${N8N}/webhook/${aoPath} ===`);
console.log('(este URL precisa estar configurado nos webhooks do Chatwoot)');

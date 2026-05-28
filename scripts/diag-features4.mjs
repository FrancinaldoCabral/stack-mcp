import fs from 'node:fs';
const env = Object.fromEntries(fs.readFileSync('.env','utf8').split(/\r?\n/).filter(l=>l&&!l.startsWith('#')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i),l.slice(i+1)]}));
const N8N=env.N8N_URL, KEY=env.N8N_API_KEY;
const NH={'X-N8N-API-KEY':KEY,'Accept':'application/json'};

const agent = await fetch(`${N8N}/api/v1/workflows/jleu4RPvSnYDL8Gd`, {headers:NH}).then(r=>r.json());
const conn = agent.connections;

// Quem conecta a "Escalada Humano"?
console.log('=== O que conecta a "Escalada Humano" ===');
for (const [from, outConn] of Object.entries(conn)) {
  for (let b=0; b<(outConn.main?.length||0); b++) {
    const targets = (outConn.main[b]||[]).map(d=>d.node);
    if (targets.includes('Escalada Humano')) console.log(`  ${from} [${b}] → Escalada Humano`);
  }
}

// Loop Chunks done (branch 1) vai para onde?
console.log('\n=== Loop Chunks conexões completas ===');
console.log('  [0]:', conn['Loop Chunks']?.main?.[0]?.map(d=>d.node));
console.log('  [1]:', conn['Loop Chunks']?.main?.[1]?.map(d=>d.node));

// Onde vai o Redis SET Sessao?
console.log('\n=== Redis SET Sessao ===');
console.log('  [0]:', conn['Redis SET Sessao']?.main?.[0]?.map(d=>d.node));
console.log('  [1]:', conn['Redis SET Sessao']?.main?.[1]?.map(d=>d.node));

// Verificar Normalizar Mensagem no CORE - retorna conversation_id?
const core = await fetch(`${N8N}/api/v1/workflows/bEb19TdWZfFloisU`, {headers:NH}).then(r=>r.json());
const norm = core.nodes.find(n=>n.name==='Normalizar Mensagem');
console.log('\n=== CORE Normalizar Mensagem ===');
console.log(norm?.parameters?.jsCode?.slice(0,1000) || JSON.stringify(norm?.parameters).slice(0,500));

// Conexões CORE - verificar se existe IF Human Takeover implícito
// (o Auto-Aceitar Conversa já faz o bloqueio no código — confirmado)
// Mas verificar: o que acontece se a execução do Auto-Aceitar retornar []?
// N8N: se um Code node retorna [], a execução para (nó seguinte não recebe nada)
console.log('\n=== CORE - Análise: retornar [] em Auto-Aceitar silencia o bot? ===');
// Verificar se há conexões downstream de Auto-Aceitar
const coreConn = core.connections;
console.log('Auto-Aceitar [0] →', coreConn['Auto-Aceitar Conversa']?.main?.[0]?.map(d=>d.node));
console.log('Redis GET Dedup [0] →', coreConn['Redis GET Dedup']?.main?.[0]?.map(d=>d.node));
console.log('PUSH Buffer [0] →', coreConn['PUSH Buffer']?.main?.[0]?.map(d=>d.node));

// Auto-open: verificar se webhook_url está configurado no Chatwoot para o Auto-open
const CW=env.CHATWOOT_URL, CWK=env.CHATWOOT_API_KEY;
const settings = await fetch(`${CW}/api/v1/accounts/1/inboxes`, {headers:{'api_access_token':CWK}}).then(r=>r.json());
const inbox12 = (settings.payload||[]).find(i=>i.id===12);
console.log('\n=== Chatwoot Inbox 12 ===');
console.log('name:', inbox12?.name);
console.log('webhook_url:', inbox12?.webhook_url || '(empty)');

// Auto-open webhook URL no N8N
const autoopen = await fetch(`${N8N}/api/v1/workflows/Jijw4Dqil3QVYSp8`, {headers:NH}).then(r=>r.json());
const aoWebhook = autoopen.nodes.find(n=>n.name==='Webhook Auto-Open');
console.log('\n=== Auto-open Webhook URL ===');
console.log(aoWebhook?.parameters);

// Verificar a URL de webhook do Chatwoot para Auto-open e notification hooks
const integrations = await fetch(`${CW}/api/v1/accounts/1/integrations/webhooks`, {headers:{'api_access_token':CWK}}).then(r=>r.json()).catch(()=>({}));
console.log('\n=== Chatwoot Webhooks configurados ===');
for (const w of (integrations.webhooks||integrations||[])) {
  console.log(`  id=${w.id} url=${w.url} events=${JSON.stringify(w.subscriptions||w.events)}`);
}

// Diagnostico abrangente: ultimas execucoes reais, estado dos nos, persona resolvida, etc
import fs from 'node:fs';
const env = Object.fromEntries(fs.readFileSync('.env','utf8').split(/\r?\n/).filter(l=>l && !l.startsWith('#')).map(l=>{const i=l.indexOf('=');return [l.slice(0,i), l.slice(i+1)]}));
const N8N=env.N8N_URL, KEY=env.N8N_API_KEY;
const H={'X-N8N-API-KEY':KEY,'Accept':'application/json'};

// 1) Ultimas 10 execucoes do AGENT executor
const list = await fetch(`${N8N}/api/v1/executions?workflowId=jleu4RPvSnYDL8Gd&limit=10`, {headers:H}).then(r=>r.json());
console.log('=== ULTIMAS 10 EXEC AGENT EXECUTOR ===');
for (const e of (list.data||[])) {
  console.log(`exec ${e.id} status=${e.status} mode=${e.mode} startedAt=${e.startedAt} stopped=${e.stoppedAt||'-'}`);
}

// 2) Detalhe da execucao real mais recente que NAO seja minha de teste (webhook mode)
const realExecs = (list.data||[]).filter(e => e.mode === 'webhook');
console.log(`\n=== exec real mais recente: ${realExecs[0]?.id} ===`);
if (realExecs[0]) {
  const det = await fetch(`${N8N}/api/v1/executions/${realExecs[0].id}?includeData=true`, {headers:H}).then(r=>r.json());
  const rd = det.data?.resultData?.runData;
  const order = Object.keys(rd||{});
  console.log('nodes executed:', order.length);
  console.log('node order:', order.join(' -> '));
  
  // Resolver Persona output
  const persona = rd?.['Resolver Persona']?.[0]?.data?.main?.[0]?.[0]?.json;
  console.log('\nResolver Persona:', JSON.stringify(persona).slice(0,400));
  
  // Webhook input
  const wbh = rd?.['Webhook Agente']?.[0]?.data?.main?.[0]?.[0]?.json;
  const body = wbh?.body || wbh;
  console.log('\nWebhook input: instance=', body?.instance, ' telefone=', body?.telefone, ' conteudo=', (body?.conteudo||body?.mensagem||'').slice(0,100));
  
  // Errors em qualquer no
  console.log('\n=== ERROS ===');
  for (const [name, runs] of Object.entries(rd||{})) {
    const err = runs[0]?.error;
    if (err) console.log(`  ${name}: ${err.message}`);
  }
}

// 3) Workflow CORE Entrada Mensagem - ultimas execucoes
console.log('\n=== ULTIMAS 5 EXEC CORE ENTRADA (bEb19TdWZfFloisU) ===');
const core = await fetch(`${N8N}/api/v1/executions?workflowId=bEb19TdWZfFloisU&limit=5`, {headers:H}).then(r=>r.json());
for (const e of (core.data||[])) {
  console.log(`exec ${e.id} status=${e.status} mode=${e.mode} startedAt=${e.startedAt}`);
}

// 4) Estado do Presence Digitando: existe ainda?
const wf = await fetch(`${N8N}/api/v1/workflows/jleu4RPvSnYDL8Gd`, {headers:H}).then(r=>r.json());
const pres = wf.nodes.find(n=>n.name==='Presence Digitando');
console.log('\n=== Presence Digitando ===');
console.log('exists:', !!pres);
if (pres) console.log('type:', pres.type, 'url:', pres.parameters?.url);
console.log('conn from Presence:', JSON.stringify(wf.connections['Presence Digitando']));
console.log('conn from Aguardar:', JSON.stringify(wf.connections['Aguardar Digitacao']));
console.log('conn from Evolution Enviar:', JSON.stringify(wf.connections['Evolution Enviar']));
console.log('conn from Chatwoot Enviar:', JSON.stringify(wf.connections['Chatwoot Enviar']));

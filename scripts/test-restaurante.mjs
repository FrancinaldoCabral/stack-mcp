// Testar agent-executor com grupo RESTAURANTE explicitamente
import fs from 'node:fs';
const env = Object.fromEntries(fs.readFileSync('.env','utf8').split(/\r?\n/).filter(l=>l && !l.startsWith('#')).map(l=>{const i=l.indexOf('=');return [l.slice(0,i), l.slice(i+1)]}));
const N8N=env.N8N_URL, KEY=env.N8N_API_KEY;
const H={'X-N8N-API-KEY':KEY,'Accept':'application/json'};

// pega payload da exec 3036 (restaurante)
const ex = await fetch(`${N8N}/api/v1/executions/3036?includeData=true`, {headers:H}).then(r=>r.json());
const wbh = ex.data?.resultData?.runData?.['Webhook Agente']?.[0]?.data?.main?.[0]?.[0]?.json;
const body = wbh?.body || wbh;
body.mensagem = 'olá restaurante, teste após fixes ' + Date.now();
body.conteudo = body.mensagem;
console.log('payload remoteJid=', body.telefone, ' mensagem=', body.mensagem);

const r = await fetch(`${N8N}/webhook/agent-executor`, {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body)});
console.log('status', r.status);

await new Promise(r=>setTimeout(r,40000));
const list = await fetch(`${N8N}/api/v1/executions?workflowId=jleu4RPvSnYDL8Gd&limit=2`, {headers:H}).then(r=>r.json());
const last = list.data?.[0];
console.log(`\nexec ${last.id} status=${last.status} finished=${last.finished}`);

const det = await fetch(`${N8N}/api/v1/executions/${last.id}?includeData=true`, {headers:H}).then(r=>r.json());
const rd = det.data?.resultData?.runData;

// Erros
console.log('\n=== ERROS ===');
for (const [name, runs] of Object.entries(rd||{})) {
  for (const run of runs) if (run.error) console.log(`  ${name}: ${run.error.message}`);
}

// Persona resolvido
const pers = rd?.['Resolver Persona']?.[0]?.data?.main?.[0]?.[0]?.json;
console.log('\npersonaKey=', pers?.personaKey, ' restaurantId=', pers?.restaurantId);

// Presence
const pr = rd?.['Presence Digitando']?.[0]?.data?.main?.[0]?.[0]?.json;
console.log('\nPresence response:', JSON.stringify(pr).slice(0,200));

// Evolution
const ev = rd?.['Evolution Enviar']?.[0]?.data?.main?.[0]?.[0]?.json;
console.log('\nEvolution: id=', ev?.key?.id, ' status=', ev?.status, ' text=', ev?.message?.conversation);

// Chatwoot
const cw = rd?.['Chatwoot Enviar']?.[0]?.data?.main?.[0]?.[0]?.json;
console.log('\nChatwoot: id=', cw?.id, ' status=', cw?.status, ' conv=', cw?.conversation_id);

// Diag completo + acoes:
// 1. Detalhes Presence Digitando + Chatwoot Enviar response na exec 3138
// 2. Lista TODAS conversations chatwoot (sem filtro open)
// 3. Verifica personaRoutes no Mongo
import fs from 'node:fs';
const env = Object.fromEntries(fs.readFileSync('.env','utf8').split(/\r?\n/).filter(l=>l && !l.startsWith('#')).map(l=>{const i=l.indexOf('=');return [l.slice(0,i), l.slice(i+1)]}));
const N8N=env.N8N_URL, KEY=env.N8N_API_KEY, CW=env.CHATWOOT_API_KEY, EV=env.EVOLUTION_API_KEY;
const H={'X-N8N-API-KEY':KEY,'Accept':'application/json'};

// 1) Detalhe exec 3138
const det = await fetch(`${N8N}/api/v1/executions/3138?includeData=true`, {headers:H}).then(r=>r.json());
const rd = det.data?.resultData?.runData;

const pres = rd?.['Presence Digitando']?.[0];
console.log('=== Presence Digitando exec 3138 ===');
console.log('execTime:', pres?.executionTime, 'ms');
console.log('response:', JSON.stringify(pres?.data?.main?.[0]?.[0]?.json).slice(0,300));
console.log('error:', pres?.error?.message);

const aguardar = rd?.['Aguardar Digitacao']?.[0];
console.log('\n=== Aguardar Digitacao ===');
console.log('execTime:', aguardar?.executionTime, 'ms');
console.log('output:', JSON.stringify(aguardar?.data?.main?.[0]?.[0]?.json).slice(0,200));

const evo = rd?.['Evolution Enviar']?.[0];
console.log('\n=== Evolution Enviar ===');
console.log('response:', JSON.stringify(evo?.data?.main?.[0]?.[0]?.json).slice(0,300));

const cw = rd?.['Chatwoot Enviar']?.[0];
console.log('\n=== Chatwoot Enviar ===');
console.log('response:', JSON.stringify(cw?.data?.main?.[0]?.[0]?.json).slice(0,400));

// Parsear Chunks output
const chunks = rd?.['Parsear Chunks']?.[0];
console.log('\n=== Parsear Chunks ===');
const chs = chunks?.data?.main?.[0];
console.log('count chunks:', chs?.length, ' total chars:', (chs||[]).map(c=>c.json?.chunk||'').join('').length);
for (const c of (chs||[])) console.log('  delay=', c.json.delay, ' chunk=', (c.json.chunk||'').slice(0,80));

// 2) Conversations Chatwoot - todos status
console.log('\n=== CHATWOOT CONVERSATIONS (ALL status) ===');
for (const st of ['open','resolved','pending','snoozed']) {
  const c = await fetch(`https://chatwoot.vendly.chat/api/v1/accounts/1/conversations?status=${st}`, {headers:{api_access_token:CW}}).then(r=>r.json());
  console.log(`status=${st} total=${c.data?.meta?.all_count}`);
  for (const co of (c.data?.payload||[]).slice(0,5)) {
    console.log(`  conv ${co.id} inbox=${co.inbox_id} contact=${co.meta?.sender?.name||co.meta?.sender?.identifier}`);
  }
}

// 3) Persona routes (via MCP / Redis)
console.log('\n=== Mongo delivery_restaurants personaRoutes ===');
const mongoUri = env.MONGODB_URI;
// usar o MCP local não é viavel — vou usar mongodb driver
try {
  const { MongoClient } = await import('mongodb');
  const client = new MongoClient(mongoUri);
  await client.connect();
  const db = client.db();
  const rests = await db.collection('delivery_restaurants').find({}).toArray();
  for (const r of rests) {
    console.log(`  restaurant ${r._id} name=${r.name} routes=${JSON.stringify(r.personaRoutes)}`);
  }
  await client.close();
} catch(e) { console.log('mongo err:', e.message) }

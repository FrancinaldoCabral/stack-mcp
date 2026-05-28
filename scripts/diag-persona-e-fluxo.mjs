import fs from 'node:fs';
const env = Object.fromEntries(fs.readFileSync('.env','utf8').split(/\r?\n/).filter(l=>l&&!l.startsWith('#')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i),l.slice(i+1)]}));
const N8N=env.N8N_URL, KEY=env.N8N_API_KEY;
const NH={'X-N8N-API-KEY':KEY,'Accept':'application/json'};

const wf = await fetch(`${N8N}/api/v1/workflows/jleu4RPvSnYDL8Gd`, {headers:NH}).then(r=>r.json());

// 1. Resolver Persona code
const rp = wf.nodes.find(n=>n.name==='Resolver Persona');
console.log('=== Resolver Persona jsCode ===');
console.log(rp?.parameters?.jsCode || '(sem code)');

// 2. Ver o que Redis GET Persona Routes retornou na exec 3301 (grupo deliverer)
console.log('\n=== Exec 3301 - Redis GET Persona Routes output ===');
const exc = await fetch(`${N8N}/api/v1/executions/3301?includeData=true`, {headers:NH}).then(r=>r.json());
const rd = exc.data?.resultData?.runData;
const pgr = rd?.['Redis GET Persona Routes']?.[0]?.data?.main?.[0]?.[0]?.json;
console.log('Redis GET Persona Routes output:', JSON.stringify(pgr));
const rpOut = rd?.['Resolver Persona']?.[0]?.data?.main?.[0]?.[0]?.json;
console.log('Resolver Persona output:', JSON.stringify(rpOut).slice(0,300));

// 3. Construir Prompt - ver se usa persona/systemPrompt customizado
const cpOut = rd?.['Construir Prompt']?.[0]?.data?.main?.[0]?.[0]?.json;
console.log('\nConstruir Prompt openRouterBody.messages[0].content (system):', (cpOut?.openRouterBody?.messages?.[0]?.content||'').slice(0,300));

// 4. Ver Escalada Humano path - conexões relevantes no AGENT loop
console.log('\n=== Conexões: Aguardar Digitacao → ? ===');
const conn = wf.connections;
console.log('Aguardar Digitacao [0]:', conn['Aguardar Digitacao']?.main?.[0]?.map(d=>d.node));
console.log('Chatwoot Enviar [0]:', conn['Chatwoot Enviar']?.main?.[0]?.map(d=>d.node));

// 1. Atribuir agent_bot 1 (Vendly AI) à inbox 12 -> garante que TODA msg inbound dispara webhook do CORE
// 2. Conferir Redis GET Contact Filter na exec 3138 (filtros)
// 3. Procurar exec do CORE entre 11:13 e 11:15 que tenha processado msg do grupo Restaurante (120363410205219199)
import fs from 'node:fs';
const env = Object.fromEntries(fs.readFileSync('.env','utf8').split(/\r?\n/).filter(l=>l && !l.startsWith('#')).map(l=>{const i=l.indexOf('=');return [l.slice(0,i), l.slice(i+1)]}));
const N8N=env.N8N_URL, KEY=env.N8N_API_KEY, CW=env.CHATWOOT_API_KEY;
const H={'X-N8N-API-KEY':KEY,'Accept':'application/json'};

// 1. Atribui agent_bot
console.log('=== Atribuindo agent_bot 1 -> inbox 12 ===');
const r1 = await fetch('https://chatwoot.vendly.chat/api/v1/accounts/1/inboxes/12/set_agent_bot', {
  method: 'POST',
  headers: { api_access_token: CW, 'Content-Type':'application/json' },
  body: JSON.stringify({ agent_bot: 1 })
});
console.log('set_agent_bot status:', r1.status, await r1.text().then(t=>t.slice(0,200)));

// confere
const ib = await fetch('https://chatwoot.vendly.chat/api/v1/accounts/1/inboxes/12', {headers:{api_access_token:CW}}).then(r=>r.json());
console.log('inbox 12 agent_bot:', ib.agent_bot);

// 2. Procura execs CORE recentes processando grupo Restaurante 1 (120363410205219199)
console.log('\n=== Buscando execs CORE com mensagens do grupo Restaurante (120363410205219199) ===');
const list = await fetch(`${N8N}/api/v1/executions?workflowId=bEb19TdWZfFloisU&limit=50`, {headers:H}).then(r=>r.json());
for (const e of (list.data||[])) {
  const det = await fetch(`${N8N}/api/v1/executions/${e.id}?includeData=true`, {headers:H}).then(r=>r.json());
  const rd = det.data?.resultData?.runData;
  // Olha conteúdo do webhook
  const fn = Object.keys(rd||{})[0];
  const wbh = rd?.[fn]?.[0]?.data?.main?.[0]?.[0]?.json;
  const body = wbh?.body || wbh;
  const raw = JSON.stringify(body);
  if (raw.includes('120363410205219199')) {
    console.log(`\n  exec ${e.id} status=${e.status} startedAt=${e.startedAt}`);
    console.log('    nodes executed:', Object.keys(rd||{}).join(' -> '));
    // Olha Normalizar Mensagem
    const norm = rd?.['Normalizar Mensagem']?.[0]?.data?.main?.[0]?.[0]?.json;
    if (norm) console.log('    normalizada:', JSON.stringify(norm).slice(0,300));
    // Olha Aplicar Filtro
    const filtro = rd?.['Aplicar Filtro Contatos']?.[0]?.data?.main?.[0];
    console.log('    filtro out items:', filtro?.length);
    if (filtro && filtro[0]?.json) console.log('    filtro first:', JSON.stringify(filtro[0].json).slice(0,200));
    // Erros
    for (const [name, runs] of Object.entries(rd||{})) {
      const err = runs[0]?.error; if (err) console.log(`    ERROR @${name}: ${err.message}`);
    }
  }
}

// 3. Ver Contact Filter cache
console.log('\n=== Contact Filter (Redis GET Contact Filter on exec 3138) ===');
const ex = await fetch(`${N8N}/api/v1/executions/3138?includeData=true`, {headers:H}).then(r=>r.json());
const rd = ex.data?.resultData?.runData;
const cf = rd?.['Redis GET Contact Filter']?.[0]?.data?.main?.[0]?.[0]?.json;
console.log(JSON.stringify(cf, null, 2));

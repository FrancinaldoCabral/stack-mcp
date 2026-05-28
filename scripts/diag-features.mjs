import fs from 'node:fs';
const env = Object.fromEntries(fs.readFileSync('.env','utf8').split(/\r?\n/).filter(l=>l&&!l.startsWith('#')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i),l.slice(i+1)]}));
const N8N=env.N8N_URL, KEY=env.N8N_API_KEY;
const NH={'X-N8N-API-KEY':KEY,'Accept':'application/json'};

const [core, debounce, agent, autoopen] = await Promise.all([
  fetch(`${N8N}/api/v1/workflows/bEb19TdWZfFloisU`, {headers:NH}).then(r=>r.json()),
  fetch(`${N8N}/api/v1/workflows/FacKqM3e2LsHE6NY`, {headers:NH}).then(r=>r.json()),
  fetch(`${N8N}/api/v1/workflows/jleu4RPvSnYDL8Gd`, {headers:NH}).then(r=>r.json()),
  fetch(`${N8N}/api/v1/workflows/Jijw4Dqil3QVYSp8`, {headers:NH}).then(r=>r.json()),
]);

function summarize(wf, featNodes) {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`WORKFLOW: ${wf.name} (${wf.id}) active=${wf.active}`);
  const nodeNames = wf.nodes.map(n=>n.name);
  console.log(`Nós (${nodeNames.length}): ${nodeNames.join(', ')}`);
  for (const feat of featNodes) {
    const n = wf.nodes.find(nd=>nd.name===feat);
    if (!n) { console.log(`  ❌ NÓ NÃO ENCONTRADO: "${feat}"`); continue; }
    console.log(`\n  ✅ "${feat}" (${n.type})`);
    if (n.parameters?.jsCode) console.log('  code:', n.parameters.jsCode.slice(0,500));
    if (n.parameters?.conditions) console.log('  conditions:', JSON.stringify(n.parameters.conditions).slice(0,300));
    if (n.parameters?.operation) console.log('  redis op:', n.parameters.operation, 'key:', n.parameters.key||n.parameters.list);
    if (n.parameters?.url) console.log('  url:', n.parameters.url?.slice?.(0,100) || JSON.stringify(n.parameters.url).slice(0,100));
  }
}

// CORE - verificações de bloqueio e human takeover
summarize(core, [
  'Aplicar Filtro Contatos',
  'IF Bloqueado?',
  'IF Human Takeover?',
  'Redis GET Human Takeover',
  'Verificar Human Takeover',
  'Filtro Blocklist',
]);

// AGENT - escalar humano, set redis
summarize(agent, [
  'IF [ESCALAR_HUMANO]?',
  'Detectar Escalar',
  'Redis SET Human Takeover',
  'Chatwoot Assign Humano',
  'Escalar Humano',
  'Limpar Marcador Escalar',
]);

// Auto-open - reativar bot
summarize(autoopen, [
  'Handle Takeover Humano',
  'Redis DEL Human Takeover',
  'IF Reativar Bot?',
  'IF Reabrir Conversa',
  'IF Resolve',
]);

// Conexões do AGENT post-response (tudo que vem depois do loop)
console.log('\n=== Conexões AGENT pós-OpenRouter ===');
const conn = agent.connections;
const postNodes = ['Montar Resposta', 'Loop Chunks', 'Preparar Envio', 'IF [ESCALAR_HUMANO]?', 'Detectar Escalar', 'Redis SET Human Takeover'];
for (const n of postNodes) {
  const out0 = conn[n]?.main?.[0]?.map(d=>d.node);
  const out1 = conn[n]?.main?.[1]?.map(d=>d.node);
  if (out0||out1) console.log(`  ${n} [0]→[${out0||''}] [1]→[${out1||''}]`);
}

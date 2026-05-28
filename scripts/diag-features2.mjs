import fs from 'node:fs';
const env = Object.fromEntries(fs.readFileSync('.env','utf8').split(/\r?\n/).filter(l=>l&&!l.startsWith('#')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i),l.slice(i+1)]}));
const N8N=env.N8N_URL, KEY=env.N8N_API_KEY;
const NH={'X-N8N-API-KEY':KEY,'Accept':'application/json'};

const [core, agent, autoopen] = await Promise.all([
  fetch(`${N8N}/api/v1/workflows/bEb19TdWZfFloisU`, {headers:NH}).then(r=>r.json()),
  fetch(`${N8N}/api/v1/workflows/jleu4RPvSnYDL8Gd`, {headers:NH}).then(r=>r.json()),
  fetch(`${N8N}/api/v1/workflows/Jijw4Dqil3QVYSp8`, {headers:NH}).then(r=>r.json()),
]);

// ====== CORE ======
console.log('=== CORE - human_takeover + filtro contatos ===');
const coreHt = core.nodes.find(n=>n.name==='Redis GET human_takeover');
console.log('Redis GET human_takeover key:', coreHt?.parameters?.key);
const coreConn = core.connections;
// O que vem depois de Redis GET human_takeover?
console.log('Conexões de Redis GET human_takeover [0]:', coreConn['Redis GET human_takeover']?.main?.[0]?.map(d=>d.node));
// Encontrar o IF que verifica o takeover
const coreIFs = core.nodes.filter(n=>n.type==='n8n-nodes-base.if');
for (const ifn of coreIFs) {
  console.log(`\n  IF "${ifn.name}":`, JSON.stringify(ifn.parameters?.conditions).slice(0,300));
}
// Quais nós têm conexão de saída [1] (false/block)?
for (const [nname, outConn] of Object.entries(coreConn)) {
  const false_branch = outConn.main?.[1]?.map(d=>d.node);
  if (false_branch?.length) console.log(`  ${nname} [false/1] →`, false_branch);
}

// Aplicar Filtro Contatos - code completo
const fcNode = core.nodes.find(n=>n.name==='Aplicar Filtro Contatos');
console.log('\nAplicar Filtro Contatos código:');
console.log(fcNode?.parameters?.jsCode);

// ====== AGENT - Escalada Humano ======
console.log('\n\n=== AGENT - Escalada Humano ===');
const escNodes = ['Escalada Humano','Redis SET Takeover Escalada','Chatwoot Nota Escalada','Chatwoot Add Label Humano','Chatwoot Set Urgent','Chatwoot Reabrir','Preparar Notif WhatsApp','Evolution Send Notif','Montar Resposta'];
const agConn = agent.connections;
for (const nn of escNodes) {
  const n = agent.nodes.find(x=>x.name===nn);
  if (!n) { console.log(`  ❌ ${nn}`); continue; }
  const out0 = agConn[nn]?.main?.[0]?.map(d=>d.node);
  const out1 = agConn[nn]?.main?.[1]?.map(d=>d.node);
  console.log(`  ✅ "${nn}" [0]→${JSON.stringify(out0||[])} [1]→${JSON.stringify(out1||[])}`);
  if (n.parameters?.jsCode) console.log('     code:', n.parameters.jsCode.slice(0,400));
  if (n.parameters?.conditions) console.log('     conditions:', JSON.stringify(n.parameters.conditions).slice(0,200));
}

// Montar Resposta - onde detecta [ESCALAR_HUMANO]?
const mr = agent.nodes.find(n=>n.name==='Montar Resposta');
console.log('\nMontar Resposta code:');
console.log(mr?.parameters?.jsCode?.slice(0,800) || '(sem code)');

// ====== AUTO-OPEN ======
console.log('\n\n=== AUTO-OPEN - Handle Takeover Humano + Redis DEL/SET ===');
const aoConn = autoopen.connections;
const aoNodes = ['Handle Takeover Humano','IF SET ou DEL?','Redis SET human_takeover','Redis DEL human_takeover','Chatwoot Unassign','Toggle Status','Abrir Conversa'];
for (const nn of aoNodes) {
  const n = autoopen.nodes.find(x=>x.name===nn);
  if (!n) { console.log(`  ❌ ${nn}`); continue; }
  const out0 = aoConn[nn]?.main?.[0]?.map(d=>d.node);
  const out1 = aoConn[nn]?.main?.[1]?.map(d=>d.node);
  console.log(`  ✅ "${nn}" [0]→${JSON.stringify(out0||[])} [1]→${JSON.stringify(out1||[])}`);
  if (n.parameters?.jsCode) console.log('     code:', n.parameters.jsCode.slice(0,600));
  if (n.parameters?.key) console.log('     key:', n.parameters.key);
  if (n.parameters?.value) console.log('     value:', n.parameters.value?.slice?.(0,200) || n.parameters.value);
  if (n.parameters?.conditions) console.log('     cond:', JSON.stringify(n.parameters.conditions).slice(0,200));
  if (n.parameters?.url) console.log('     url:', n.parameters.url?.slice?.(0,100));
}

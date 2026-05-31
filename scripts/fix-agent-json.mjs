/**
 * Fix AGENT workflow dois bugs:
 * 1. Construir Prompt: openRouterBody como STRING → objeto (evita JSON parse error no N8N)
 * 2. Preparar Envio: conversation_id/account_id do item raiz → fallback para item.contexto
 */
import fs from 'node:fs';
const env = Object.fromEntries(fs.readFileSync('.env','utf8').split(/\r?\n/).filter(l=>l&&!l.startsWith('#')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i),l.slice(i+1)]}));
const N8N=env.N8N_URL, KEY=env.N8N_API_KEY;
const H={'X-N8N-API-KEY':KEY,'Accept':'application/json','Content-Type':'application/json'};
const WF_ID='jleu4RPvSnYDL8Gd';

const wf = await fetch(`${N8N}/api/v1/workflows/${WF_ID}`,{headers:H}).then(r=>r.json());
console.log(`Workflow: "${wf.name}", ${wf.nodes.length} nós`);

// ─── Fix 1: Construir Prompt — openRouterBody como objeto, não string ────────
// Problema: JSON.stringify(...) → string. N8N HTTP Request v4.2 com specifyBody:'json'
// recebe a string, e se ela contiver {{ }} do N8N template engine, parser falha.
// Fix: passar objeto diretamente. N8N serializa internamente com JSON.stringify.
const cpNode = wf.nodes.find(n=>n.name==='Construir Prompt');
if (!cpNode) { console.error('❌ Construir Prompt não encontrado'); process.exit(1); }

const OLD_CP = `const __openRouterBody = JSON.stringify({ model: __model, messages, temperature: 0.8, tools: [...__baseTools, ...__extraTools], tool_choice: __toolChoice });`;
const NEW_CP = `const __openRouterBody = { model: __model, messages, temperature: 0.8, tools: [...__baseTools, ...__extraTools], tool_choice: __toolChoice }; // objeto, não string — N8N serializa internamente`;

if (!cpNode.parameters.jsCode.includes(OLD_CP)) {
  console.log('⚠️  Construir Prompt: linha JSON.stringify não encontrada');
  console.log('  Linhas com openRouterBody:');
  cpNode.parameters.jsCode.split('\n').filter(l=>l.includes('openRouterBody')).forEach(l=>console.log(' ',l.slice(0,120)));
} else {
  cpNode.parameters.jsCode = cpNode.parameters.jsCode.replace(OLD_CP, NEW_CP);
  console.log('✅ Fix 1: Construir Prompt openRouterBody agora é objeto (não JSON.stringify)');
}

// ─── Fix 2: Preparar Envio — fallback conversation_id/account_id via contexto ─
// Problema: desestrutura do item raiz, mas campos podem estar em item.contexto.
// Fix: const conversation_id = item.conversation_id ?? item.contexto?.conversation_id;
const peNode = wf.nodes.find(n=>n.name==='Preparar Envio');
if (!peNode) { console.error('❌ Preparar Envio não encontrado'); process.exit(1); }

const OLD_PE = `const { instance, remoteJid, chunk, delay, conversation_id, account_id } = item;`;
const NEW_PE = `const { instance, remoteJid, chunk, delay } = item;
const conversation_id = item.conversation_id ?? item.contexto?.conversation_id;
const account_id = item.account_id ?? item.contexto?.account_id ?? '1';`;

if (!peNode.parameters.jsCode.includes(OLD_PE)) {
  console.log('⚠️  Preparar Envio: linha de desestruturação não encontrada');
  console.log('  Primeiros 200 chars:', peNode.parameters.jsCode.slice(0,200));
} else {
  peNode.parameters.jsCode = peNode.parameters.jsCode.replace(OLD_PE, NEW_PE);
  console.log('✅ Fix 2: Preparar Envio conversation_id/account_id com fallback para contexto');
}

// PUT
console.log('\nAplicando PUT no N8N...');
const body = {
  name: wf.name,
  nodes: wf.nodes,
  connections: wf.connections,
  settings: { executionOrder: 'v1', saveManualExecutions: true },
};
const res = await fetch(`${N8N}/api/v1/workflows/${WF_ID}`,{method:'PUT',headers:H,body:JSON.stringify(body)});
if (res.ok) {
  console.log(`✅ AGENT workflow atualizado (status ${res.status})`);
} else {
  const err = await res.text();
  console.error(`❌ Erro ${res.status}: ${err.slice(0,300)}`);
}

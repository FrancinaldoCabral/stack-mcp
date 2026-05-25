import dotenv from 'dotenv';
dotenv.config();
const N8N_KEY = process.env.N8N_API_KEY;
const EXECUTOR_ID = 'jleu4RPvSnYDL8Gd';

async function n8n(path) {
  const r = await fetch(`https://workflows.vendly.chat/api/v1${path}`, {
    headers: { 'X-N8N-API-KEY': N8N_KEY, 'Accept': 'application/json' }
  });
  return r.json();
}

const wf = await n8n(`/workflows/${EXECUTOR_ID}`);
const nodes = wf.nodes;

// Ver Verificar Tool Calls
const vtc = nodes.find(n => n.name === 'Verificar Tool Calls');
if (vtc) {
  console.log('=== VERIFICAR TOOL CALLS ===');
  console.log(vtc.parameters?.jsCode ?? JSON.stringify(vtc.parameters, null, 2));
}

// Ver nós entre OpenRouter e OpenRouter Com Ferramenta
console.log('\n=== CONEXÕES: O que conecta OpenRouter → OpenRouter Com Ferramenta? ===');
const conns = wf.connections ?? {};
// Achar o path
function findPath(from, to, visited = new Set()) {
  if (visited.has(from)) return null;
  visited.add(from);
  const outs = conns[from] ?? {};
  for (const branch of Object.values(outs)) {
    for (const targets of branch) {
      for (const t of targets) {
        if (t.node === to) return [from, to];
        const sub = findPath(t.node, to, new Set(visited));
        if (sub) return [from, ...sub];
      }
    }
  }
  return null;
}

const path = findPath('OpenRouter', 'OpenRouter Com Ferramenta');
console.log('Path:', path?.join(' → ') ?? 'não encontrado');

// Ver cada nó no caminho
if (path) {
  for (const nodeName of path.slice(1, -1)) {
    const node = nodes.find(n => n.name === nodeName);
    if (node) {
      console.log(`\n--- ${nodeName} ---`);
      if (node.parameters?.jsCode) console.log(node.parameters.jsCode.slice(0, 800));
      if (node.parameters?.jsonBody) console.log('jsonBody:', node.parameters.jsonBody.slice(0, 300));
    }
  }
}

// Ver exec 1318 detalhes — o que Verificar Tool Calls produziu?
console.log('\n=== EXEC 1318: VERIFICAR TOOL CALLS output ===');
const det = await n8n('/executions/1318?includeData=true');
const rd = det.data?.resultData?.runData ?? {};
if (rd['Verificar Tool Calls']) {
  const items = rd['Verificar Tool Calls'][0]?.data?.main?.[0] ?? [];
  const err = rd['Verificar Tool Calls'][0]?.error;
  if (err) console.log('ERRO:', err.message);
  else {
    for (const it of items) {
      console.log('  model:', it.json.model);
      console.log('  messages count:', it.json.messages?.length);
      console.log('  temperature:', it.json.temperature);
    }
  }
}

// E Buscar Memoria / ferramenta intermediária
for (const nodeName of ['Buscar Memoria', 'Qdrant Search Ferramenta', 'Qdrant Buscar Memoria', 'Formatar Resultado Ferramenta', 'Preparar Tool Response']) {
  if (rd[nodeName]) {
    console.log(`\n${nodeName}:`, JSON.stringify(rd[nodeName][0]?.data?.main?.[0]?.[0]?.json ?? {}).slice(0, 200));
  }
}

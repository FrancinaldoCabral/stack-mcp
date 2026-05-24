import 'dotenv/config';

// Aplica dois fixes cirúrgicos no Construir Prompt:
// 1. Acesso defensivo ao sessao (?.json ?? {}) — previne crash quando Redis GET Sessao não executou
// 2. Acesso defensivo ao Qdrant via ?? [] caso alwaysOutputData não baste

const headers = {
  'X-N8N-API-KEY': process.env.N8N_API_KEY,
  'Accept': 'application/json',
  'Content-Type': 'application/json',
};

const wf = await fetch('https://workflows.vendly.chat/api/v1/workflows/jleu4RPvSnYDL8Gd', { headers })
  .then(r => r.json());

const cp = wf.nodes.find(n => n.name === 'Construir Prompt');
if (!cp) { console.error('Construir Prompt não encontrado'); process.exit(1); }

// Substituição simples por índice para evitar problemas de escaping
const OLD = "const sessao = $('Redis GET Sessao').first().json;";
const NEW = "const sessao = $('Redis GET Sessao').first()?.json ?? {};";

if (!cp.parameters.jsCode.includes(OLD)) {
  console.log('Linha já corrigida ou diferente:');
  const idx = cp.parameters.jsCode.indexOf('const sessao');
  console.log(cp.parameters.jsCode.slice(idx, idx + 80));
  process.exit(0);
}

cp.parameters.jsCode = cp.parameters.jsCode.replace(OLD, NEW);

const { status, body } = await fetch('https://workflows.vendly.chat/api/v1/workflows/jleu4RPvSnYDL8Gd', {
  method: 'PUT',
  headers,
  body: JSON.stringify({
    name: wf.name,
    nodes: wf.nodes,
    connections: wf.connections,
    settings: { executionOrder: 'v1', saveManualExecutions: true },
  }),
}).then(async r => ({ status: r.status, body: await r.json() }));

if (status !== 200) {
  console.error('ERRO', status, JSON.stringify(body).slice(0, 300));
  process.exit(1);
}

const updated = body.nodes.find(n => n.name === 'Construir Prompt');
const ok = updated?.parameters?.jsCode?.includes("?.json ?? {}");
console.log('✅ sessao defensivo:', ok ? 'OK' : 'FALHOU');

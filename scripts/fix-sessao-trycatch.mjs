import 'dotenv/config';

// Fix: wrap $('Redis GET Sessao') em try/catch
// O optional chaining (?.) não previne exceções — $('NodeName') lança quando o nó não executou

const headers = {
  'X-N8N-API-KEY': process.env.N8N_API_KEY,
  'Accept': 'application/json',
  'Content-Type': 'application/json',
};

const wf = await fetch('https://workflows.vendly.chat/api/v1/workflows/jleu4RPvSnYDL8Gd', { headers })
  .then(r => r.json());

const cp = wf.nodes.find(n => n.name === 'Construir Prompt');
if (!cp) { console.error('Construir Prompt não encontrado'); process.exit(1); }

// Substituir acesso ao sessao por try/catch seguro
const OLD_V1 = "const sessao = $('Redis GET Sessao').first().json;";
const OLD_V2 = "const sessao = $('Redis GET Sessao').first()?.json ?? {};";
const NEW_SAFE = "let sessao = {}; try { sessao = $('Redis GET Sessao').first()?.json ?? {}; } catch {}";

let code = cp.parameters.jsCode;

if (code.includes(OLD_V1)) {
  code = code.replace(OLD_V1, NEW_SAFE);
  console.log('Substituindo V1 →', 'try/catch');
} else if (code.includes(OLD_V2)) {
  code = code.replace(OLD_V2, NEW_SAFE);
  console.log('Substituindo V2 →', 'try/catch');
} else if (code.includes('try { sessao')) {
  console.log('Já tem try/catch — nenhuma alteração necessária');
  process.exit(0);
} else {
  const idx = code.indexOf('sessao');
  console.log('Linha não reconhecida:', code.slice(idx, idx + 80));
  process.exit(1);
}

cp.parameters.jsCode = code;

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
const ok = updated?.parameters?.jsCode?.includes('try { sessao');
console.log('✅ sessao try/catch:', ok ? 'OK' : 'FALHOU');

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

// Todos os nós que fazem chamadas ao OpenRouter
const orNodes = nodes.filter(n => 
  (n.parameters?.url ?? '').includes('openrouter') ||
  (n.parameters?.jsonBody ?? '').includes('openrouter') ||
  n.name.toLowerCase().includes('openrouter') ||
  n.name.toLowerCase().includes('tts')
);

console.log('=== NÓS OPENROUTER ===\n');
for (const n of orNodes) {
  console.log(`--- ${n.name} [${n.type}] ---`);
  if (n.parameters?.url) console.log('  URL:', n.parameters.url);
  if (n.parameters?.jsonBody) {
    console.log('  JSON BODY (500 chars):', String(n.parameters.jsonBody).slice(0, 500));
  }
  if (n.parameters?.jsCode) {
    console.log('  jsCode (500 chars):', String(n.parameters.jsCode).slice(0, 500));
  }
  console.log();
}

// Parse Agente Config completo
const parseAgente = nodes.find(n => n.name === 'Parse Agente Config');
if (parseAgente) {
  console.log('=== PARSE AGENTE CONFIG (código completo) ===');
  console.log(parseAgente.parameters?.jsCode ?? '(sem código)');
}

// Verificar tool calls / function calling nodes
const toolNodes = nodes.filter(n => 
  (n.parameters?.jsonBody ?? '').includes('tools') ||
  (n.parameters?.jsonBody ?? '').includes('tool_choice')
);
console.log('\n=== NÓS COM TOOL CALLS ===');
for (const n of toolNodes) {
  console.log(`\n--- ${n.name} ---`);
  console.log('  jsonBody (300):', String(n.parameters?.jsonBody ?? '').slice(0, 300));
}

// Verificar Construir Prompt completo (ver como define o modelo)
const cp = nodes.find(n => n.name === 'Construir Prompt');
if (cp) {
  console.log('\n=== CONSTRUIR PROMPT (fim do código — onde define model?) ===');
  const code = cp.parameters?.jsCode ?? '';
  // Pegar as últimas 1500 chars onde o model provavelmente é definido
  console.log(code.slice(-1500));
}

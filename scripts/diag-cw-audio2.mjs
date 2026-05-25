import dotenv from 'dotenv';
dotenv.config();
const N8N_KEY = process.env.N8N_API_KEY;
const CW_KEY = 'Db9GHGsN9YVUDhJvD5CHbVTz';
const EXECUTOR_ID = 'jleu4RPvSnYDL8Gd';

async function n8n(path) {
  const r = await fetch(`https://workflows.vendly.chat/api/v1${path}`, {
    headers: { 'X-N8N-API-KEY': N8N_KEY, 'Accept': 'application/json' }
  });
  return r.json();
}

const wf = await n8n(`/workflows/${EXECUTOR_ID}`);
const nodes = wf.nodes;

// Ver Chatwoot Enviar (texto) — comparar com Chatwoot Enviar Audio
const cwEnviar = nodes.find(n => n.name === 'Chatwoot Enviar');
console.log('=== CHATWOOT ENVIAR (texto) ===');
if (cwEnviar?.parameters?.url) console.log('URL:', cwEnviar.parameters.url);
if (cwEnviar?.parameters?.jsonBody) console.log('jsonBody:', cwEnviar.parameters.jsonBody);
if (cwEnviar?.type === 'n8n-nodes-base.httpRequest') console.log('Type: httpRequest');
if (cwEnviar?.parameters?.jsCode) console.log('Code:', cwEnviar.parameters.jsCode.slice(0, 800));
console.log('type:', cwEnviar?.type);
console.log('typeVersion:', cwEnviar?.typeVersion);
console.log('credentials:', JSON.stringify(cwEnviar?.credentials));

// Ver Chatwoot Enviar Audio
const cwEnviarAudio = nodes.find(n => n.name === 'Chatwoot Enviar Audio');
console.log('\n=== CHATWOOT ENVIAR AUDIO ===');
console.log('type:', cwEnviarAudio?.type);
console.log('code:', cwEnviarAudio?.parameters?.jsCode);

// Testar diretamente o endpoint de mensagens no conv 11
console.log('\n=== TESTE DIRETO — POST mensagem no Chatwoot conv 11 ===');
const testResp = await fetch('https://chatwoot.vendly.chat/api/v1/accounts/1/conversations/11/messages', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'api_access_token': CW_KEY,
  },
  body: JSON.stringify({
    content: '[DIAGNÓSTICO] teste de postagem de mensagem de áudio do bot',
    message_type: 'outgoing',
    private: false,
  }),
});
console.log('Status:', testResp.status);
const testData = await testResp.json();
console.log('Response:', JSON.stringify(testData).slice(0, 300));

// Checar todas mensagens em conv 11 após id=390
console.log('\n=== MENSAGENS CONV 11 APÓS id=390 ===');
const msgs11 = await fetch('https://chatwoot.vendly.chat/api/v1/accounts/1/conversations/11/messages', {
  headers: { 'api_access_token': CW_KEY }
});
const msgs11Data = await msgs11.json();
const all11 = msgs11Data.payload ?? [];
console.log(`Total mensagens: ${all11.length}`);
const after390 = all11.filter(m => m.id > 390);
console.log(`Após id=390: ${after390.length}`);
for (const m of after390) {
  const tipo = m.message_type === 0 ? 'IN ' : m.message_type === 1 ? 'OUT' : 'ACT';
  const ts = new Date(m.created_at * 1000).toISOString().slice(0, 19);
  console.log(`  ${tipo} [${ts}] id=${m.id}: ${String(m.content ?? '').slice(0, 100)}`);
}

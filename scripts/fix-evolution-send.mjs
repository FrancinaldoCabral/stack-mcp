import 'dotenv/config';

const N8N = process.env.N8N_URL;
const KEY = process.env.N8N_API_KEY;
const WF_ID = 'jleu4RPvSnYDL8Gd';
const h = { 'X-N8N-API-KEY': KEY, 'Accept': 'application/json', 'Content-Type': 'application/json' };

const wf = await fetch(`${N8N}/api/v1/workflows/${WF_ID}`, { headers: h }).then(r => r.json());

// 1. Atualizar Preparar Envio — adicionar evolutionUrl e evolutionBody
const prepEnvio = wf.nodes.find(n => n.name === 'Preparar Envio');
if (!prepEnvio) { console.error('Preparar Envio not found'); process.exit(1); }

prepEnvio.parameters.jsCode = `const item = $input.first().json;
const { instance, remoteJid, chunk, delay, conversation_id, account_id } = item;

return [{
  json: {
    ...item,
    presenceUrl: \`https://evolution.vendly.chat/chat/sendPresence/\${instance}\`,
    presenceBody: {
      number: remoteJid,
      options: { delay: delay ?? 800, presence: 'composing', number: remoteJid },
    },
    chatwootUrl: \`https://chatwoot.vendly.chat/api/v1/accounts/\${account_id || '1'}/conversations/\${conversation_id}/messages\`,
    chatwootBody: { content: chunk, message_type: 'outgoing', private: false },
    evolutionUrl: \`https://evolution.vendly.chat/message/sendText/\${instance}\`,
    evolutionBody: { number: remoteJid, text: chunk },
  }
}];`;

console.log('Preparar Envio atualizado');

// 2. Corrigir conexões: Chatwoot Enviar → Evolution Send → Loop Chunks
//    (remover Chatwoot Enviar → Loop Chunks; adicionar Chatwoot Enviar → Evolution Send → Loop Chunks)
const c = wf.connections;

// Remover Chatwoot Enviar → Loop Chunks
if (c['Chatwoot Enviar']?.main?.[0]) {
  c['Chatwoot Enviar'].main[0] = c['Chatwoot Enviar'].main[0].filter(
    t => t.node !== 'Loop Chunks'
  );
}

// Adicionar Chatwoot Enviar → Evolution Send
const T = (node) => ({ node, type: 'main', index: 0 });
if (!c['Chatwoot Enviar']) c['Chatwoot Enviar'] = { main: [[]] };
c['Chatwoot Enviar'].main[0].push(T('Evolution Send'));

// Evolution Send → Loop Chunks (já existe, mas garantir)
if (!c['Evolution Send']) c['Evolution Send'] = { main: [[T('Loop Chunks')]] };
else {
  if (!c['Evolution Send'].main) c['Evolution Send'].main = [[T('Loop Chunks')]];
  else if (!c['Evolution Send'].main[0]) c['Evolution Send'].main[0] = [T('Loop Chunks')];
  else {
    const hasLoopChunks = c['Evolution Send'].main[0].some(t => t.node === 'Loop Chunks');
    if (!hasLoopChunks) c['Evolution Send'].main[0].push(T('Loop Chunks'));
  }
}

console.log('Conexões: Chatwoot Enviar → Evolution Send → Loop Chunks');

const body = {
  name: wf.name,
  nodes: wf.nodes,
  connections: wf.connections,
  settings: { executionOrder: 'v1', saveManualExecutions: true },
};

const put = await fetch(`${N8N}/api/v1/workflows/${WF_ID}`, {
  method: 'PUT', headers: h, body: JSON.stringify(body),
});
console.log('PUT status:', put.status);

const act = await fetch(`${N8N}/api/v1/workflows/${WF_ID}/activate`, { method: 'POST', headers: h });
console.log('Activate status:', act.status);

// Verificar conexões resultantes
const wf2 = await fetch(`${N8N}/api/v1/workflows/${WF_ID}`, { headers: h }).then(r => r.json());
const c2 = wf2.connections;
console.log('\n=== Trecho loop de envio ===');
for (const node of ['Aguardar Digitacao', 'Chatwoot Enviar', 'Evolution Send', 'Loop Chunks']) {
  const outs = (c2[node]?.main ?? []).map((arr, i) => `[${i}] ` + arr.map(t => t.node).join(', ')).join(' | ');
  console.log(' ', node, '→', outs || '(nenhum)');
}

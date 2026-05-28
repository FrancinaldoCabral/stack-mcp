// Adiciona nó "Evolution Enviar" entre "Aguardar Digitacao" e "Chatwoot Enviar"
// para garantir entrega no WhatsApp via Evolution direto (Chatwoot→Evolution bridge está falhando).
import fs from 'node:fs';

const env = Object.fromEntries(fs.readFileSync('.env','utf8').split(/\r?\n/).filter(l=>l && !l.startsWith('#')).map(l=>{const i=l.indexOf('=');return [l.slice(0,i), l.slice(i+1)]}));
const N8N = env.N8N_URL || 'https://workflows.vendly.chat';
const KEY = env.N8N_API_KEY;
const WF = 'jleu4RPvSnYDL8Gd';
const H = { 'X-N8N-API-KEY': KEY, 'Content-Type':'application/json', 'Accept':'application/json' };

const r = await fetch(`${N8N}/api/v1/workflows/${WF}`, { headers: H });
const wf = await r.json();

// 1) Atualizar Preparar Envio para incluir evolutionUrl + evolutionBody
const prep = wf.nodes.find(n => n.name === 'Preparar Envio');
const newPrep = `const item = $input.first().json;
const { instance, remoteJid, chunk, delay, conversation_id, account_id } = item;
return [{
  json: {
    ...item,
    presenceUrl: \`https://evolution.vendly.chat/chat/sendPresence/\${instance}\`,
    presenceBody: {
      number: remoteJid,
      options: { delay: delay ?? 800, presence: 'composing', number: remoteJid },
    },
    evolutionUrl: \`https://evolution.vendly.chat/message/sendText/\${instance}\`,
    evolutionBody: { number: remoteJid, text: chunk },
    chatwootUrl: \`https://chatwoot.vendly.chat/api/v1/accounts/\${account_id || '1'}/conversations/\${conversation_id}/messages\`,
    chatwootBody: { content: chunk, message_type: 'outgoing', private: false },
  }
}];`;
prep.parameters.jsCode = newPrep;

// 2) Criar nó Evolution Enviar (se nao existe)
let evo = wf.nodes.find(n => n.name === 'Evolution Enviar');
if (!evo) {
  const aguardar = wf.nodes.find(n => n.name === 'Aguardar Digitacao');
  evo = {
    parameters: {
      method: 'POST',
      url: '={{ $json.evolutionUrl }}',
      authentication: 'genericCredentialType',
      genericAuthType: 'httpHeaderAuth',
      sendBody: true,
      specifyBody: 'json',
      jsonBody: '={{ JSON.stringify($json.evolutionBody) }}',
      options: { response: { response: { neverError: true } } }
    },
    id: 'evolution-enviar-' + Math.random().toString(36).slice(2,10),
    name: 'Evolution Enviar',
    type: 'n8n-nodes-base.httpRequest',
    typeVersion: 4.2,
    position: [aguardar.position[0] + 100, aguardar.position[1] + 130],
    credentials: { httpHeaderAuth: { id: 'K3YGChLlsj7fRfYX', name: 'Evolution API' } }
  };
  wf.nodes.push(evo);
}

// 3) Reroute conexões:  Aguardar Digitacao -> Evolution Enviar -> Chatwoot Enviar -> Loop Chunks
wf.connections['Aguardar Digitacao'] = { main: [[{ node: 'Evolution Enviar', type: 'main', index: 0 }]] };
wf.connections['Evolution Enviar'] = { main: [[{ node: 'Chatwoot Enviar', type: 'main', index: 0 }]] };
// Chatwoot Enviar -> Loop Chunks já existe; mantém.

// 4) PUT (whitelisted)
const put = {
  name: wf.name,
  nodes: wf.nodes,
  connections: wf.connections,
  settings: wf.settings || { executionOrder: 'v1', saveManualExecutions: true }
};
// Filtrar settings whitelisted
const allowed = ['executionOrder','saveManualExecutions','saveExecutionProgress','saveDataErrorExecution','saveDataSuccessExecution','timezone','executionTimeout','errorWorkflow','callerPolicy'];
put.settings = Object.fromEntries(Object.entries(put.settings).filter(([k])=>allowed.includes(k)));

const r2 = await fetch(`${N8N}/api/v1/workflows/${WF}`, { method: 'PUT', headers: H, body: JSON.stringify(put) });
console.log('PUT', r2.status);
if (!r2.ok) console.log(await r2.text());
else console.log('OK — Evolution Enviar injected before Chatwoot Enviar');

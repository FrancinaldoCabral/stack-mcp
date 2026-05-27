import 'dotenv/config';
import axios from 'axios';

const h = { 'X-N8N-API-KEY': process.env.N8N_API_KEY, 'Content-Type': 'application/json' };
const N8N = 'https://workflows.vendly.chat/api/v1';
const WF_ID = 'jleu4RPvSnYDL8Gd';

// ─── Patchar workflow [AGENT] Executor ───────────────────────────────────
const wf = (await axios.get(`${N8N}/workflows/${WF_ID}`, { headers: h })).data;

// 2a) Atualizar nó "Escalada Humano" para incluir contexto extra
const escalada = wf.nodes.find(n => n.name === 'Escalada Humano');
if (!escalada) throw new Error('Escalada Humano não encontrada');
escalada.parameters.jsCode = `
// Processar escalada para atendimento humano
const chunks = $('Parsear Chunks').all();
const hasEscalada = chunks.some(i => i.json.escalarHumano === true);
if (!hasEscalada) return [];

const ctx = chunks[0]?.json?.contexto ?? {};
const { instance, telefone, conversation_id, account_id } = ctx;
if (!instance || !telefone) return [];

// Contexto extra para sinais Chatwoot e notificações WhatsApp
const accId = String(account_id || '1');
const convId = String(conversation_id);
const promptData = $('Construir Prompt').first().json;
const customerName = promptData?.customerName || ctx.customerName || 'Cliente';
const lastUserMsg = promptData?.messages?.[promptData.messages.length - 1];
const lastUserText = (
  typeof lastUserMsg?.content === 'string' ? lastUserMsg.content :
  Array.isArray(lastUserMsg?.content)
    ? lastUserMsg.content.filter(p => p.type === 'text').map(p => p.text).join(' ')
    : ''
).replace(/^\\*\\*[^*]+\\*\\*\\s*\\n+/, '').trim();
const botResponse = chunks.map(c => c.json.chunk).filter(Boolean).join('\\n');

const businessDoc = $('MongoDB GET Business').first().json;
const notifyList = Array.isArray(businessDoc?.escalationNotifyList) ? businessDoc.escalationNotifyList : [];

return [{
  json: {
    takeover_key: 'human_takeover:' + instance + ':' + telefone,
    takeover_value: 'escalado',
    conversation_id: convId,
    account_id: accId,
    instance,
    chatwoot_base: 'https://chatwoot.vendly.chat/api/v1/accounts/' + accId + '/conversations/' + convId,
    chatwoot_app_url: 'https://chatwoot.vendly.chat/app/accounts/' + accId + '/conversations/' + convId,
    customer_name: customerName,
    last_user_text: lastUserText,
    bot_response: botResponse,
    notify_list: notifyList,
  },
}];
`.trim();

// 2b) Definir novos nós
function makeNode(name, type, params, x, y, extra = {}) {
  return {
    parameters: params,
    name,
    type,
    typeVersion: type === 'n8n-nodes-base.httpRequest' ? 4.2 : 2,
    position: [x, y],
    id: name.toLowerCase().replace(/[^a-z0-9]+/g, '-') + '-' + Math.random().toString(36).slice(2, 8),
    ...extra,
  };
}

const escPos = escalada.position;
const baseX = (escPos?.[0] ?? 0) + 280;
const baseY = escPos?.[1] ?? 0;

// Posições existentes ocupadas: Redis SET Takeover Escalada e Chatwoot Nota Escalada
// Vou colocar os novos abaixo
const novosNodos = [];

// Add Label
novosNodos.push(makeNode(
  'Chatwoot Add Label Humano',
  'n8n-nodes-base.httpRequest',
  {
    method: 'POST',
    url: "={{ $json.chatwoot_base + '/labels' }}",
    authentication: 'genericCredentialType',
    genericAuthType: 'httpHeaderAuth',
    sendBody: true,
    specifyBody: 'json',
    jsonBody: '={{ JSON.stringify({ labels: ["humano-solicitado"] }) }}',
    options: { response: { response: { neverError: true } } },
  },
  baseX, baseY + 200,
  { credentials: { httpHeaderAuth: { id: 'ah2jhDk7ADl68x9G', name: 'Chatwoot Vendly' } } },
));

// Set Priority Urgent
novosNodos.push(makeNode(
  'Chatwoot Set Urgent',
  'n8n-nodes-base.httpRequest',
  {
    method: 'POST',
    url: "={{ $json.chatwoot_base + '/toggle_priority' }}",
    authentication: 'genericCredentialType',
    genericAuthType: 'httpHeaderAuth',
    sendBody: true,
    specifyBody: 'json',
    jsonBody: '={{ JSON.stringify({ priority: "urgent" }) }}',
    options: { response: { response: { neverError: true } } },
  },
  baseX, baseY + 350,
  { credentials: { httpHeaderAuth: { id: 'ah2jhDk7ADl68x9G', name: 'Chatwoot Vendly' } } },
));

// Toggle Status Open
novosNodos.push(makeNode(
  'Chatwoot Reabrir',
  'n8n-nodes-base.httpRequest',
  {
    method: 'POST',
    url: "={{ $json.chatwoot_base + '/toggle_status' }}",
    authentication: 'genericCredentialType',
    genericAuthType: 'httpHeaderAuth',
    sendBody: true,
    specifyBody: 'json',
    jsonBody: '={{ JSON.stringify({ status: "open" }) }}',
    options: { response: { response: { neverError: true } } },
  },
  baseX, baseY + 500,
  { credentials: { httpHeaderAuth: { id: 'ah2jhDk7ADl68x9G', name: 'Chatwoot Vendly' } } },
));

// Preparar Notif WhatsApp (Code)
novosNodos.push(makeNode(
  'Preparar Notif WhatsApp',
  'n8n-nodes-base.code',
  {
    jsCode: `
const e = $input.first().json;
const list = Array.isArray(e.notify_list) ? e.notify_list : [];
if (!list.length) return [];
const text =
  '🚨 *Pedido de atendimento humano*\\n\\n' +
  'Cliente: ' + (e.customer_name || 'Desconhecido') + '\\n' +
  'Última mensagem: "' + String(e.last_user_text || '').slice(0, 200) + '"\\n' +
  'Resposta do bot: "' + String(e.bot_response || '').slice(0, 200) + '"\\n\\n' +
  '🔗 Abrir conversa:\\n' + e.chatwoot_app_url;
return list.map(num => {
  const digits = String(num).replace(/\\D/g, '');
  if (!digits) return null;
  const jid = digits + '@s.whatsapp.net';
  return { json: { instance: e.instance, number: jid, text } };
}).filter(Boolean);
`.trim(),
  },
  baseX, baseY + 650,
));

// Evolution Send Notif
novosNodos.push(makeNode(
  'Evolution Send Notif',
  'n8n-nodes-base.httpRequest',
  {
    method: 'POST',
    url: "={{ 'https://evolution.vendly.chat/message/sendText/' + $json.instance }}",
    authentication: 'genericCredentialType',
    genericAuthType: 'httpHeaderAuth',
    sendBody: true,
    specifyBody: 'json',
    jsonBody: '={{ JSON.stringify({ number: $json.number, text: $json.text }) }}',
    options: { response: { response: { neverError: true } } },
  },
  baseX + 280, baseY + 650,
  { credentials: { httpHeaderAuth: { id: 'K3YGChLlsj7fRfYX', name: 'Evolution API' } } },
));

// 2c) Adicionar nós (se ainda não existem)
for (const novo of novosNodos) {
  if (!wf.nodes.find(n => n.name === novo.name)) {
    wf.nodes.push(novo);
    console.log('+ nó:', novo.name);
  } else {
    // sobrescrever parâmetros
    const idx = wf.nodes.findIndex(n => n.name === novo.name);
    wf.nodes[idx] = { ...wf.nodes[idx], parameters: novo.parameters, credentials: novo.credentials };
    console.log('~ nó:', novo.name, '(parâmetros atualizados)');
  }
}

// 2d) Conexões: Escalada Humano → todos os novos sinais (em paralelo com SET Takeover/Nota existentes)
const existing = wf.connections['Escalada Humano']?.main?.[0] ?? [];
const novosTargets = [
  'Chatwoot Add Label Humano',
  'Chatwoot Set Urgent',
  'Chatwoot Reabrir',
  'Preparar Notif WhatsApp',
];
const mergedTargets = [...existing];
for (const t of novosTargets) {
  if (!mergedTargets.find(c => c.node === t)) {
    mergedTargets.push({ node: t, type: 'main', index: 0 });
  }
}
wf.connections['Escalada Humano'] = { main: [mergedTargets] };

// Preparar Notif → Evolution Send Notif
wf.connections['Preparar Notif WhatsApp'] = { main: [[{ node: 'Evolution Send Notif', type: 'main', index: 0 }]] };

// 2e) PUT
const payload = {
  name: wf.name,
  nodes: wf.nodes,
  connections: wf.connections,
  settings: { executionOrder: 'v1', saveManualExecutions: true },
};
const r = await axios.put(`${N8N}/workflows/${WF_ID}`, payload, { headers: h });
console.log('PUT workflow status:', r.status, 'updatedAt:', r.data.updatedAt);
console.log('Conexões Escalada Humano →', wf.connections['Escalada Humano'].main[0].map(c => c.node).join(', '));

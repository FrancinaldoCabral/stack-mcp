import 'dotenv/config';
import axios from 'axios';

const base = 'https://workflows.vendly.chat/api/v1';
const headers = { 'X-N8N-API-KEY': process.env.N8N_API_KEY };

const wf = (await axios.get(`${base}/workflows/Jijw4Dqil3QVYSp8`, { headers })).data;
const n = wf.nodes.find(x => x.name === 'Handle Takeover Humano');

n.parameters.jsCode = `
// Detectar takeover humano e gerenciar Redis
const raw = $input.first().json;
const data = raw.body ?? raw;
const event = data.event ?? '';

// Só processa estes eventos
if (!['conversation_updated', 'conversation_status_changed'].includes(event)) return [];

const conv = data.conversation ?? {};
const inboxName = conv.meta?.channel ?? data.inbox?.name ?? String(conv.inbox_id ?? '');

// Fallback: usar inbox_id 11 = suporte-redatudo
const resolvedInbox = inboxName || (conv.inbox_id === 11 ? 'suporte-redatudo' : String(conv.inbox_id ?? ''));
if (!resolvedInbox) return [];

const sender = data.contact ?? conv.meta?.sender ?? {};
const phoneRaw = sender.phone_number ?? '';
const identifier = sender.identifier ?? '';

// Usar identifier (JID completo, ex: 5511999999999@s.whatsapp.net) — igual ao que [CORE] Entrada verifica
// Fallback: concatenar digits + sufixo correto
const isGroup = identifier.includes('@g.us');
const phone = identifier || (phoneRaw.replace(/\\D/g, '') + (isGroup ? '' : '@s.whatsapp.net'));

if (!phone) return [];

const assignee = conv.meta?.assignee ?? conv.assignee ?? null;
const status = conv.status ?? '';

// conversation_status_changed resolvida → limpar takeover + unassign no Chatwoot
if (event === 'conversation_status_changed' && status === 'resolved') {
  const convId = String(conv.id ?? data.id ?? data.conversation?.id ?? '');
  return [{ json: {
    _action: 'delete',
    key: 'human_takeover:' + resolvedInbox + ':' + phone,
    conversation_id: convId,
    account_id: '1',
  }}];
}

// conversation_updated → apenas SET quando assignee definido
// Não fazer DEL aqui (pode ser mudança de label/time — só deleta no resolve)
if (event === 'conversation_updated' && assignee?.id) {
  return [{ json: {
    _action: 'set',
    key: 'human_takeover:' + resolvedInbox + ':' + phone,
    value: assignee.name ?? 'human',
  }}];
}

return [];
`;

const body = {
  name: wf.name,
  nodes: wf.nodes,
  connections: wf.connections,
  settings: { executionOrder: 'v1', saveManualExecutions: true },
};
const r = await axios.put(`${base}/workflows/Jijw4Dqil3QVYSp8`, body, { headers });
console.log('Salvo:', r.status, r.statusText);
console.log('Fix: phone agora usa identifier (JID completo, ex: 5511999999999@s.whatsapp.net)');
console.log('Chave Redis gerada: human_takeover:{inboxName}:{jid} — igual ao que [CORE] Entrada verifica');

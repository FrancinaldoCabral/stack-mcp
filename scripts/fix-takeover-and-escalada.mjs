import 'dotenv/config';
import axios from 'axios';
const h = { 'X-N8N-API-KEY': process.env.N8N_API_KEY, 'Content-Type': 'application/json' };
const N8N = 'https://workflows.vendly.chat/api/v1';

// ========== FIX 1: Handle Takeover Humano em [CORE] Auto-open ==========
const ID_AUTO = 'Jijw4Dqil3QVYSp8';
const wfA = (await axios.get(`${N8N}/workflows/${ID_AUTO}`, { headers: h })).data;
const handle = wfA.nodes.find(n => n.name === 'Handle Takeover Humano');
handle.parameters.jsCode = `
// Detectar takeover humano e gerenciar Redis
const raw = $input.first().json;
const data = raw.body ?? raw;
const event = data.event ?? '';

// Só processa estes eventos
if (!['conversation_updated', 'conversation_status_changed'].includes(event)) return [];

// Para conversation_updated, a conversa está no TOP-LEVEL do body (não em body.conversation)
// Para outros eventos, pode estar sob body.conversation
const conv = data.conversation && Object.keys(data.conversation).length > 0 ? data.conversation : data;

// Resolver nome do inbox (suporte-redatudo) a partir do inbox_id
const inboxId = conv.inbox_id ?? data.inbox_id;
const inboxName = data.inbox?.name ?? conv.inbox?.name;
const resolvedInbox = inboxName || (Number(inboxId) === 11 ? 'suporte-redatudo' : String(inboxId ?? ''));
if (!resolvedInbox) return [];

// Identifier do contato (JID completo, ex: 5511...@s.whatsapp.net ou 1203...@g.us)
const sender = conv.meta?.sender ?? data.meta?.sender ?? data.contact ?? {};
const identifier = sender.identifier ?? '';
const phoneRaw = sender.phone_number ?? '';
const isGroup = identifier.includes('@g.us');
const phone = identifier || (phoneRaw.replace(/\\D/g, '') + (isGroup ? '' : '@s.whatsapp.net'));
if (!phone) return [];

const assignee = conv.meta?.assignee ?? data.meta?.assignee ?? conv.assignee ?? null;
const status = conv.status ?? data.status ?? '';
const convId = String(conv.id ?? data.id ?? '');
const takeoverKey = 'human_takeover:' + resolvedInbox + ':' + phone;

// Detectar mudança de assignee em changed_attributes
const changedAttrs = data.changed_attributes ?? conv.changed_attributes ?? [];
let assigneeChange = null;
for (const attr of changedAttrs) {
  if (attr.assignee_id !== undefined) { assigneeChange = attr.assignee_id; break; }
}
const wasUnassigned = assigneeChange && assigneeChange.current_value === null;
const wasAssigned = assigneeChange && assigneeChange.current_value !== null;

// 1) Conversa resolvida → DEL takeover (bot pode voltar) + unassign no Chatwoot
if (event === 'conversation_status_changed' && status === 'resolved') {
  return [{ json: { _action: 'delete', key: takeoverKey, conversation_id: convId, account_id: '1' } }];
}

// 2) Assignee REMOVIDO (assign → unassign) → DEL takeover (bot retoma)
if (event === 'conversation_updated' && wasUnassigned) {
  return [{ json: { _action: 'delete', key: takeoverKey, conversation_id: convId, account_id: '1' } }];
}

// 3) Assignee ATRIBUÍDO (null → user) → SET takeover (bot silencia)
if (event === 'conversation_updated' && (wasAssigned || assignee?.id)) {
  return [{ json: { _action: 'set', key: takeoverKey, value: (assignee?.name ?? 'human') } }];
}

return [];
`;

await axios.put(`${N8N}/workflows/${ID_AUTO}`, {
  name: wfA.name, nodes: wfA.nodes, connections: wfA.connections,
  settings: { executionOrder: 'v1', saveManualExecutions: true },
}, { headers: h });
console.log('✓ Fix 1: Handle Takeover Humano corrigido (lê top-level body, trata unassign)');

// ========== FIX 2: Escalada Humano direto de Parsear Chunks ==========
const ID_AG = 'jleu4RPvSnYDL8Gd';
const wfB = (await axios.get(`${N8N}/workflows/${ID_AG}`, { headers: h })).data;

// 1) Adicionar conexão Parsear Chunks (output 0) → Escalada Humano
const pcConns = wfB.connections['Parsear Chunks'].main;
pcConns[0] = pcConns[0] ?? [];
const alreadyHas = pcConns[0].some(c => c.node === 'Escalada Humano');
if (!alreadyHas) {
  pcConns[0].push({ node: 'Escalada Humano', type: 'main', index: 0 });
}

// 2) Remover Loop Chunks output 1 → Escalada Humano
const lcConns = wfB.connections['Loop Chunks'].main;
if (lcConns[1]) {
  lcConns[1] = lcConns[1].filter(c => c.node !== 'Escalada Humano');
}

// 3) Remover Chatwoot Enviar Audio → Escalada Humano (Escalada já roda direto)
const ceaConns = wfB.connections['Chatwoot Enviar Audio']?.main;
if (ceaConns?.[0]) {
  ceaConns[0] = ceaConns[0].filter(c => c.node !== 'Escalada Humano');
}

await axios.put(`${N8N}/workflows/${ID_AG}`, {
  name: wfB.name, nodes: wfB.nodes, connections: wfB.connections,
  settings: { executionOrder: 'v1', saveManualExecutions: true },
}, { headers: h });
console.log('✓ Fix 2: Escalada Humano agora dispara direto de Parsear Chunks');

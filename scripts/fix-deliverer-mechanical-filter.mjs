/**
 * fix-deliverer-mechanical-filter.mjs
 *
 * Implementa filtro MECÂNICO para o grupo de entregadores usando
 * a função nativa "Responder" do WhatsApp via campo in_reply_to_external_id do Chatwoot.
 *
 * PASSO 1 — CORE ENTRADA (bEb19TdWZfFloisU):
 *   Normalizar Mensagem: extrai in_reply_to_external_id e in_reply_to
 *
 * PASSO 2 — CORE DEBOUNCE (FacKqM3e2LsHE6NY):
 *   Consolidar e Preparar: propaga reply_to_external_id
 *
 * PASSO 3 — AGENT EXECUTOR (jleu4RPvSnYDL8Gd):
 *   Resolver Persona: filtro mecânico — só processa se tem reply_to_external_id
 *   Parsear Chunks: remove [SKIP] (não é mais necessário)
 *
 * PASSO 4 — MongoDB:
 *   Persona deliverer: remove [SKIP] e listas de palavras-chave, simplifica
 */
import 'dotenv/config';

const N8N = process.env.N8N_URL || 'https://workflows.vendly.chat';
const KEY = process.env.N8N_API_KEY;
const APP = process.env.APP_URL || 'https://app.vendly.chat';
const H = { 'X-N8N-API-KEY': KEY, 'Accept': 'application/json', 'Content-Type': 'application/json' };
if (!KEY) { console.error('N8N_API_KEY ausente'); process.exit(1); }

async function getWf(id) {
  return fetch(`${N8N}/api/v1/workflows/${id}`, { headers: H }).then(r => r.json());
}
async function putWf(id, wf) {
  const allowed = ['saveExecutionProgress','saveManualExecutions','saveDataErrorExecution','saveDataSuccessExecution','executionTimeout','errorWorkflow','timezone','executionOrder'];
  const settings = {};
  for (const k of allowed) if (wf.settings?.[k] !== undefined) settings[k] = wf.settings[k];
  if (!settings.executionOrder) settings.executionOrder = 'v1';
  const r = await fetch(`${N8N}/api/v1/workflows/${id}`, {
    method: 'PUT', headers: H,
    body: JSON.stringify({ name: wf.name, nodes: wf.nodes, connections: wf.connections, settings }),
  });
  const j = await r.json();
  if (!r.ok) throw new Error('PUT falhou: ' + JSON.stringify(j).slice(0, 200));
  return j;
}
async function mcpTool(name, args) {
  const r = await fetch(`${APP}/tool/${name}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(args) });
  const t = await r.text();
  try { const j = JSON.parse(t); return j.ok ? JSON.parse(j.result) : j; } catch { return t; }
}

// ── PASSO 1: CORE ENTRADA — Normalizar Mensagem ───────────────────────────────
console.log('[1] CORE ENTRADA — Normalizar Mensagem...');
const entradaWf = await getWf('bEb19TdWZfFloisU');
const nmNode = entradaWf.nodes.find(n => n.name === 'Normalizar Mensagem');
if (!nmNode) throw new Error('Normalizar Mensagem não encontrado');

// Adicionar extração de reply context logo antes do return final
const NM_ANCHOR = 'const pushName = data.sender?.name ?? chaveId;';
const NM_INSERT = `const pushName = data.sender?.name ?? chaveId;

// Contexto de reply (WhatsApp "Responder") — usado para filtro mecânico no grupo de entregadores
const replyToExternalId = data.content_attributes?.in_reply_to_external_id ?? null;
const cwReplyToId = data.content_attributes?.in_reply_to ?? null;`;

// Adicionar campos no return
const NM_RETURN_ANCHOR = '    remoteJid,\n    isGroup,\n  }';
const NM_RETURN_INSERT = `    remoteJid,
    isGroup,
    reply_to_external_id: replyToExternalId,
    cw_reply_to_id: cwReplyToId,
  }`;

let nmCode = nmNode.parameters.jsCode;
if (!nmCode.includes('reply_to_external_id')) {
  nmCode = nmCode.replace(NM_ANCHOR, NM_INSERT);
  nmCode = nmCode.replace('    remoteJid,\n    isGroup,\n  }', NM_RETURN_INSERT);
  nmNode.parameters.jsCode = nmCode;
  const r1 = await putWf('bEb19TdWZfFloisU', entradaWf);
  console.log('  ✓ Normalizar Mensagem atualizado (id=' + r1.id + ')');
} else {
  console.log('  ✓ Normalizar Mensagem já tem reply_to_external_id');
}

// ── PASSO 2: CORE DEBOUNCE — Consolidar e Preparar ───────────────────────────
console.log('[2] CORE DEBOUNCE — Consolidar e Preparar...');
const debounceWf = await getWf('FacKqM3e2LsHE6NY');
const cpNode = debounceWf.nodes.find(n => n.name === 'Consolidar e Preparar');
if (!cpNode) throw new Error('Consolidar e Preparar não encontrado');

const CP_ANCHOR = '  currentMsgIds,\n}}];';
const CP_INSERT = `  currentMsgIds,
  // Propaga reply context do primeiro item do batch (quem respondeu usou o reply nessa msg)
  reply_to_external_id: messages.find(m => m.reply_to_external_id)?.reply_to_external_id ?? null,
  cw_reply_to_id:       messages.find(m => m.cw_reply_to_id)?.cw_reply_to_id ?? null,
}}];`;

let cpCode = cpNode.parameters.jsCode;
if (!cpCode.includes('reply_to_external_id')) {
  cpCode = cpCode.replace(CP_ANCHOR, CP_INSERT);
  cpNode.parameters.jsCode = cpCode;
  const r2 = await putWf('FacKqM3e2LsHE6NY', debounceWf);
  console.log('  ✓ Consolidar e Preparar atualizado (id=' + r2.id + ')');
} else {
  console.log('  ✓ Consolidar e Preparar já tem reply_to_external_id');
}

// ── PASSO 3a: AGENT EXECUTOR — Resolver Persona ──────────────────────────────
console.log('[3a] AGENT EXECUTOR — Resolver Persona (filtro mecânico)...');
const agentWf = await getWf('jleu4RPvSnYDL8Gd');
const rpNode = agentWf.nodes.find(n => n.name === 'Resolver Persona');
if (!rpNode) throw new Error('Resolver Persona não encontrado');

// Substituir a lógica toda do deliverer por filtro mecânico limpo
const NEW_RESOLVER_CODE = `// Resolver Persona — filtro mecânico para grupo de entregadores.
// Grupo de entregadores: APENAS processa se o entregador usou a função "Responder"
// do WhatsApp (reply). Filtro 100% mecânico via campo reply_to_external_id do Chatwoot.
// Sem LLM, sem palavras-chave, sem heurísticas.
const item = $('Desembalar Payload').first().json;
const raw = $input.first().json?.persona_raw ?? null;

if (!raw) return [{ json: item }];

let cfg = null;
try { cfg = JSON.parse(String(raw)); } catch { cfg = null; }
if (!cfg || !Array.isArray(cfg.routes)) return [{ json: item }];

const remoteJid = String(item.remoteJid || '');
const telefone = String(item.telefone || '');
const route = cfg.routes.find(r => r.jid === remoteJid)
  || cfg.routes.find(r => r.jid === telefone)
  || null;

if (!route) return [{ json: item }];

const personas = cfg.personas || {};
const persona = personas[route.personaKey] || null;

// ── Filtro mecânico: grupo de entregadores ─────────────────────────────────
if (route.personaKey === 'deliverer') {
  // Só processa se o entregador usou a função "Responder" do WhatsApp
  // in_reply_to_external_id = WhatsApp message ID da mensagem citada
  // cw_reply_to_id = Chatwoot message ID da mensagem citada
  const hasReply = !!(item.reply_to_external_id || item.cw_reply_to_id);

  if (!hasReply) {
    // Descarte mecânico — sem LLM, sem custo, sem delay
    return [];
  }
}

// ── Enriquecer item com metadados do grupo ─────────────────────────────────
const extraMeta = {};
if (route.personaKey === 'deliverer') {
  const senderJid = String(item.telefone || '');
  const senderPhone = senderJid.replace(/@s\\.whatsapp\\.net$/, '').replace(/@g\\.us$/, '');
  extraMeta.senderJid = senderJid.includes('@') ? senderJid : (senderJid ? senderJid + '@s.whatsapp.net' : '');
  extraMeta.senderPhone = senderPhone;
  extraMeta.senderName = item.pushName || senderPhone || 'Entregador';
  extraMeta.isGroupMessage = true;
  extraMeta.isReply = true;
  extraMeta.replyToExternalId = item.reply_to_external_id;
  extraMeta.cwReplyToId = item.cw_reply_to_id;
}

return [{
  json: {
    ...item,
    ...extraMeta,
    personaKey: route.personaKey,
    personaLabel: persona?.label ?? route.personaKey,
    systemPromptOverride: persona?.systemPrompt ?? '',
    toolsAllowed: Array.isArray(persona?.tools) ? persona.tools : [],
    restaurantId: route.restaurantId ?? null,
  },
}];
`;

rpNode.parameters.jsCode = NEW_RESOLVER_CODE;
console.log('  ✓ Resolver Persona substituído por filtro mecânico');

// ── PASSO 3b: AGENT EXECUTOR — Parsear Chunks — remover [SKIP] ───────────────
console.log('[3b] AGENT EXECUTOR — Parsear Chunks (remover [SKIP])...');
const pcNode = agentWf.nodes.find(n => n.name === 'Parsear Chunks');
if (!pcNode) throw new Error('Parsear Chunks não encontrado');

const SKIP_START = '/* skip-signal-start */';
const SKIP_END = '/* skip-signal-end */';
const skipRe = new RegExp(
  SKIP_START.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '[\\s\\S]*?' + SKIP_END.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
);
if (skipRe.test(pcNode.parameters.jsCode)) {
  pcNode.parameters.jsCode = pcNode.parameters.jsCode.replace(skipRe, '').replace(/\n{3,}/g, '\n\n');
  console.log('  ✓ [SKIP] removido do Parsear Chunks');
} else {
  console.log('  ✓ Parsear Chunks já sem [SKIP]');
}

const r3 = await putWf('jleu4RPvSnYDL8Gd', agentWf);
console.log('  ✓ AGENT EXECUTOR salvo (id=' + r3.id + ')');

// ── PASSO 4: MongoDB — simplificar persona deliverer ─────────────────────────
console.log('[4] MongoDB — persona deliverer (remover [SKIP] e listas)...');
const docs = await mcpTool('mongo_find', {
  database: 'vendly', collection: 'businesses',
  filter: { instances: 'livraison-totale' }, limit: 1,
});
const biz = docs[0];
const dlvIdx = biz.personas.findIndex(p => p.key === 'deliverer');

const NEW_DELIVERER_PROMPT = `Você é o canal operacional da LivraisonTotale (LT) com os entregadores no GRUPO DE ENTREGADORES.

Quando você recebe uma mensagem aqui, é porque o entregador usou a função "Responder" do WhatsApp em uma mensagem do agente — portanto, existe contexto de entrega. O entregador pode estar:
- Aceitando um pedido
- Atualizando status de uma entrega (chegou no restaurante, saiu, entregou)
- Cancelando/desistindo
- Perguntando detalhes de um pedido
- Fazendo acerto financeiro

Entenda o contexto naturalmente a partir da mensagem e do histórico. Não existe lista de palavras-chave — você é inteligente o suficiente para entender o que o entregador quer dizer.

## COMO RESPONDER

### @Mencionar o entregador (OBRIGATÓRIO)
Sempre que se dirigir a um entregador específico, use mentionedList:
- No texto: inclua @NUMERO (ex: @351912345678, sem @s.whatsapp.net)
- Na chamada da ferramenta: delivery_post_to_deliverer_group com mentionedList=["351912345678@s.whatsapp.net"]
- O campo senderJid no contexto contém o JID do remetente atual
- O campo senderPhone contém o número (use no texto @senderPhone)

### Responder à mensagem (quotedMessageId)
Use delivery_post_to_deliverer_group com quotedMessageId=replyToExternalId (disponível no contexto) para que sua resposta apareça como reply no WhatsApp, mantendo o fio da conversa.

## FERRAMENTAS

Chame as ferramentas diretamente com base no que o entregador comunicou:

**Aceite de pedido** → delivery_assign_deliverer(orderId, delivererJid=senderJid, delivererName=senderName)
- Se já aceito por outro: informe @senderPhone e sugira aguardar próximo pedido
- Se sucesso: confirme com @mention e use quotedMessageId para responder ao post

**Status** (chegou, saiu, entregou) → delivery_update_order_status com o status correto
- Espelha automaticamente no grupo de comandos (notifyCommandGroup=true padrão)
- Confirme com "@senderPhone recebido ✅"

**Cancelamento** → delivery_cancel_by_deliverer
- Re-posta o pedido automaticamente
- Informe "@senderPhone entendido, pedido disponibilizado novamente"

**Dúvida sobre pedido** → delivery_get_order ou delivery_list_orders, responda com dados reais

**Acerto financeiro** → confirme valor antes de gravar, delivery_log_settlement

## ESTILO
- Muito curto e direto — 1 linha por resposta quando possível
- Sempre @mencionar o entregador específico
- Emojis operacionais: 🛵 ✅ 📦 ⏱️ ❌
- Tom de colega de equipe, não robótico
- NUNCA inventar dados — use ferramentas para consultar

## FERRAMENTAS DISPONÍVEIS
delivery_assign_deliverer, delivery_cancel_by_deliverer, delivery_update_order_status, delivery_get_order, delivery_list_orders, delivery_log_settlement, delivery_post_to_deliverer_group, delivery_post_to_command_group, delivery_get_restaurant, delivery_list_restaurants, search_memory`;

const upd = await mcpTool('mongo_update', {
  database: 'vendly', collection: 'businesses',
  filter: { instances: 'livraison-totale' },
  update: { $set: { [`personas.${dlvIdx}.systemPrompt`]: NEW_DELIVERER_PROMPT } },
});
console.log('  MongoDB:', JSON.stringify(upd).slice(0, 60));

// Rebuild Redis com todos os campos
const allPersonas = biz.personas.map((px, i) => i === dlvIdx ? { ...px, systemPrompt: NEW_DELIVERER_PROMPT } : px);
const personasMap = Object.fromEntries(allPersonas.map(px => [px.key, px]));
const rb = await mcpTool('redis_set', {
  key: 'persona_routes:livraison-totale',
  value: JSON.stringify({ personas: personasMap, routes: biz.contextRoutes || [] }),
});
console.log('  Redis:', rb);

console.log('\n✅ Concluído!');
console.log('  • CORE ENTRADA: reply_to_external_id extraído do Chatwoot webhook');
console.log('  • CORE DEBOUNCE: campo propagado pelo pipeline');
console.log('  • Resolver Persona: filtro mecânico (sem reply → descarte sem LLM)');
console.log('  • Parsear Chunks: [SKIP] removido');
console.log('  • Persona deliverer: sem keywords, sem [SKIP], comportamento natural');

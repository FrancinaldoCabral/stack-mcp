/**
 * fix-deliverer-group-v2.mjs
 *
 * 1. Atualiza "Resolver Persona" no N8N:
 *    - Remove filtro regex/keyword para o grupo de entregadores
 *    - Passa TODAS as mensagens do grupo ao agente (o agente decide via [SKIP])
 *    - Expõe senderJid e isReply no item para o agente usar
 *
 * 2. Atualiza "Parsear Chunks" para interceptar [SKIP] e não enviar
 *
 * 3. Atualiza persona "deliverer" no MongoDB:
 *    - Usar delivery_post_to_deliverer_group com mentionedList para @mencionar
 *    - Usar quotedMessageId para responder ao post do pedido
 *    - Responder [SKIP] para mensagens informais não relacionadas a entregas
 *    - Contexto do grupo informal — agente age com discernimento
 */
import 'dotenv/config';

const N8N = process.env.N8N_URL || 'https://workflows.vendly.chat';
const KEY = process.env.N8N_API_KEY;
const APP = process.env.APP_URL || 'https://app.vendly.chat';
const WF_ID = 'jleu4RPvSnYDL8Gd';
if (!KEY) { console.error('N8N_API_KEY ausente'); process.exit(1); }

const h = { 'X-N8N-API-KEY': KEY, 'Accept': 'application/json', 'Content-Type': 'application/json' };

// ── helpers ──────────────────────────────────────────────────────────────────
async function n8n(method, path, body) {
  const r = await fetch(`${N8N}/api/v1${path}`, { method, headers: h, body: body ? JSON.stringify(body) : undefined });
  const t = await r.text();
  if (!r.ok) throw new Error(`${method} ${path} → ${r.status}: ${t.slice(0, 300)}`);
  return t ? JSON.parse(t) : {};
}

async function mcpTool(name, args) {
  const r = await fetch(`${APP}/tool/${name}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(args),
  });
  const t = await r.text();
  try { const j = JSON.parse(t); return j.ok ? JSON.parse(j.result) : j; }
  catch { return t; }
}

// ── 1. Buscar workflow ───────────────────────────────────────────────────────
console.log('[1] Buscando workflow N8N...');
const wf = await n8n('GET', `/workflows/${WF_ID}`);
console.log('   Workflow:', wf.name);

const byName = Object.fromEntries(wf.nodes.map(n => [n.name, n]));

// ── 2. Atualizar Resolver Persona ────────────────────────────────────────────
console.log('[2] Atualizando Resolver Persona...');
const rpNode = byName['Resolver Persona'];
if (!rpNode) throw new Error('"Resolver Persona" não encontrado');

// Novo código: remove regex, passa todas as msgs do grupo ao agente com metadados extras
const newResolverCode = `// Resolve persona e enriquece o item com metadados do grupo de entregadores.
// Filtro de relevância é feito pelo próprio LLM (agente responde [SKIP] se irrelevante).
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

// Para o grupo de entregadores: enriquecer o item com metadados úteis.
// O LLM decide se deve responder ou não (retorna [SKIP] se mensagem informal).
// NÃO filtramos por regex/keywords — usamos o poder semântico do LLM.
const extraMeta = {};
if (route.personaKey === 'deliverer') {
  // Sender JID para uso em mentionedList na resposta
  const senderJid = String(item.telefone || '');
  const senderPhone = senderJid.replace(/@s\\.whatsapp\\.net$/, '').replace(/@g\\.us$/, '');

  // Detecta se a mensagem veio com contexto de reply (Chatwoot content_attributes)
  const inReplyTo = item.metadata?.in_reply_to ?? null;

  extraMeta.senderJid = senderJid.includes('@') ? senderJid : (senderJid ? senderJid + '@s.whatsapp.net' : '');
  extraMeta.senderPhone = senderPhone;
  extraMeta.senderName = item.pushName || senderPhone || 'Entregador';
  extraMeta.isGroupMessage = true;
  extraMeta.isReply = !!inReplyTo;
  extraMeta.replyToMsgId = inReplyTo;
  extraMeta.delivererGroupHint = 'Grupo informal de entregadores. Responda [SKIP] se a mensagem NÃO requer ação do agente de delivery. Use mentionedList para @mencionar o entregador.';
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

rpNode.parameters.jsCode = newResolverCode;
console.log('   ✓ Resolver Persona atualizado (regex removido, LLM decide)');

// ── 3. Atualizar Parsear Chunks: interceptar [SKIP] ──────────────────────────
console.log('[3] Atualizando Parsear Chunks para interceptar [SKIP]...');
const pcNode = byName['Parsear Chunks'];
if (!pcNode) throw new Error('"Parsear Chunks" não encontrado');

const skipStart = '/* skip-signal-start */';
const skipEnd = '/* skip-signal-end */';
const skipBlock = `${skipStart}
// === Sinal [SKIP]: agente decidiu não responder (mensagem informal do grupo de entregadores) ===
if (typeof content === 'string' && content.trim() === '[SKIP]') {
  // Não envia nada — encerra o processamento silenciosamente
  return [];
}
${skipEnd}`;

const oldParse = pcNode.parameters.jsCode;
const skipRe = new RegExp(
  skipStart.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '[\\s\\S]*?' + skipEnd.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
);

let newParse;
if (skipRe.test(oldParse)) {
  newParse = oldParse.replace(skipRe, skipBlock);
  console.log('   ✓ Bloco [SKIP] já existia — atualizado');
} else {
  // Inserir logo após a definição de `content` (após o else que define content)
  // Procura o padrão "} else {\n  content = ..." ou "content = _choice?.message?.content"
  const anchor1 = "content = _choice?.message?.content ?? resp.error?.message ?? 'Desculpe, erro interno.';\n}";
  const anchor2 = "content = _choice?.message?.content";
  const idx = oldParse.indexOf(anchor1) !== -1
    ? oldParse.indexOf(anchor1) + anchor1.length
    : oldParse.indexOf(anchor2) !== -1
      ? oldParse.indexOf(anchor2) + oldParse.slice(oldParse.indexOf(anchor2)).indexOf('\n') + 1
      : -1;

  if (idx === -1) {
    // Fallback: inserir no início, após as primeiras declarações
    console.warn('   ⚠ âncora não encontrada em Parsear Chunks — inserindo após primeira declaração de content');
    const fallbackAnchor = 'const content';
    const fi = oldParse.lastIndexOf(fallbackAnchor);
    if (fi === -1) throw new Error('Não foi possível encontrar ponto de inserção em Parsear Chunks');
    const lineEnd = oldParse.indexOf('\n', fi);
    newParse = oldParse.slice(0, lineEnd + 1) + '\n' + skipBlock + '\n' + oldParse.slice(lineEnd + 1);
  } else {
    newParse = oldParse.slice(0, idx) + '\n\n' + skipBlock + '\n' + oldParse.slice(idx);
  }
  console.log('   ✓ Bloco [SKIP] inserido em Parsear Chunks');
}
pcNode.parameters.jsCode = newParse;

// ── 4. Salvar workflow ───────────────────────────────────────────────────────
console.log('[4] Salvando workflow...');
const allowedSettings = ['saveExecutionProgress','saveManualExecutions','saveDataErrorExecution','saveDataSuccessExecution','executionTimeout','errorWorkflow','timezone','executionOrder'];
const cleanSettings = {};
for (const k of allowedSettings) if (wf.settings?.[k] !== undefined) cleanSettings[k] = wf.settings[k];
if (!cleanSettings.executionOrder) cleanSettings.executionOrder = 'v1';

const putRes = await n8n('PUT', `/workflows/${WF_ID}`, {
  name: wf.name, nodes: wf.nodes, connections: wf.connections, settings: cleanSettings,
});
console.log('   ✓ Workflow salvo (id=' + putRes.id + ')');

// ── 5. Atualizar persona "deliverer" no MongoDB ──────────────────────────────
console.log('[5] Atualizando persona "deliverer" no MongoDB...');

const DELIVERER_PROMPT = `Você é o canal da LivraisonTotale (LT) com os entregadores, dentro do GRUPO DE ENTREGADORES. Este é um grupo informal — os entregadores conversam entre si, mandam memes, discutem, brincam. O agente não interfere em conversas informais.

## QUANDO AGIR

Aja APENAS quando a mensagem for claramente uma das situações abaixo:
- Entregador aceita um pedido ("eu pego", "vou eu", "pode ser eu", "tô indo", "aceito", etc.)
- Entregador atualiza status de entrega ("cheguei no restaurante", "saí pra entregar", "entreguei", etc.)
- Entregador cancela/desiste de um pedido ("não consigo", "preciso cancelar", "desisto")
- Entregador pergunta detalhes de um pedido (endereço, valor, telefone do cliente)
- Menção financeira (dinheiro pendente, acerto)
- Qualquer mensagem que responda diretamente a uma mensagem do agente (reply)

## QUANDO NÃO AGIR → [SKIP]

Se a mensagem NÃO se encaixa nas situações acima, retorne EXATAMENTE:
[SKIP]

Isso inclui: saudações gerais, conversas pessoais, reclamações não relacionadas a entregas, piadas, qualquer conversa que não exija ação do agente. Não responda, não comente, não participe de conversas informais.

## COMO RESPONDER

### @Mencionar entregadores (OBRIGATÓRIO)
SEMPRE que se dirigir a um entregador específico, use mentionedList com o JID dele:
- No texto: inclua @NUMERO (ex: @351912345678) — sem @s.whatsapp.net
- Na chamada: delivery_post_to_deliverer_group com mentionedList=["351912345678@s.whatsapp.net"]
- Exemplo: "Oi @351912345678, o pedido já está confirmado!"

### Responder ao post do pedido (quotedMessageId)
Quando um pedido é confirmado (delivery_confirm_order), o campo "delivererMsgId" contém o ID da mensagem postada no grupo. Quando um entregador aceita o pedido:
1. Confirme via delivery_assign_deliverer
2. Informe o resultado usando delivery_post_to_deliverer_group com:
   - mentionedList=[JID do entregador]
   - quotedMessageId=lastDelivererGroupMsgId do pedido (busque com delivery_get_order se necessário)

### Contexto do entregador
O campo "senderJid" no contexto contém o JID do remetente atual (use em mentionedList).
O campo "senderName" contém o nome exibido (use no texto da mensagem).

## FERRAMENTAS DISPONÍVEIS
delivery_assign_deliverer, delivery_cancel_by_deliverer, delivery_update_order_status, delivery_get_order, delivery_list_orders, delivery_log_settlement, delivery_post_to_deliverer_group, delivery_post_to_command_group, delivery_get_restaurant, delivery_list_restaurants, search_memory.

## REGRAS DE FERRAMENTA

1. **Entregador aceita pedido** ("eu pego", "vou", "aceito"):
   - Identifique o pedido (último postado, ou ref mencionada — use delivery_list_orders se necessário)
   - Chame delivery_assign_deliverer(orderId, delivererJid=senderJid, delivererName=senderName)
   - Se já foi aceito por outro: informe @mencionando o remetente — "Oi @NUMERO, esse pedido já foi aceito por [nome]. Aguarda o próximo!"
   - Se conseguiu: confirme com @menção e responda ao post do pedido

2. **Status de entrega** ("cheguei", "saí", "entreguei"):
   - Chame delivery_update_order_status com o status correto
   - Espelhe para o grupo de comandos automaticamente (notifyCommandGroup=true é padrão)
   - Confirme com mensagem curta: "@NUMERO recebido ✅"

3. **Cancelamento** ("não consigo", "desisto"):
   - Chame delivery_cancel_by_deliverer
   - Re-posta o pedido no grupo automaticamente
   - Confirme: "@NUMERO entendido. Pedido re-disponibilizado."

4. **Dúvidas sobre pedido** (endereço, valor, etc.):
   - Chame delivery_get_order e responda com os dados reais
   - @mencione o entregador na resposta

5. **Acertos financeiros**:
   - Confirme o valor antes de gravar
   - Chame delivery_log_settlement
   - @mencione o entregador: "@NUMERO acerto registrado ✅"

## ESTILO
- Mensagens MUITO curtas e diretas
- SEMPRE @mencionar o entregador específico quando se dirigir a ele
- Emojis operacionais: 🛵 ✅ 📦 ⏱️ ❌
- Português brasileiro, tom de colega de equipe — não robótico
- NUNCA explique o que você está fazendo — apenas faça e confirme em 1 linha
- NUNCA inventar dados — consulte com ferramentas`;

// Busca o business LivraisonTotale
const biz = await mcpTool('mongo_find', {
  database: 'vendly',
  collection: 'businesses',
  filter: { instances: 'livraison-totale' },
  limit: 1,
});
const bizDoc = Array.isArray(biz) ? biz[0] : (biz?.documents?.[0] ?? biz?.[0]);
if (!bizDoc?._id) { console.error('   ❌ Business livraison-totale não encontrado'); process.exit(1); }
console.log('   Business:', bizDoc._id, bizDoc.name);

// Encontra index da persona deliverer
const personas = Array.isArray(bizDoc.personas) ? bizDoc.personas : [];
const dlvIdx = personas.findIndex(p => p.key === 'deliverer');
if (dlvIdx === -1) { console.error('   ❌ Persona "deliverer" não encontrada'); process.exit(1); }

const updateRes = await mcpTool('mongo_update', {
  database: 'vendly',
  collection: 'businesses',
  filter: { instances: 'livraison-totale' },
  update: { $set: { [`personas.${dlvIdx}.systemPrompt`]: DELIVERER_PROMPT } },
});
console.log('   →', JSON.stringify(updateRes).slice(0, 150));
console.log('   ✓ Persona deliverer atualizada');

// ── 6. Rebuild Redis persona_routes ──────────────────────────────────────────
console.log('[6] Sincronizando persona_routes no Redis...');
const syncRes = await fetch(`${APP}/api/businesses/${bizDoc._id}/personas`, {
  method: 'PUT',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ personas }),
});
if (syncRes.ok) {
  console.log('   ✓ persona_routes sincronizado via API');
} else {
  const errText = await syncRes.text().catch(() => '');
  console.warn('   ⚠ sync via API falhou (' + syncRes.status + '):', errText.slice(0, 200));
  console.warn('   Execute: node scripts/rebuild-persona-routes-cache.mjs');
}

console.log('\n✅ Concluído!');
console.log('   • Resolver Persona: regex removido — agente usa LLM para decidir');
console.log('   • Parsear Chunks: [SKIP] interceptado — mensagens informais descartadas silenciosamente');
console.log('   • Persona deliverer: @mention via mentionedList, quotedMessageId para replies, [SKIP] para informal');

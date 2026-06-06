/**
 * Patch: adiciona instance + waExternalId ao _vendlyCtx no Construir Prompt
 *
 * Fluxo completo:
 *  1. Normalizar Mensagem  → extrai wa_msg_id = data.external_id (stanzaId do WhatsApp)
 *  2. Consolidar e Preparar → propaga wa_msg_id do último item
 *  3. Construir Prompt      → inclui instance + waExternalId no _vendlyCtx
 *
 * O backend /agent-loop chama delivery_deliverer_context com instance + waExternalId.
 * O backend chama Evolution findMessages com o stanzaId exato para extrair o
 * contextInfo.stanzaId da mensagem quoted (= lastDelivererGroupMsgId do pedido).
 */

const N8N_URL = 'https://workflows.vendly.chat';
const N8N_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJjOTVmNTNmZS0zNGYyLTQ2ZWYtODZiZi1kZDFlYWE2MTQyZDYiLCJpc3MiOiJuOG4iLCJhdWQiOiJwdWJsaWMtYXBpIiwianRpIjoiOTM3NjE5OTUtMzMxYy00NTcyLTlmODgtNmIzYTA1MGU1ZDg5IiwiaWF0IjoxNzc4OTU0MzAyfQ.ULL6jWDVEI9hGBRfk86nlo59o5UbPXzLt8qgpxeIDWs';

const WF_ENTRADA = 'bEb19TdWZfFloisU';   // Normalizar Mensagem
const WF_BUFFER  = 'FacKqM3e2LsHE6NY';   // Consolidar e Preparar
const WF_AGENT   = 'jleu4RPvSnYDL8Gd';   // Agente Loop (Construir Prompt)

const ALLOWED_SETTINGS = [
  'executionOrder','saveManualExecutions','saveDataSuccessExecution',
  'saveDataErrorExecution','saveExecutionProgress','timezone','errorWorkflow','callerPolicy',
];

async function api(wfId, method = 'GET', body = null) {
  const url = `${N8N_URL}/api/v1/workflows/${wfId}`;
  const opts = {
    method,
    headers: { 'X-N8N-API-KEY': N8N_KEY, 'Content-Type': 'application/json' },
  };
  if (body) opts.body = JSON.stringify(body);
  const r = await fetch(url, opts);
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${await r.text().then(t => t.slice(0, 300))}`);
  return r.json();
}

function save(wf, nodes) {
  const settings = Object.fromEntries(
    Object.entries(wf.settings ?? {}).filter(([k]) => ALLOWED_SETTINGS.includes(k))
  );
  return { name: wf.name, nodes, connections: wf.connections, settings, staticData: wf.staticData ?? null };
}

// ══════════════════════════════════════════════════════════════
// FIX 1: Normalizar Mensagem — extrai wa_msg_id = data.external_id
// ══════════════════════════════════════════════════════════════
{
  const wf = await api(WF_ENTRADA);
  console.log(`\n[1] ${wf.name} (${WF_ENTRADA})`);
  let patched = false;

  for (const n of wf.nodes) {
    if (n.name !== 'Normalizar Mensagem') continue;
    let code = n.parameters.jsCode;

    const OLD = "const cwMessageId = String(data.id ?? '');";
    const NEW = "const cwMessageId = String(data.id ?? '');\n" +
                "// WhatsApp stanza ID — extrai do webhook Chatwoot (evita race condition do findMessages)\n" +
                "const waExternalId = data.external_id ?? null;";

    if (!code.includes('waExternalId')) {
      if (!code.includes(OLD)) { console.log('  AVISO: padrão cwMessageId não encontrado'); break; }
      code = code.replace(OLD, NEW);
      console.log('  + waExternalId extraído ✓');
      patched = true;
    } else {
      console.log('  waExternalId já existe ✓');
    }

    // Adiciona wa_msg_id ao return se ainda não estiver
    const OLD_RET = 'cw_reply_to_id: cwReplyToId,';
    const NEW_RET  = 'cw_reply_to_id: cwReplyToId,\n    wa_msg_id: waExternalId,';
    if (!code.includes('wa_msg_id:') && code.includes(OLD_RET)) {
      code = code.replace(OLD_RET, NEW_RET);
      console.log('  + wa_msg_id no return ✓');
      patched = true;
    } else if (code.includes('wa_msg_id:')) {
      console.log('  wa_msg_id no return já existe ✓');
    }

    n.parameters.jsCode = code;
    break;
  }

  if (patched) {
    const r = await api(WF_ENTRADA, 'PUT', save(wf, wf.nodes));
    console.log(`  SALVO versionId=${r.versionId}`);
  } else {
    console.log('  Nenhuma alteração necessária.');
  }
}

// ══════════════════════════════════════════════════════════════
// FIX 2: Consolidar e Preparar — propaga wa_msg_id do último item
// ══════════════════════════════════════════════════════════════
{
  const wf = await api(WF_BUFFER);
  console.log(`\n[2] ${wf.name} (${WF_BUFFER})`);
  let patched = false;

  for (const n of wf.nodes) {
    if (n.name !== 'Consolidar e Preparar') continue;
    let code = n.parameters.jsCode;

    const OLD = 'reply_to_external_id: messages.find(m => m.reply_to_external_id)?.reply_to_external_id ?? null,';
    const NEW  = OLD + '\n  wa_msg_id: last.wa_msg_id ?? null,';

    if (!code.includes('wa_msg_id:') && code.includes(OLD)) {
      code = code.replace(OLD, NEW);
      n.parameters.jsCode = code;
      console.log('  + wa_msg_id propagado ✓');
      patched = true;
    } else if (code.includes('wa_msg_id:')) {
      console.log('  wa_msg_id já propagado ✓');
    } else {
      console.log('  AVISO: padrão reply_to_external_id não encontrado');
    }
    break;
  }

  if (patched) {
    const r = await api(WF_BUFFER, 'PUT', save(wf, wf.nodes));
    console.log(`  SALVO versionId=${r.versionId}`);
  } else {
    console.log('  Nenhuma alteração necessária.');
  }
}

// ══════════════════════════════════════════════════════════════
// FIX 3: Construir Prompt — adiciona instance + waExternalId ao _vendlyCtx
// ══════════════════════════════════════════════════════════════
{
  const wf = await api(WF_AGENT);
  console.log(`\n[3] ${wf.name} (${WF_AGENT})`);
  let patched = false;

  for (const n of wf.nodes) {
    if (n.name !== 'Construir Prompt') continue;
    let code = n.parameters.jsCode;

    // Remove versão antiga se existir (sem instance/waExternalId)
    const OLD_VENDLY_CTX = `if (__deliveryCtx.personaKey === 'deliverer' && __deliveryCtx.restaurantId) {\n  __openRouterBody._vendlyCtx = {\n    personaKey: 'deliverer',\n    restaurantId: __deliveryCtx.restaurantId,\n    senderPhone: String(msg.telefone || '').replace(/\\D/g, ''),\n    replyToExternalId: msg.reply_to_external_id || null,\n  };\n}`;

    const NEW_VENDLY_CTX = `// Contexto para grupo de entregadores — processado pelo backend /agent-loop, não exposto ao agente
if (__deliveryCtx.personaKey === 'deliverer' && __deliveryCtx.restaurantId) {
  __openRouterBody._vendlyCtx = {
    personaKey: 'deliverer',
    restaurantId: __deliveryCtx.restaurantId,
    senderPhone: String(msg.telefone || '').replace(/\\D/g, ''),
    instance: msg.instance || null,
    waExternalId: msg.wa_msg_id || null,
  };
}`;

    if (code.includes('_vendlyCtx') && code.includes('waExternalId')) {
      console.log('  _vendlyCtx com waExternalId já existe ✓');
    } else if (code.includes(OLD_VENDLY_CTX)) {
      // Atualiza versão antiga (com replyToExternalId) para nova (com waExternalId)
      code = code.replace(OLD_VENDLY_CTX, NEW_VENDLY_CTX);
      n.parameters.jsCode = code;
      console.log('  _vendlyCtx atualizado: replyToExternalId → instance+waExternalId ✓');
      patched = true;
    } else if (!code.includes('_vendlyCtx')) {
      // Insere antes do return final
      const BEFORE_RETURN = 'return [{ json: {';
      const idx = code.lastIndexOf(BEFORE_RETURN);
      if (idx === -1) { console.log('  AVISO: return não encontrado'); break; }
      code = code.slice(0, idx) + NEW_VENDLY_CTX + '\n\n' + code.slice(idx);
      n.parameters.jsCode = code;
      console.log('  _vendlyCtx inserido ✓');
      patched = true;
    } else {
      // Tem _vendlyCtx mas sem waExternalId e sem a forma antiga exata — patch manual
      console.log('  AVISO: _vendlyCtx existe mas não reconhecido — inspecionar manualmente');
    }
    break;
  }

  if (patched) {
    const r = await api(WF_AGENT, 'PUT', save(wf, wf.nodes));
    console.log(`  SALVO versionId=${r.versionId}`);
  } else {
    console.log('  Nenhuma alteração necessária.');
  }
}

console.log('\n✅ Todos os patches aplicados.');

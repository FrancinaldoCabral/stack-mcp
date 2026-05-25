import dotenv from 'dotenv';
dotenv.config();

const CW_KEY = 'Db9GHGsN9YVUDhJvD5CHbVTz';
const N8N_KEY = process.env.N8N_API_KEY;

async function cw(path) {
  const r = await fetch(`https://chatwoot.vendly.chat/api/v1${path}`, {
    headers: { 'api_access_token': CW_KEY, 'Accept': 'application/json' }
  });
  return r.json();
}

// Checar mensagens recentes das conversas 10 e 11
for (const convId of [10, 11]) {
  console.log(`\n=== CONVERSA ${convId} — últimas mensagens ===`);
  const msgs = await cw(`/accounts/1/conversations/${convId}/messages`);
  const list = msgs.payload ?? [];
  // Últimas 10
  const last10 = list.slice(-10);
  for (const m of last10) {
    const tipo = m.message_type === 0 ? 'IN ' : m.message_type === 1 ? 'OUT' : 'ACT';
    const ts = new Date(m.created_at * 1000).toISOString().slice(0, 19);
    const att = m.attachments?.length ? ` [${m.attachments.length} attach: ${m.attachments.map(a => a.file_type).join(',')}]` : '';
    const priv = m.private ? ' [PRIVATE]' : '';
    console.log(`  ${tipo} [${ts}] id=${m.id} author="${m.sender?.name ?? 'bot'}"${priv}${att}: ${String(m.content ?? '').slice(0, 80)}`);
  }
}

// Ver conversa 11 status
const conv11 = await cw('/accounts/1/conversations/11');
console.log(`\n=== CONVERSA 11 STATUS ===`);
console.log('status:', conv11.status);
console.log('inbox_id:', conv11.inbox_id);
console.log('assignee:', conv11.meta?.assignee?.name ?? 'none');

// Ver se há execuções recentes do Executor com erro no fetch do Chatwoot
// (via API de execuções)
async function n8n(path) {
  const r = await fetch(`https://workflows.vendly.chat/api/v1${path}`, {
    headers: { 'X-N8N-API-KEY': N8N_KEY, 'Accept': 'application/json' }
  });
  return r.json();
}

// Exec 1322 — ver output de Chatwoot Enviar Audio em detalhe
console.log('\n=== EXEC 1322 — Chatwoot Enviar Audio output raw ===');
const det = await n8n('/executions/1322?includeData=true');
const rd = det.data?.resultData?.runData ?? {};
if (rd['Chatwoot Enviar Audio']) {
  const d = rd['Chatwoot Enviar Audio'][0];
  console.log('error:', d.error ?? 'nenhum');
  console.log('executionStatus:', d.executionStatus);
  const items = d.data?.main?.[0] ?? [];
  console.log('output items:', items.length);
  if (items[0]) console.log('first item json:', JSON.stringify(items[0].json).slice(0, 400));
  // Tem hints / metadata?
  console.log('hints:', d.hints ?? 'nenhum');
}

// Parsear Chunks na exec 1322 — conversation_id confirmação
if (rd['Parsear Chunks']) {
  const items = rd['Parsear Chunks'][0]?.data?.main?.[0] ?? [];
  console.log('\nParsear Chunks chunks:');
  for (const it of items) {
    console.log(`  conv_id=${it.json.conversation_id} account_id=${it.json.account_id}`);
    console.log(`  chunk="${String(it.json.chunk ?? '').slice(0, 100)}"`);
  }
}

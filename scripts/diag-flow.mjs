import dotenv from 'dotenv';
dotenv.config();
const N8N = process.env.N8N_URL;
const H = { 'X-N8N-API-KEY': process.env.N8N_API_KEY, 'Accept': 'application/json, text/event-stream' };
const CW_BASE = process.env.CHATWOOT_URL;
const CW_H = { 'api_access_token': process.env.CHATWOOT_API_KEY, 'Content-Type': 'application/json' };
const EVO = process.env.EVOLUTION_URL;
const EVO_H = { 'apikey': process.env.EVOLUTION_API_KEY };

// 1. Execuções recentes de [CORE] Entrada
console.log('=== [CORE] Entrada — últimas execuções ===');
const execEntrada = await fetch(`${N8N}/api/v1/executions?workflowId=bEb19TdWZfFloisU&limit=10`, { headers: H }).then(r => r.json());
for (const e of (execEntrada.data ?? [])) {
  console.log(`  exec ${e.id} status=${e.status} at=${e.startedAt}`);
}

// 2. Conversas em todos os status (incluindo pending)
console.log('\n=== Conversas Chatwoot (todos os status) ===');
for (const st of ['open', 'pending', 'resolved']) {
  const r = await fetch(`${CW_BASE}/api/v1/accounts/1/conversations?status=${st}&page=1`, { headers: CW_H }).then(r => r.json());
  const convs = r.data?.payload ?? r.payload ?? [];
  console.log(`${st}: ${convs.length} conversas`);
  for (const c of convs.slice(0, 3)) {
    const phone = c.meta?.sender?.phone_number ?? c.meta?.sender?.identifier ?? '?';
    console.log(`  id=${c.id} inbox=${c.inbox_id} contact="${c.meta?.sender?.name ?? '?'}" phone=${phone} updated=${c.last_activity_at}`);
  }
}

// 3. Verificar logs do Evolution para a instância (chats recentes)
console.log('\n=== Evolution — chats recentes ===');
const chats = await fetch(`${EVO}/chat/findChats/suporte-redatudo`, {
  method: 'POST',
  headers: { ...EVO_H, 'Content-Type': 'application/json' },
  body: JSON.stringify({ where: {} }),
}).then(r => r.json()).catch(() => ({}));
const chatList = Array.isArray(chats) ? chats : (chats.data ?? []);
console.log(`Total chats: ${chatList.length}`);
for (const c of chatList.slice(0, 5)) {
  const jid = c.remoteJid ?? c.id ?? '?';
  const isGroup = jid.includes('@g.us');
  console.log(`  ${isGroup ? '[GROUP]' : '[CONTACT]'} ${jid} updated=${c.updatedAt ?? c.updatedAt}`);
}

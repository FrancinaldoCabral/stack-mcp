import dotenv from 'dotenv';
dotenv.config();
const N8N = process.env.N8N_URL;
const H = { 'X-N8N-API-KEY': process.env.N8N_API_KEY, 'Accept': 'application/json, text/event-stream' };
const CW_BASE = process.env.CHATWOOT_URL;
const CW_H = { 'api_access_token': process.env.CHATWOOT_API_KEY, 'Content-Type': 'application/json' };

// 1. Auto-open execuções recentes
console.log('=== [CORE] Auto-open — últimas 10 execuções ===');
const execAO = await fetch(`${N8N}/api/v1/executions?workflowId=Jijw4Dqil3QVYSp8&limit=10`, { headers: H }).then(r => r.json());
for (const e of (execAO.data ?? [])) {
  console.log(`  exec ${e.id} status=${e.status} at=${e.startedAt}`);
}

// 2. Ver dados completos de uma execução recente do Auto-open
const lastAO = (execAO.data ?? [])[0];
if (lastAO) {
  console.log(`\n=== Auto-open exec ${lastAO.id} runData (Abrir Conversa) ===`);
  const detail = await fetch(`${N8N}/api/v1/executions/${lastAO.id}`, { headers: H }).then(r => r.json());
  const abrirData = detail.data?.resultData?.runData?.['Abrir Conversa'];
  console.log(JSON.stringify(abrirData?.[0]?.data?.main?.[0]?.[0] ?? 'sem output', null, 2).slice(0, 500));
}

// 3. Mensagens da conversa 10 (pending)
console.log('\n=== Conversa 10 (pending) — mensagens ===');
const msgs10 = await fetch(`${CW_BASE}/api/v1/accounts/1/conversations/10/messages`, { headers: CW_H }).then(r => r.json()).catch(() => ({}));
const ml10 = msgs10.payload ?? [];
console.log(`Total mensagens: ${ml10.length}`);
for (const m of ml10.slice(-5)) {
  console.log(`  id=${m.id} type=${m.message_type} author=${m.sender?.name ?? 'n/a'} at=${new Date(m.created_at * 1000).toISOString()} content=${String(m.content ?? '').slice(0, 80)}`);
}

// 4. Último exec do [CORE] Entrada — o que foi recebido?
console.log('\n=== [CORE] Entrada exec mais recente — input recebido ===');
const execEntrada = await fetch(`${N8N}/api/v1/executions?workflowId=bEb19TdWZfFloisU&limit=3`, { headers: H }).then(r => r.json());
const lastE = (execEntrada.data ?? [])[0];
if (lastE) {
  const det = await fetch(`${N8N}/api/v1/executions/${lastE.id}`, { headers: H }).then(r => r.json());
  const webhookData = det.data?.resultData?.runData?.['Webhook Evolution']?.[0]?.data?.main?.[0]?.[0]?.json;
  const normalizeData = det.data?.resultData?.runData?.['Normalizar Mensagem']?.[0]?.data?.main?.[0]?.[0]?.json;
  console.log(`exec ${lastE.id} at=${lastE.startedAt}`);
  console.log('Webhook input event:', webhookData?.body?.event ?? webhookData?.event);
  console.log('Normalizar output:', JSON.stringify(normalizeData ?? 'empty').slice(0, 200));
}

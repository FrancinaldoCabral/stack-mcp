import dotenv from 'dotenv';
dotenv.config();
const CW_BASE = process.env.CHATWOOT_URL;
const CW_H = { 'api_access_token': process.env.CHATWOOT_API_KEY, 'Content-Type': 'application/json' };

// Re-associar Agent Bot (necessário para o bot funcionar)
const r = await fetch(`${CW_BASE}/api/v1/accounts/1/inboxes/11/set_agent_bot`, {
  method: 'POST', headers: CW_H,
  body: JSON.stringify({ agent_bot: 1 }),
});
console.log('Re-associar Agent Bot status:', r.status);

// Verificar
const verify = await fetch(`${CW_BASE}/api/v1/accounts/1/inboxes/11/agent_bot`, { headers: CW_H });
const vBody = await verify.json().catch(() => ({}));
console.log('Agent Bot agora:', vBody?.agent_bot?.name ?? JSON.stringify(vBody));

// Ver conversa recente para entender o estado atual do assign
const convs = await fetch(`${CW_BASE}/api/v1/accounts/1/conversations?status=open&page=1`, { headers: CW_H }).then(r => r.json()).catch(() => ({}));
const recent = (convs.data?.payload ?? convs.payload ?? []).slice(0, 3);
for (const c of recent) {
  console.log(`\nConversa ${c.id} status=${c.status} assignee=${JSON.stringify(c.meta?.assignee)} bot=${JSON.stringify(c.meta?.agent_bot)}`);
}

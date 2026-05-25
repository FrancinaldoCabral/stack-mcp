import dotenv from 'dotenv';
dotenv.config();
const CW_BASE = process.env.CHATWOOT_URL;
const CW_H = { 'api_access_token': process.env.CHATWOOT_API_KEY, 'Content-Type': 'application/json' };

// Ver conversas recentes em todos os estados para entender o status atual
for (const status of ['open', 'pending', 'resolved']) {
  const r = await fetch(`${CW_BASE}/api/v1/accounts/1/conversations?status=${status}&page=1`, { headers: CW_H }).then(r => r.json());
  const convs = r.data?.payload ?? r.payload ?? [];
  if (convs.length === 0) { console.log(`${status}: nenhuma conversa`); continue; }
  console.log(`\n${status.toUpperCase()} (${convs.length} encontradas):`);
  for (const c of convs.slice(0, 3)) {
    console.log(`  id=${c.id} inbox=${c.inbox_id} assignee=${JSON.stringify(c.meta?.assignee ?? c.assignee)}`);
  }
}

// Verificar se conversas do inbox 11 têm assignee = agent bot
const all = await fetch(`${CW_BASE}/api/v1/accounts/1/conversations?page=1&assignee_type=all`, { headers: CW_H }).then(r => r.json()).catch(() => ({}));
const convs11 = (all.data?.payload ?? all.payload ?? []).filter(c => c.inbox_id === 11);
console.log(`\nConversas inbox 11: ${convs11.length}`);
for (const c of convs11.slice(0, 5)) {
  console.log(`  id=${c.id} status=${c.status} assignee=${JSON.stringify(c.meta?.assignee)} bot=${c.agent_bot ?? 'none'}`);
}

// Ver configuração do Agent Bot para entender os eventos subscritos
const bot = await fetch(`${CW_BASE}/api/v1/accounts/1/agent_bots`, { headers: CW_H }).then(r => r.json()).catch(() => ({}));
console.log('\nAgent Bot config:', JSON.stringify(bot?.[0] ?? {}, null, 2));

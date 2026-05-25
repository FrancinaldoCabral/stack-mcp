import dotenv from 'dotenv';
dotenv.config();
const CW_BASE = process.env.CHATWOOT_URL;
const CW_H = { 'api_access_token': process.env.CHATWOOT_API_KEY, 'Content-Type': 'application/json' };

// Check agent bots
const bots = await fetch(`${CW_BASE}/api/v1/accounts/1/agent_bots`, { headers: CW_H }).then(r => r.json()).catch(() => ({}));
console.log('=== Agent Bots ===');
console.log(JSON.stringify(bots, null, 2));

// Check inbox 11 agent bot
const inbox = await fetch(`${CW_BASE}/api/v1/accounts/1/inboxes/11`, { headers: CW_H }).then(r => r.json()).catch(() => ({}));
console.log('\n=== Inbox 11 agent_bot_config ===');
console.log(JSON.stringify(inbox.agent_bot_config ?? inbox.additional_attributes, null, 2));

// Check inbox members
const members = await fetch(`${CW_BASE}/api/v1/accounts/1/inbox_members/11`, { headers: CW_H }).then(r => r.json()).catch(() => ({}));
console.log('\n=== Inbox 11 members ===');
console.log(JSON.stringify(members, null, 2));

// Redis: verificar chave do teste T5
const { default: Redis } = await import('ioredis');
const redis = new Redis(process.env.REDIS_URL, { lazyConnect: true, connectTimeout: 3000 });
await redis.connect();

const testKey = 'human_takeover:suporte-redatudo:5500000000001';
const val = await redis.get(testKey);
console.log(`\n=== Redis key "${testKey}" ===`);
console.log('Value (should be null after resolve):', val);

// Verificar se bot está com chave ativa em alguma conversa real
const allTakeover = await redis.keys('human_takeover:*');
console.log('\n=== Chaves human_takeover ativas ===');
for (const k of allTakeover) {
  const v = await redis.get(k);
  const ttl = await redis.ttl(k);
  console.log(`  ${k} = "${v}" (TTL: ${ttl}s)`);
}

await redis.quit();

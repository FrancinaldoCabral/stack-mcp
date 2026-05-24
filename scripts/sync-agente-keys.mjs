/**
 * Diagnóstico: verifica businesses no MongoDB e sincroniza chaves agente:* no Redis.
 * NÃO deleta nenhum dado.
 */
import 'dotenv/config';
import Redis from 'ioredis';
import { MongoClient } from 'mongodb';

const redis = new Redis({
  host: process.env.REDIS_HOST,
  port: parseInt(process.env.REDIS_PORT ?? '6379'),
  password: process.env.REDIS_PASSWORD,
});

// ─── Redis: ver estado atual ───────────────────────────────────────────────
const agentKeys = await redis.keys('agente:*');
console.log('Redis agente:* existentes:', agentKeys.length ? agentKeys : '(nenhuma)');
for (const k of agentKeys) {
  const v = await redis.get(k);
  console.log(`  ${k} →`, v?.slice(0, 100));
}

// ─── MongoDB: ver businesses ───────────────────────────────────────────────
const rawUri = process.env.MONGODB_URI ?? '';
const mongoUri = rawUri
  .replace(/@[^@:/]+:/, '@157.173.111.65:')
  .replace(/directConnection=[^&]*/g, '').replace(/\?&/g, '?').replace(/\?$/, '');

const client = new MongoClient(mongoUri);
await client.connect();
const db = client.db('vendly');

const bizs = await db.collection('businesses')
  .find({}).project({ name: 1, instances: 1, instanceInboxes: 1, instanceAgents: 1, agents: 1 })
  .toArray();

console.log(`\nMongoDB — businesses: ${bizs.length}`);
for (const b of bizs) {
  console.log(`  [${b._id}] ${b.name}`);
  console.log(`    instances:     `, b.instances ?? []);
  console.log(`    instanceAgents:`, b.instanceAgents ?? {});
  const agents = (b.agents ?? []).map(a => `${a._id}=${a.assistantName ?? a.name}`);
  console.log(`    agents:        `, agents);
}

await client.close();

// ─── Seed agente:* a partir do MongoDB ────────────────────────────────────
console.log('\n── Sincronizando chaves agente:* ─────────────────────────────');
let written = 0;
for (const biz of bizs) {
  const instanceAgents = biz.instanceAgents ?? {};
  const agents = biz.agents ?? [];
  for (const [instName, agentId] of Object.entries(instanceAgents)) {
    const agent = agents.find(a => String(a._id) === String(agentId));
    if (!agent) {
      console.log(`  ⚠️  ${instName}: agente ${agentId} não encontrado em biz.agents`);
      continue;
    }
    const key = `agente:${instName}`;
    const existing = await redis.get(key);
    if (existing) {
      console.log(`  ✓  ${key} já existe`);
    } else {
      const val = JSON.stringify({
        assistantName: agent.assistantName ?? agent.name,
        systemPrompt: agent.systemPrompt ?? '',
        model: agent.model ?? 'google/gemini-2.5-flash-lite',
        businessId: String(biz._id),
      });
      await redis.set(key, val);
      console.log(`  ✅ ${key} criado →`, val.slice(0, 80));
      written++;
    }
  }
}

if (bizs.length === 0) {
  console.log('  ⚠️  Nenhum business no MongoDB. Configure via dashboard ou API.');
  console.log('     Criando agente de TESTE para "suporte-redatudo"...');
  const testKey = 'agente:suporte-redatudo';
  const testVal = JSON.stringify({
    assistantName: 'Vendly AI',
    systemPrompt: 'Você é Vendly AI, assistente virtual. Responda de forma simpática e objetiva em português.',
    model: 'google/gemini-2.5-flash-lite',
    businessId: 'test',
  });
  await redis.set(testKey, testVal);
  console.log(`  ✅ ${testKey} criado (teste)`);
} else if (written === 0 && !agentKeys.length) {
  console.log('  ⚠️  Businesses existem mas instanceAgents está vazio.');
  console.log('     Atribua um agente a uma instância no dashboard para ativar o bot.');
}

console.log('\nPronto!');
redis.disconnect();

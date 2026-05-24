import { config } from 'dotenv';
config();
import Redis from 'ioredis';
import { MongoClient } from 'mongodb';

const redis = new Redis({
  host: process.env.REDIS_HOST,
  port: process.env.REDIS_PORT,
  password: process.env.REDIS_PASSWORD,
  db: process.env.REDIS_DB || 0
});

// Session mais recente
const k = 'sessao:suporte-redatudo:120363413878404654@g.us';
const v = await redis.get(k);
const hist = v ? JSON.parse(v) : [];
console.log('=== Sessao atual (' + hist.length + ' msgs) ===');
hist.slice(-4).forEach(m => {
  const c = typeof m.content === 'string' ? m.content : JSON.stringify(m.content);
  console.log('[' + m.role + '] ' + c.slice(0, 500));
  console.log('---');
});
redis.disconnect();

// MongoDB business system prompt
const client = new MongoClient(process.env.MONGODB_URI);
await client.connect();
const db = client.db('vendly');
const businesses = await db.collection('businesses').find({}).toArray();
console.log('\n=== Businesses (' + businesses.length + ') ===');
for (const biz of businesses) {
  const prompt = biz.systemPrompt ?? biz.settings?.systemPrompt ?? biz.prompt ?? '';
  console.log('Business:', biz.name || biz._id || biz.businessId);
  console.log('System prompt:', prompt.slice(0, 600) || '(vazio)');
  console.log('---');
}
await client.close();

// Limpa Chatwoot (convs+contatos), Redis (sessao/buffer/debounce/takeover) e Mongo (conversations, customers, delivery_orders/settlements)
import 'dotenv/config';
import Redis from 'ioredis';
import { MongoClient } from 'mongodb';

const CW = process.env.CHATWOOT_URL || 'https://chatwoot.vendly.chat';
const KEY = process.env.CHATWOOT_API_KEY;
const ACC = process.env.CHATWOOT_ACCOUNT_ID || '1';

async function cwGet(path) {
  const r = await fetch(`${CW}${path}`, { headers: { api_access_token: KEY } });
  return r.json();
}
async function cwDel(path) {
  const r = await fetch(`${CW}${path}`, { method: 'DELETE', headers: { api_access_token: KEY } });
  return r.status;
}

(async () => {
  // 1. Chatwoot conversations (todas)
  for (let page = 1; page < 20; page++) {
    const d = await cwGet(`/api/v1/accounts/${ACC}/conversations?status=all&page=${page}`);
    const list = d?.data?.payload || [];
    if (!list.length) break;
    const res = await Promise.allSettled(list.map(c => cwDel(`/api/v1/accounts/${ACC}/conversations/${c.id}`)));
    console.log(`chatwoot convs page ${page}: ${res.filter(r=>r.status==='fulfilled').length}/${list.length}`);
  }
  // 2. Chatwoot contacts (todos)
  for (let page = 1; page < 50; page++) {
    const d = await cwGet(`/api/v1/accounts/${ACC}/contacts?page=${page}`);
    const list = d?.payload || [];
    if (!list.length) break;
    const res = await Promise.allSettled(list.map(c => cwDel(`/api/v1/accounts/${ACC}/contacts/${c.id}`)));
    console.log(`chatwoot contacts page ${page}: ${res.filter(r=>r.status==='fulfilled').length}/${list.length}`);
  }

  // 3. Redis
  const redis = new Redis(process.env.REDIS_URL);
  let total = 0;
  for (const prefix of ['sessao', 'human_takeover', 'debounce_ts', 'buffer']) {
    let cursor = '0';
    do {
      const [next, keys] = await redis.scan(cursor, 'MATCH', `${prefix}:*`, 'COUNT', 200);
      cursor = next;
      if (keys.length) { await redis.del(...keys); total += keys.length; }
    } while (cursor !== '0');
  }
  console.log(`redis: ${total} chaves`);
  redis.disconnect();

  // 4. Mongo
  const mc = new MongoClient(process.env.MONGODB_URI);
  await mc.connect();
  const db = mc.db('vendly');
  for (const col of ['conversations', 'customers', 'delivery_orders', 'delivery_settlements']) {
    const r = await db.collection(col).deleteMany({});
    console.log(`mongo ${col}: ${r.deletedCount}`);
  }
  await mc.close();

  console.log('done');
})().catch(e => { console.error(e); process.exit(1); });

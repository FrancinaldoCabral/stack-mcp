#!/usr/bin/env node
/**
 * clean-data.mjs
 * Limpa TODOS os dados de teste:
 *  - MongoDB: businesses, customers, conversations, knowledgePoints
 *  - Redis: todas as chaves de sessão, handoff, debounce, buffer, qr_link
 *  - Evolution: lista e deleta todas as instâncias
 */

import * as fs from 'fs';

// Ler .env manualmente (ESM não tem dotenv por padrão no script)
const env = {};
fs.readFileSync('.env', 'utf8').split('\n').forEach(line => {
  const idx = line.indexOf('=');
  if (idx > 0 && !line.startsWith('#')) {
    env[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
  }
});

const MONGO_URI = env.MONGODB_URI;
const REDIS_HOST = env.REDIS_HOST;
const REDIS_PORT = parseInt(env.REDIS_PORT ?? '6379', 10);
const REDIS_PASS = env.REDIS_PASSWORD ?? '';
const EVO_URL    = env.EVOLUTION_URL;
const EVO_KEY    = env.EVOLUTION_API_KEY;

if (!MONGO_URI || !EVO_URL) {
  console.error('❌ MONGODB_URI ou EVOLUTION_URL não definidos no .env');
  process.exit(1);
}

// ── MongoDB ──────────────────────────────────────────────────────────────────
import { MongoClient } from 'mongodb';

// Se o URI usa hostname interno Coolify, substituir pelo IP público (mesmo servidor, porta 5439)
const mongoCredsMatch = MONGO_URI.match(/mongodb:\/\/([^@]+@)/);
const mongoCreds = mongoCredsMatch ? mongoCredsMatch[1] : '';
const publicMongoUri = REDIS_HOST
  ? `mongodb://${mongoCreds}${REDIS_HOST}:5439/?directConnection=true`
  : MONGO_URI;

console.log('🔗 Conectando ao MongoDB...');
try {
  const client = new MongoClient(publicMongoUri, { serverSelectionTimeoutMS: 8000 });
  await client.connect();
  const db = client.db();
  const collections = ['businesses', 'customers', 'conversations', 'knowledgePoints', 'knowledge'];
  for (const col of collections) {
    const result = await db.collection(col).deleteMany({});
    console.log(`  🗑️  ${col}: ${result.deletedCount} documentos removidos`);
  }
  await client.close();
  console.log('✅ MongoDB limpo\n');
} catch (e) {
  console.log(`⚠️  MongoDB inacessível (${publicMongoUri.replace(/:[^:@]+@/, ':***@')}): ${e.message}\n`);
}

// ── Redis ─────────────────────────────────────────────────────────────────────
import { Redis } from 'ioredis';

console.log('🔗 Conectando ao Redis...');
try {
  const redis = new Redis({ host: REDIS_HOST, port: REDIS_PORT, password: REDIS_PASS, lazyConnect: true, connectTimeout: 8000 });
  await redis.connect();
  const patterns = ['sessao:*', 'handoff:*', 'debounce_ts:*', 'buffer:*', 'qr_link:*'];
  let redisTotal = 0;
  for (const pattern of patterns) {
    let cursor = '0';
    const keys = [];
    do {
      const [next, found] = await redis.scan(cursor, 'MATCH', pattern, 'COUNT', 200);
      cursor = next;
      keys.push(...found);
    } while (cursor !== '0');
    if (keys.length > 0) { await redis.del(...keys); redisTotal += keys.length; console.log(`  🗑️  ${pattern}: ${keys.length} chaves`); }
  }
  if (redisTotal === 0) console.log('  ℹ️  Nenhuma chave encontrada');
  await redis.quit();
  console.log('✅ Redis limpo\n');
} catch (e) {
  console.log(`⚠️  Redis inacessível: ${e.message}\n`);
}

// ── Evolution ─────────────────────────────────────────────────────────────────
console.log('🔗 Buscando instâncias Evolution...');
const listRes = await fetch(`${EVO_URL}/instance/fetchInstances`, {
  headers: { apikey: EVO_KEY },
});
const instances = await listRes.json();

if (!Array.isArray(instances) || instances.length === 0) {
  console.log('  ℹ️  Nenhuma instância encontrada no Evolution');
} else {
  for (const inst of instances) {
    const name = inst.instance?.instanceName ?? inst.instanceName;
    if (!name) continue;
    const r = await fetch(`${EVO_URL}/instance/delete/${name}`, {
      method: 'DELETE',
      headers: { apikey: EVO_KEY },
    });
    const status = r.status;
    console.log(`  🗑️  Instância "${name}" deletada (HTTP ${status})`);
  }
}
console.log('✅ Evolution limpo\n');

console.log('🎉 Limpeza concluída! Base de dados pronta para teste do fluxo completo.');

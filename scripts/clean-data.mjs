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
const EVO_URL       = env.EVOLUTION_URL;
const EVO_KEY       = env.EVOLUTION_API_KEY;
const CHATWOOT_URL  = env.CHATWOOT_URL;
const CHATWOOT_KEY  = env.CHATWOOT_API_KEY;
const CHATWOOT_ACC  = env.CHATWOOT_ACCOUNT_ID?.replace(/\s*#.*/,'').trim() ?? '1';

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
  const db = client.db('vendly');
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
try {
  const listRes = await fetch(`${EVO_URL}/instance/fetchInstances`, {
    headers: { apikey: EVO_KEY },
  });
  const raw = await listRes.json();

  // A API pode retornar array direto ou { data: [...] } ou { instances: [...] }
  const instances = Array.isArray(raw) ? raw
    : Array.isArray(raw?.data) ? raw.data
    : Array.isArray(raw?.instances) ? raw.instances
    : [];

  console.log(`  📋 Resposta Evolution: ${JSON.stringify(raw).slice(0, 200)}`);

  if (instances.length === 0) {
    console.log('  ℹ️  Nenhuma instância encontrada no Evolution');
  } else {
    for (const inst of instances) {
      const name = inst.instance?.instanceName ?? inst.instanceName ?? inst.name;
      if (!name) { console.log('  ⚠️  Instância sem nome:', JSON.stringify(inst)); continue; }
      const r = await fetch(`${EVO_URL}/instance/delete/${name}`, {
        method: 'DELETE',
        headers: { apikey: EVO_KEY },
      });
      console.log(`  🗑️  Instância "${name}" deletada (HTTP ${r.status})`);
    }
  }
} catch (e) {
  console.log(`  ⚠️  Erro ao limpar Evolution: ${e.message}`);
}
console.log('✅ Evolution limpo\n');

// ── Chatwoot ──────────────────────────────────────────────────────────────────
if (CHATWOOT_URL && CHATWOOT_KEY) {
  console.log('🔗 Buscando dados Chatwoot...');
  const chatwootHeaders = { 'api_access_token': CHATWOOT_KEY, 'Content-Type': 'application/json' };

  // Deletar todas as inboxes (cascata: deleta conversations associadas)
  try {
    const inboxRes = await fetch(`${CHATWOOT_URL}/api/v1/accounts/${CHATWOOT_ACC}/inboxes`, { headers: chatwootHeaders });
    const inboxData = await inboxRes.json();
    const inboxes = inboxData?.payload ?? [];
    if (inboxes.length === 0) {
      console.log('  ℹ️  Nenhuma inbox encontrada no Chatwoot');
    } else {
      for (const inbox of inboxes) {
        const r = await fetch(`${CHATWOOT_URL}/api/v1/accounts/${CHATWOOT_ACC}/inboxes/${inbox.id}`, {
          method: 'DELETE',
          headers: chatwootHeaders,
        });
        console.log(`  🗑️  Inbox "${inbox.name}" (id=${inbox.id}) deletada (HTTP ${r.status})`);
      }
    }
  } catch (e) {
    console.log(`  ⚠️  Erro ao limpar inboxes Chatwoot: ${e.message}`);
  }

  // Deletar todos os contatos
  try {
    let page = 1;
    let totalContacts = 0;
    while (true) {
      const cRes = await fetch(`${CHATWOOT_URL}/api/v1/accounts/${CHATWOOT_ACC}/contacts?page=${page}&include_contacts=true`, { headers: chatwootHeaders });
      const cData = await cRes.json();
      const contacts = cData?.payload?.length ? cData.payload : (Array.isArray(cData?.payload) ? cData.payload : null);
      if (!contacts || contacts.length === 0) break;
      for (const contact of contacts) {
        await fetch(`${CHATWOOT_URL}/api/v1/accounts/${CHATWOOT_ACC}/contacts/${contact.id}`, {
          method: 'DELETE',
          headers: chatwootHeaders,
        });
        totalContacts++;
      }
      if (contacts.length < 15) break;
      page++;
    }
    if (totalContacts > 0) console.log(`  🗑️  ${totalContacts} contatos deletados`);
    else console.log('  ℹ️  Nenhum contato encontrado no Chatwoot');
  } catch (e) {
    console.log(`  ⚠️  Erro ao limpar contatos Chatwoot: ${e.message}`);
  }

  console.log('✅ Chatwoot limpo\n');
} else {
  console.log('⚠️  CHATWOOT_URL ou CHATWOOT_API_KEY não definidos — pulando Chatwoot\n');
}

console.log('🎉 Limpeza concluída! Base de dados pronta para teste do fluxo completo.');

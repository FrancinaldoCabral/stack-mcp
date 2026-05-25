/**
 * clean-test-convs.mjs
 * Limpa TUDO das conversas de teste (10 e 11) no Chatwoot, Redis e MongoDB.
 */
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import Redis from 'ioredis';
import { MongoClient } from 'mongodb';

const __dir = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dir, '..', '.env') });

const CW_BASE = 'https://chatwoot.vendly.chat';
const CW_H = { 'api_access_token': process.env.CHATWOOT_API_KEY, 'Content-Type': 'application/json' };

const CONVS = [
  { id: 10, jid: '120363410205219199@g.us',  name: 'Restaurante 1' },
  { id: 11, jid: '120363413878404654@g.us',  name: 'LT Restaurante 1' },
];
const INSTANCE = 'suporte-redatudo';

// ── Chatwoot: apagar TODAS as mensagens outgoing ─────────────────────────
console.log('\n── Chatwoot: apagando mensagens ──');
for (const conv of CONVS) {
  const r = await fetch(`${CW_BASE}/api/v1/accounts/1/conversations/${conv.id}/messages`, { headers: CW_H });
  const d = await r.json();
  const msgs = d.payload ?? [];
  console.log(`Conv ${conv.id} (${conv.name}): ${msgs.length} mensagens`);

  let deleted = 0;
  for (const m of msgs) {
    // Deletar TODAS (incoming e outgoing) — reset completo
    const dr = await fetch(`${CW_BASE}/api/v1/accounts/1/conversations/${conv.id}/messages/${m.id}`, {
      method: 'DELETE', headers: CW_H,
    });
    if (dr.status === 200) {
      deleted++;
    } else {
      // Alguns tipos de mensagem (activity) não são deletáveis — ignorar
      const body = await dr.text();
      if (!body.includes('not found') && dr.status !== 404 && dr.status !== 405) {
        console.log(`  ⚠ DELETE msg ${m.id}: ${dr.status} ${body.slice(0, 80)}`);
      }
    }
  }
  console.log(`  ✓ ${deleted}/${msgs.length} mensagens deletadas`);
}

// ── Redis: apagar TODAS as chaves relacionadas ───────────────────────────
console.log('\n── Redis: limpando chaves ──');
const redis = new Redis(process.env.REDIS_URL);

const patterns = CONVS.flatMap(conv => [
  `sessao:${INSTANCE}:${conv.jid}`,
  `human_takeover:${INSTANCE}:${conv.jid}`,
  `debounce_ts:${INSTANCE}:${conv.jid}`,
  `buffer:${INSTANCE}:${conv.jid}`,
  `cliente:${INSTANCE}:${conv.jid}`,
  `contexto:${INSTANCE}:${conv.jid}`,
]);

// Também varrer por padrão glob
const scanPatterns = [
  `*${CONVS[0].jid}*`,
  `*${CONVS[1].jid}*`,
];

const allKeys = new Set(patterns);
for (const pattern of scanPatterns) {
  let cursor = '0';
  do {
    const [nextCursor, keys] = await redis.scan(cursor, 'MATCH', pattern, 'COUNT', 100);
    cursor = nextCursor;
    for (const k of keys) allKeys.add(k);
  } while (cursor !== '0');
}

let redisDeleted = 0;
for (const key of allKeys) {
  const n = await redis.del(key);
  if (n > 0) {
    console.log(`  ✓ DEL ${key}`);
    redisDeleted++;
  }
}
if (redisDeleted === 0) console.log('  (nenhuma chave encontrada)');
await redis.disconnect();

// ── MongoDB: apagar logs e dados das conversas ───────────────────────────
console.log('\n── MongoDB: limpando dados ──');
const mongo = new MongoClient(process.env.MONGODB_URI);
await mongo.connect();
const db = mongo.db();

// Listar coleções para descobrir onde estão os logs
const collections = await db.listCollections().toArray();
console.log('  Coleções:', collections.map(c => c.name).join(', '));

let mongoDeleted = 0;
for (const col of collections) {
  const coll = db.collection(col.name);
  // Tentar deletar por jid, telefone, remoteJid, conversation_id
  for (const conv of CONVS) {
    const q = {
      $or: [
        { telefone: conv.jid },
        { remoteJid: conv.jid },
        { conversation_id: conv.id },
        { conversation_id: String(conv.id) },
        { jid: conv.jid },
      ],
    };
    const result = await coll.deleteMany(q);
    if (result.deletedCount > 0) {
      console.log(`  ✓ ${col.name}: ${result.deletedCount} docs deletados (conv ${conv.id})`);
      mongoDeleted += result.deletedCount;
    }
  }
}
if (mongoDeleted === 0) console.log('  (nenhum documento encontrado)');
await mongo.close();

console.log('\n──────────────────────────────────────────────────');
console.log('✅ LIMPEZA COMPLETA');
console.log('  Chatwoot: mensagens deletadas');
console.log('  Redis: chaves deletadas:', redisDeleted);
console.log('  MongoDB: documentos deletados:', mongoDeleted);

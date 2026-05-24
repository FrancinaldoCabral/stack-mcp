import 'dotenv/config';
import Redis from 'ioredis';

const r = new Redis(process.env.REDIS_URL);

const info = await r.info('keyspace');
console.log('Keyspace:\n', info);

const agenteKeys = await r.keys('agente:*');
console.log('Chaves agente:', agenteKeys);

const sessKeys = await r.keys('sessao:*');
console.log('Chaves sessao (primeiras 5):', sessKeys.slice(0, 5));

const allKeys = await r.keys('*');
console.log(`Total chaves DB atual: ${allKeys.length}`);
console.log('Primeiras 20:', allKeys.slice(0, 20));

r.disconnect();

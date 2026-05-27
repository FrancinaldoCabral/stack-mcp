import 'dotenv/config';
import axios from 'axios';
import Redis from 'ioredis';

const h = { 'X-N8N-API-KEY': process.env.N8N_API_KEY };
const N8N = 'https://workflows.vendly.chat/api/v1';

// Limpar takeover key primeiro
const redis = new Redis(process.env.REDIS_URL);
const KEY = 'human_takeover:suporte-redatudo:120363410205219199@g.us';
await redis.del(KEY);
console.log('Redis takeover key deleted');

// Disparar pedido de humano
const payload = {
  instance: 'suporte-redatudo',
  telefone: '120363410205219199@g.us',
  remoteJid: '120363410205219199@g.us',
  conteudo: 'preciso urgentemente falar com um humano',
  tipo: 'texto',
  pushName: 'Teste Notif',
  conversation_id: '10',
  account_id: '1',
  currentMsgIds: [],
};
const r = await axios.post('https://workflows.vendly.chat/webhook/agent-executor', payload, { timeout: 90000 });
console.log('Webhook status:', r.status);
await new Promise(r => setTimeout(r, 25000));

const ex = (await axios.get(`${N8N}/executions?workflowId=jleu4RPvSnYDL8Gd&limit=3`, { headers: h })).data;
const eid = (ex.data ?? ex)[0].id;
const det = (await axios.get(`${N8N}/executions/${eid}?includeData=true`, { headers: h })).data;
const rd = det.data?.resultData?.runData ?? {};

function summary(name) {
  const runs = rd[name];
  if (!runs) return 'NOT RUN';
  const items = runs[0]?.data?.main?.[0] ?? [];
  return `ran=${runs.length} items=${items.length}` + (items[0] ? ` | first=${JSON.stringify(items[0].json).slice(0,200)}` : '');
}

console.log('\n=== Exec', eid, 'status=', det.status, '===');
console.log('Parsear Chunks   :', summary('Parsear Chunks'));
console.log('Escalada Humano  :', summary('Escalada Humano'));
console.log('Redis SET Take.  :', summary('Redis SET Takeover Escalada'));
console.log('Chatwoot Add Lbl :', summary('Chatwoot Add Label Humano'));
console.log('Chatwoot Urgent  :', summary('Chatwoot Set Urgent'));
console.log('Chatwoot Reabrir :', summary('Chatwoot Reabrir'));
console.log('Preparar Notif   :', summary('Preparar Notif WhatsApp'));
console.log('Evolution Notif  :', summary('Evolution Send Notif'));

await redis.del(KEY);
console.log('\nLimpeza final: takeover key removida');
await redis.quit();

// Usa MCP em produção pra ler business LT e gravar agente:livraison-totale no Redis.
import 'dotenv/config';

const MCP = 'http://fco8og80s4sw4c0wc0ogswws.157.173.111.65.sslip.io/mcp';
const INSTANCE = process.env.LT_INSTANCE || 'livraison-totale';

let nextId = 1;
async function rpc(method, params) {
  const r = await fetch(MCP, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
    body: JSON.stringify({ jsonrpc: '2.0', id: nextId++, method, params }),
  });
  const txt = await r.text();
  const dataLine = txt.split('\n').reverse().find(l => l.startsWith('data:'));
  if (!dataLine) throw new Error('sem data: ' + txt.slice(0, 300));
  const obj = JSON.parse(dataLine.slice(5).trim());
  if (obj.error) throw new Error(JSON.stringify(obj.error));
  return obj.result;
}

async function callTool(name, args) {
  const res = await rpc('tools/call', { name, arguments: args });
  const text = res?.content?.[0]?.text ?? '';
  try { return JSON.parse(text); } catch { return text; }
}

await rpc('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'fix-lt', version: '1.0' } });

// 1) Lista tools disponíveis (debug rápido)
const tools = await rpc('tools/list', {});
const names = (tools.tools || []).map(t => t.name);
console.log('mongo tools:', names.filter(n => n.startsWith('mongo')).join(', '));
console.log('redis tools:', names.filter(n => n.startsWith('redis_')).slice(0,6).join(', '));

// descobrir database
const dbs = await callTool('mongo_list_databases', {});
console.log('[mongo] dbs=', dbs);
const DB = process.env.MONGO_DB || 'stack';

// 2) Busca business (campo é "instances" como array)
const found = await callTool('mongo_find', { database: DB, collection: 'businesses', filter: { instances: INSTANCE }, limit: 1 });
console.log('[mongo] find raw=', JSON.stringify(found).slice(0, 200));
const biz = Array.isArray(found) ? found[0] : (found?.documents?.[0] ?? found?.[0]);
if (!biz?._id) { console.error('Business não encontrado em db=' + DB); process.exit(1); }
console.log('[mongo] business=', biz._id, biz.name);

// 3) Conferir chave atual
const cur = await callTool('redis_get', { key: `agente:${INSTANCE}` });
console.log('[redis] atual =', cur);

// 4) Gravar
const cfg = {
  businessId: String(biz._id),
  instanceName: INSTANCE,
  businessName: biz.name || INSTANCE,
  systemPrompt: biz.systemPrompt || 'Você é um agente de atendimento.',
  model: biz.model || 'google/gemini-2.5-flash-lite',
  active: true,
};
const setRes = await callTool('redis_set', { key: `agente:${INSTANCE}`, value: JSON.stringify(cfg) });
console.log('[redis] SET =', setRes);

const verify = await callTool('redis_get', { key: `agente:${INSTANCE}` });
console.log('[redis] verify =', String(verify).slice(0, 200));
console.log('✅ ok');

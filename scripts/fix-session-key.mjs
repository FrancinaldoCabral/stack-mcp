import 'dotenv/config';
import Redis from 'ioredis';

const N8N_URL = 'https://workflows.vendly.chat';
const WF_ID = 'jleu4RPvSnYDL8Gd';
const h = { 'X-N8N-API-KEY': process.env.N8N_API_KEY, 'Accept': 'application/json', 'Content-Type': 'application/json' };

async function fixWorkflow() {
  const wf = await fetch(`${N8N_URL}/api/v1/workflows/${WF_ID}`, { headers: h }).then(r => r.json());
  const node = wf.nodes.find(n => n.name === 'Construir Prompt');
  if (!node) throw new Error('Construir Prompt não encontrado');

  const oldReturn = `return [{ json: { messages, model: modeloLLM, instance: msg.instance, telefone: msg.telefone, remoteJid: msg.remoteJid, tipo: msg.tipo } }];`;
  const newReturn = `const businessId = String($('MongoDB GET Business').first()?.json?._id ?? '');\nreturn [{ json: { messages, model: modeloLLM, instance: msg.instance, telefone: msg.telefone, remoteJid: msg.remoteJid, businessId, tipo: msg.tipo } }];`;

  if (!node.parameters.jsCode.includes(oldReturn)) {
    const idx = node.parameters.jsCode.indexOf('return [{ json: { messages');
    console.log('WARN - linha não encontrada. Trecho atual:');
    console.log(node.parameters.jsCode.slice(idx, idx + 200));
    return false;
  }

  node.parameters.jsCode = node.parameters.jsCode.replace(oldReturn, newReturn);
  console.log('[FIX] businessId adicionado ao return de Construir Prompt');

  const body = { name: wf.name, nodes: wf.nodes, connections: wf.connections, settings: { executionOrder: 'v1', saveManualExecutions: true } };
  const res = await fetch(`${N8N_URL}/api/v1/workflows/${WF_ID}`, { method: 'PUT', headers: h, body: JSON.stringify(body) });
  console.log('Workflow salvo:', res.status, res.ok ? 'OK' : await res.text());
  return res.ok;
}

async function cleanRedis() {
  const redis = new Redis({ host: process.env.REDIS_HOST, port: Number(process.env.REDIS_PORT), password: process.env.REDIS_PASSWORD });

  // Deletar todas as sessões e buffers de teste
  const sessoes = await redis.keys('sessao:*');
  const buffers = await redis.keys('buffer:suporte-redatudo:*');
  const debounces = await redis.keys('debounce_ts:suporte-redatudo:*');

  const all = [...sessoes, ...buffers, ...debounces];
  if (all.length > 0) {
    await redis.del(...all);
    console.log('[CLEAN] Redis: deletadas', all.length, 'chaves:', all);
  } else {
    console.log('[CLEAN] Redis: nenhuma chave de sessão/buffer para deletar');
  }

  redis.disconnect();
}

async function checkChatwoot() {
  const cwH = { 'api_access_token': process.env.CHATWOOT_API_KEY };
  const inboxes = await fetch('https://chatwoot.vendly.chat/api/v1/accounts/1/inboxes', { headers: cwH }).then(r => r.json());
  const inbox = inboxes.payload?.find(i => i.name === 'suporte-redatudo');
  if (!inbox) { console.log('[CHATWOOT] Inbox não encontrado'); return; }

  const url = `https://chatwoot.vendly.chat/api/v1/accounts/1/conversations?inbox_id=${inbox.id}&page=1`;
  const convs = await fetch(url, { headers: cwH }).then(r => r.json());
  const total = convs.data?.meta?.all_count ?? 0;
  console.log(`[CHATWOOT] Inbox "${inbox.name}" (id=${inbox.id}): ${total} conversas`);
  (convs.data?.payload ?? []).forEach(c =>
    console.log(`  conv ${c.id} | status: ${c.status} | sender: ${c.meta?.sender?.name} | msgs: ${c.messages_count}`)
  );
}

console.log('=== Fix Session Key + Limpeza ===\n');
fixWorkflow()
  .then(() => cleanRedis())
  .then(() => checkChatwoot())
  .catch(console.error);

import 'dotenv/config';
import axios from 'axios';

const payload = {
  instance: 'suporte-redatudo',
  telefone: '120363410205219199@g.us',
  remoteJid: '120363410205219199@g.us',
  conteudo: 'voce lembra do que conversamos?',
  tipo: 'texto',
  pushName: 'TesteCopilot',
  conversation_id: '10',
  account_id: '1',
  currentMsgIds: [],
};
const r = await axios.post('https://workflows.vendly.chat/webhook/agent-executor', payload, { timeout: 60000 });
console.log('Webhook:', r.status, JSON.stringify(r.data).slice(0, 100));

await new Promise(r => setTimeout(r, 12000));

const h = { 'X-N8N-API-KEY': process.env.N8N_API_KEY };
const exec = (await axios.get('https://workflows.vendly.chat/api/v1/executions?workflowId=jleu4RPvSnYDL8Gd&limit=2', { headers: h })).data;
const eid = (exec.data ?? exec)[0].id;
const det = (await axios.get('https://workflows.vendly.chat/api/v1/executions/' + eid + '?includeData=true', { headers: h })).data;
const rd = det.data?.resultData?.runData ?? {};

const redisRaw = rd['Redis GET Sessao']?.[0]?.data?.main?.[0]?.[0]?.json?.value;
let redisLen = 0; try { redisLen = JSON.parse(redisRaw ?? '[]').length; } catch {}
const cwLen = rd['Preparar Histórico Chatwoot']?.[0]?.data?.main?.[0]?.[0]?.json?.historico?.length ?? 0;
const mh = rd['Mesclar Histórico']?.[0]?.data?.main?.[0]?.[0]?.json?.historico?.length ?? 0;
const cp = rd['Construir Prompt']?.[0]?.data?.main?.[0]?.[0]?.json;
const set = rd['Redis SET Sessao']?.[0]?.data?.main?.[0]?.[0]?.json?.contexto?.historico?.length ?? 0;

console.log('Exec', eid, '| status:', det.status);
console.log('  Redis GET:', redisLen);
console.log('  Chatwoot:', cwLen);
console.log('  Mesclar:', mh);
console.log('  CP.historico:', cp?.historico?.length);
console.log('  Prompt msgs ao LLM:', cp?.messages?.length);
console.log('  SET final:', set);

const or = rd['OpenRouter']?.[0]?.data?.main?.[0]?.[0]?.json;
console.log('\nLLM resposta:', or?.choices?.[0]?.message?.content?.slice(0, 400));

const err = det.data?.resultData?.error;
if (err) console.log('\nERRO:', err.message, '@', err.node?.name);

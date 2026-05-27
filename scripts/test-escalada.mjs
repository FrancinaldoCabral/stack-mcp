import 'dotenv/config';
import axios from 'axios';
const h = { 'X-N8N-API-KEY': process.env.N8N_API_KEY };
const N8N = 'https://workflows.vendly.chat/api/v1';

// Trigger agent with escalation request
const payload = {
  instance: 'suporte-redatudo',
  telefone: '120363410205219199@g.us',
  remoteJid: '120363410205219199@g.us',
  conteudo: 'preciso falar com um humano por favor',
  tipo: 'texto',
  pushName: 'TesteEscalada',
  conversation_id: '10',
  account_id: '1',
  currentMsgIds: [],
};
const r = await axios.post('https://workflows.vendly.chat/webhook/agent-executor', payload, { timeout: 60000 });
console.log('Webhook:', r.status);
await new Promise(r => setTimeout(r, 15000));

const ex = (await axios.get(`${N8N}/executions?workflowId=jleu4RPvSnYDL8Gd&limit=2`, { headers: h })).data;
const eid = (ex.data ?? ex)[0].id;
const det = (await axios.get(`${N8N}/executions/${eid}?includeData=true`, { headers: h })).data;
const rd = det.data?.resultData?.runData ?? {};
const or = rd['OpenRouter']?.[0]?.data?.main?.[0]?.[0]?.json;
const resp = or?.choices?.[0]?.message?.content ?? '';
const parse = rd['Parsear Chunks']?.[0]?.data?.main?.[0]?.[0]?.json;
const esc = rd['Escalada Humano']?.[0]?.data?.main?.[0];
const setT = rd['Redis SET Takeover Escalada']?.[0]?.data?.main?.[0];
const nota = rd['Chatwoot Nota Escalada']?.[0]?.data?.main?.[0];

console.log(`\nExec ${eid} | status=${det.status}`);
console.log('LLM resp:', resp.slice(0, 200));
console.log('escalarHumano detected:', parse?.escalarHumano);
console.log('Escalada Humano ran:', esc ? `yes (${esc.length} items)` : 'NO');
console.log('Redis SET Takeover ran:', setT ? `yes (${setT.length} items)` : 'NO');
console.log('Chatwoot Nota Escalada ran:', nota ? `yes (${nota.length} items)` : 'NO');

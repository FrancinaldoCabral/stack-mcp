import 'dotenv/config';
import axios from 'axios';
const h = { 'X-N8N-API-KEY': process.env.N8N_API_KEY };
const N8N = 'https://workflows.vendly.chat/api/v1';

// Últimas execuções [CORE] Entrada e [AGENT]
const ent = (await axios.get(`${N8N}/executions?workflowId=bEb19TdWZfFloisU&limit=30`, { headers: h })).data;
const ag = (await axios.get(`${N8N}/executions?workflowId=jleu4RPvSnYDL8Gd&limit=15`, { headers: h })).data;
const ao = (await axios.get(`${N8N}/executions?workflowId=Jijw4Dqil3QVYSp8&limit=30`, { headers: h })).data;

console.log('=== ÚLTIMAS ENTRADAS (mensagens recebidas) ===');
for (const e of (ent.data ?? ent).slice(0, 25)) {
  const det = (await axios.get(`${N8N}/executions/${e.id}?includeData=true`, { headers: h })).data;
  const rd = det.data?.resultData?.runData ?? {};
  // procura o payload da Evolution
  const wh = rd['Webhook']?.[0]?.data?.main?.[0]?.[0]?.json
          ?? rd['Webhook Evolution']?.[0]?.data?.main?.[0]?.[0]?.json;
  const body = wh?.body ?? wh;
  const tk = rd['Redis GET human_takeover']?.[0]?.data?.main?.[0]?.[0]?.json;
  const auto = rd['Auto-Aceitar Conversa']?.[0]?.data?.main?.[0];
  const callAgent = rd['Chamar Agente']?.[0]?.data?.main?.[0] ?? rd['HTTP Debounce Trigger']?.[0]?.data?.main?.[0];
  // Extract phone/remoteJid
  const msg = body?.data?.key ?? body?.message?.key ?? {};
  const remoteJid = msg.remoteJid ?? body?.remoteJid ?? '';
  const instance = body?.instance ?? '';
  console.log(`${e.id} | ${e.startedAt} | inst=${instance} jid=${remoteJid}`);
  console.log(`  takeover_value: ${JSON.stringify(tk?.takeover_value ?? null)}`);
  console.log(`  Auto-Aceitar passou: ${auto?.length ?? 0} item(s) | Chamar Agente: ${callAgent ? 'yes' : 'no'}`);
}

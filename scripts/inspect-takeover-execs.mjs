import 'dotenv/config';
import axios from 'axios';
const h = { 'X-N8N-API-KEY': process.env.N8N_API_KEY };
const N8N = 'https://workflows.vendly.chat/api/v1';

const r = await axios.get(`${N8N}/executions?workflowId=Jijw4Dqil3QVYSp8&limit=20`, { headers: h });
const execs = r.data.data ?? r.data;
console.log('Recent Auto-open execs:');
for (const e of execs.slice(0, 15)) console.log(`  ${e.id} | ${e.status} | ${e.startedAt}`);

// Inspect a few most recent
for (const e of execs.slice(0, 5)) {
  const det = (await axios.get(`${N8N}/executions/${e.id}?includeData=true`, { headers: h })).data;
  const rd = det.data?.resultData?.runData ?? {};
  const hand = rd['Handle Takeover Humano']?.[0]?.data?.main?.[0]?.[0]?.json;
  const wh = rd['Webhook Chatwoot']?.[0]?.data?.main?.[0]?.[0]?.json ?? rd['Webhook']?.[0]?.data?.main?.[0]?.[0]?.json;
  const body = wh?.body ?? wh;
  console.log(`\n=== ${e.id} ===`);
  console.log('event:', body?.event);
  console.log('conv:', JSON.stringify({
    id: body?.conversation?.id,
    inbox_id: body?.conversation?.inbox_id,
    status: body?.conversation?.status,
    assignee: body?.conversation?.meta?.assignee?.id,
    channel: body?.conversation?.meta?.channel,
    inbox: body?.inbox,
    sender_identifier: body?.contact?.identifier ?? body?.conversation?.meta?.sender?.identifier,
  }));
  console.log('Handle output:', JSON.stringify(hand));
}

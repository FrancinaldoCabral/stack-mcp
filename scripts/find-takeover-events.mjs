import 'dotenv/config';
import axios from 'axios';
const h = { 'X-N8N-API-KEY': process.env.N8N_API_KEY };
const N8N = 'https://workflows.vendly.chat/api/v1';

const r = await axios.get(`${N8N}/executions?workflowId=Jijw4Dqil3QVYSp8&limit=100`, { headers: h });
const execs = r.data.data ?? r.data;
console.log('Total:', execs.length);

for (const e of execs) {
  const det = (await axios.get(`${N8N}/executions/${e.id}?includeData=true`, { headers: h })).data;
  const rd = det.data?.resultData?.runData ?? {};
  const wh = rd['Webhook Auto-Open']?.[0]?.data?.main?.[0]?.[0]?.json;
  const event = wh?.body?.event;
  const hand = rd['Handle Takeover Humano']?.[0]?.data?.main?.[0]?.[0]?.json;
  if (event && event !== 'message_created') {
    console.log(`\n${e.id} | ${e.startedAt} | event=${event}`);
    const conv = wh.body.conversation;
    console.log(`  conv_id=${conv?.id} status=${conv?.status} inbox_id=${conv?.inbox_id} assignee=${conv?.meta?.assignee?.name ?? 'none'} channel=${conv?.meta?.channel} inbox.name=${wh.body.inbox?.name}`);
    console.log(`  sender.identifier=${wh.body.contact?.identifier ?? conv?.meta?.sender?.identifier}`);
    console.log(`  Handle output:`, JSON.stringify(hand));
  }
}

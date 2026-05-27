import 'dotenv/config';
import axios from 'axios';
const h = { 'X-N8N-API-KEY': process.env.N8N_API_KEY };
const N8N = 'https://workflows.vendly.chat/api/v1';

const r = await axios.get(`${N8N}/executions?workflowId=Jijw4Dqil3QVYSp8&limit=100`, { headers: h });
const execs = r.data.data ?? r.data;

for (const e of execs) {
  const det = (await axios.get(`${N8N}/executions/${e.id}?includeData=true`, { headers: h })).data;
  const wh = det.data?.resultData?.runData?.['Webhook Auto-Open']?.[0]?.data?.main?.[0]?.[0]?.json;
  const body = wh?.body;
  if (!body) continue;
  const event = body.event;
  // assignee may be at body.meta.assignee or body.assignee
  const assignee = body.meta?.assignee ?? body.assignee ?? body.conversation?.meta?.assignee ?? body.conversation?.assignee;
  const changedAttrs = body.changed_attributes ?? [];
  const hasAssigneeChange = changedAttrs.some(a => 'assignee_id' in a || a.assignee_id !== undefined);
  if (assignee || hasAssigneeChange || event === 'assignee_changed') {
    console.log(`\n${e.id} | ${e.startedAt} | event=${event}`);
    console.log(`  assignee=${JSON.stringify(assignee)}`);
    console.log(`  conv_id=${body.id ?? body.conversation?.id} inbox_id=${body.inbox_id ?? body.conversation?.inbox_id}`);
    console.log(`  identifier=${body.meta?.sender?.identifier ?? body.contact?.identifier}`);
    console.log(`  changed_attrs:`, JSON.stringify(changedAttrs).slice(0, 400));
  }
}
console.log('\nDone scan.');

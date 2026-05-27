import 'dotenv/config';
import axios from 'axios';
const h = { 'X-N8N-API-KEY': process.env.N8N_API_KEY };
const N8N = 'https://workflows.vendly.chat/api/v1';

// Simula payload Chatwoot real conversation_updated com assignee_id mudando null→1
const body = {
  id: 99,
  inbox_id: 11,
  status: 'open',
  event: 'conversation_updated',
  meta: {
    sender: { id: 999, identifier: '5599888887777@s.whatsapp.net', phone_number: '+5599888887777', name: 'TesteAssign', type: 'contact' },
    assignee: { id: 1, name: 'Naldo Cabral', type: 'user' },
  },
  changed_attributes: [{ assignee_id: { previous_value: null, current_value: 1 } }],
};

const r = await axios.post('https://workflows.vendly.chat/webhook/cw-auto-open', body, { timeout: 30000 });
console.log('Webhook:', r.status);
await new Promise(r => setTimeout(r, 5000));

const ex = (await axios.get(`${N8N}/executions?workflowId=Jijw4Dqil3QVYSp8&limit=2`, { headers: h })).data;
const eid = (ex.data ?? ex)[0].id;
const det = (await axios.get(`${N8N}/executions/${eid}?includeData=true`, { headers: h })).data;
const rd = det.data?.resultData?.runData ?? {};
const hand = rd['Handle Takeover Humano']?.[0]?.data?.main?.[0];
const setNode = rd['Redis SET human_takeover']?.[0]?.data?.main?.[0];
const delNode = rd['Redis DEL human_takeover']?.[0]?.data?.main?.[0];
console.log(`\nExec ${eid} | status=${det.status}`);
console.log('Handle output:', JSON.stringify(hand));
console.log('Redis SET ran:', setNode ? `yes` : 'no');
console.log('Redis DEL ran:', delNode ? `yes` : 'no');

// Agora simula UNASSIGN
const body2 = { ...body, meta: { ...body.meta, assignee: null }, changed_attributes: [{ assignee_id: { previous_value: 1, current_value: null } }] };
const r2 = await axios.post('https://workflows.vendly.chat/webhook/cw-auto-open', body2, { timeout: 30000 });
console.log('\nUnassign webhook:', r2.status);
await new Promise(r => setTimeout(r, 5000));
const ex2 = (await axios.get(`${N8N}/executions?workflowId=Jijw4Dqil3QVYSp8&limit=2`, { headers: h })).data;
const eid2 = (ex2.data ?? ex2)[0].id;
const det2 = (await axios.get(`${N8N}/executions/${eid2}?includeData=true`, { headers: h })).data;
const rd2 = det2.data?.resultData?.runData ?? {};
const hand2 = rd2['Handle Takeover Humano']?.[0]?.data?.main?.[0];
const delNode2 = rd2['Redis DEL human_takeover']?.[0]?.data?.main?.[0];
console.log(`Exec ${eid2} | status=${det2.status}`);
console.log('Handle output:', JSON.stringify(hand2));
console.log('Redis DEL ran:', delNode2 ? 'yes' : 'no');

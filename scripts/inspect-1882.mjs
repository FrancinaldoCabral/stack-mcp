import 'dotenv/config';
import axios from 'axios';
const h = { 'X-N8N-API-KEY': process.env.N8N_API_KEY };
const N8N = 'https://workflows.vendly.chat/api/v1';

const det = (await axios.get(`${N8N}/executions/1850?includeData=true`, { headers: h })).data;
const rd = det.data?.resultData?.runData ?? {};
console.log('Nós:', Object.keys(rd));
for (const k of Object.keys(rd)) {
  const out = rd[k]?.[0]?.data?.main?.[0]?.[0]?.json;
  console.log(`\n--- ${k} ---`);
  console.log(JSON.stringify(out ?? null).slice(0, 1200));
}

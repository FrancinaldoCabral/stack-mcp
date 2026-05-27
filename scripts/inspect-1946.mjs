import 'dotenv/config';
import axios from 'axios';
const h = { 'X-N8N-API-KEY': process.env.N8N_API_KEY };
const det = (await axios.get('https://workflows.vendly.chat/api/v1/executions/1946?includeData=true', { headers: h })).data;
const rd = det.data?.resultData?.runData ?? {};
const cp = rd['Construir Prompt']?.[0]?.data?.main?.[0]?.[0]?.json;
const sys = cp?.messages?.[0];
console.log('System prompt (1946):');
console.log(typeof sys?.content === 'string' ? sys.content : JSON.stringify(sys));
console.log('\n\nÚltima msg user:');
console.log(JSON.stringify(cp?.messages?.[cp.messages.length - 1]).slice(0, 500));

const biz = rd['MongoDB GET Business']?.[0]?.data?.main?.[0]?.[0]?.json;
console.log('\n\nBusiness doc:');
console.log(JSON.stringify(biz).slice(0, 600));

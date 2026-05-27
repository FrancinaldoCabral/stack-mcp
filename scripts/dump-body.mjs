import 'dotenv/config';
import axios from 'axios';
const h = { 'X-N8N-API-KEY': process.env.N8N_API_KEY };
const det = (await axios.get('https://workflows.vendly.chat/api/v1/executions/1882?includeData=true', { headers: h })).data;
const wh = det.data?.resultData?.runData?.['Webhook Auto-Open']?.[0]?.data?.main?.[0]?.[0]?.json;
console.log(JSON.stringify(wh.body, null, 2).slice(0, 4000));

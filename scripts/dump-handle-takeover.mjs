import dotenv from 'dotenv';
dotenv.config();
const N8N = process.env.N8N_URL;
const H = { 'X-N8N-API-KEY': process.env.N8N_API_KEY, 'Accept': 'application/json, text/event-stream' };

const wfAutoOpen = await fetch(`${N8N}/api/v1/workflows/Jijw4Dqil3QVYSp8`, { headers: H }).then(r => r.json());
const ht = wfAutoOpen.nodes.find(n => n.name === 'Handle Takeover Humano');
console.log('=== Handle Takeover Humano (COMPLETO) ===');
console.log(ht?.parameters?.jsCode);

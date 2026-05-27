import 'dotenv/config';
import axios from 'axios';
const h = { 'X-N8N-API-KEY': process.env.N8N_API_KEY };
const N8N = 'https://workflows.vendly.chat/api/v1';

// First inspect entrada workflow structure
const wf = (await axios.get(`${N8N}/workflows/bEb19TdWZfFloisU`, { headers: h })).data;
console.log('Nodes:', wf.nodes.map(n => n.name).join(' | '));

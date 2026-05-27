import 'dotenv/config';
import axios from 'axios';
const h = { 'X-N8N-API-KEY': process.env.N8N_API_KEY };
const wf = (await axios.get('https://workflows.vendly.chat/api/v1/workflows/jleu4RPvSnYDL8Gd', { headers: h })).data;
console.log('Loop Chunks outputs:');
const lc = wf.connections['Loop Chunks'];
console.log(JSON.stringify(lc, null, 2));
console.log('\nParsear Chunks outputs:');
console.log(JSON.stringify(wf.connections['Parsear Chunks'], null, 2));

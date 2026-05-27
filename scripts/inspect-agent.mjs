import 'dotenv/config';
import axios from 'axios';
const h = { 'X-N8N-API-KEY': process.env.N8N_API_KEY };
const wf = (await axios.get('https://workflows.vendly.chat/api/v1/workflows/jleu4RPvSnYDL8Gd', { headers: h })).data;
for (const n of wf.nodes) {
  if (/prompt|sistema|system|handoff|takeover|humano|detect/i.test(n.name)) {
    console.log(`\n--- ${n.name} (${n.type}) ---`);
    const p = JSON.stringify(n.parameters, null, 2);
    console.log(p.slice(0, 3500));
  }
}

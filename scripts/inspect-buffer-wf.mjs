import 'dotenv/config';
import axios from 'axios';
const h = { 'X-N8N-API-KEY': process.env.N8N_API_KEY };
const r = await axios.get('https://workflows.vendly.chat/api/v1/workflows/FacKqM3e2LsHE6NY', { headers: h });
const wf = r.data;
for (const n of wf.nodes) {
  if (/parse|consolidar|pop|gerar/i.test(n.name)) {
    console.log(`\n--- ${n.name} (${n.type}) ---`);
    console.log(JSON.stringify(n.parameters, null, 2));
  }
}

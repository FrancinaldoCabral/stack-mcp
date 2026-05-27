import 'dotenv/config';
import axios from 'axios';
const h = { 'X-N8N-API-KEY': process.env.N8N_API_KEY };
const det = (await axios.get('https://workflows.vendly.chat/api/v1/executions/1856?includeData=true', { headers: h })).data;
const rd = det.data?.resultData?.runData ?? {};
console.log('Nós executados:', Object.keys(rd));
for (const k of ['Parsear Chunks', 'IF Responder com Audio?', 'Chatwoot Enviar', 'Chatwoot Enviar Audio', 'Evolution Send', 'Loop Chunks', 'Escalada Humano', 'Redis SET Takeover Escalada']) {
  const node = rd[k];
  if (!node) { console.log(`  ${k}: NOT RUN`); continue; }
  console.log(`  ${k}: ${node.length} run(s)`);
  for (let i = 0; i < node.length; i++) {
    const outs = node[i].data?.main ?? [];
    outs.forEach((o, j) => console.log(`    run[${i}] out[${j}] items=${o?.length}`));
  }
}
const err = det.data?.resultData?.error;
if (err) console.log('\nERRO:', err.message, '@', err.node?.name);

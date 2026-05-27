import 'dotenv/config';
import axios from 'axios';
const h = { 'X-N8N-API-KEY': process.env.N8N_API_KEY };
const wf = (await axios.get('https://workflows.vendly.chat/api/v1/workflows/jleu4RPvSnYDL8Gd', { headers: h })).data;

// Show connections from/to Escalada nodes
const target = ['Escalada Humano', 'Parsear Chunks', 'Loop Chunks', 'Redis SET Takeover Escalada'];
console.log('=== Connections involving escalation ===');
for (const [src, conns] of Object.entries(wf.connections)) {
  for (const portArr of Object.values(conns)) {
    for (const port of portArr) {
      for (const c of port) {
        if (target.includes(src) || target.includes(c.node)) {
          console.log(`  ${src} --> ${c.node} (${c.type}, idx=${c.index})`);
        }
      }
    }
  }
}

// Also check Loop Chunks (SplitInBatches) parameters
const loop = wf.nodes.find(n => n.name === 'Loop Chunks');
console.log('\n=== Loop Chunks ===');
console.log(JSON.stringify(loop?.parameters ?? loop, null, 2).slice(0, 500));

// Parsear chunks parameters
const parse = wf.nodes.find(n => n.name === 'Parsear Chunks');
console.log('\n=== Parsear Chunks ===');
console.log(JSON.stringify(parse?.parameters?.jsCode ?? parse, null, 2).slice(0, 2000));

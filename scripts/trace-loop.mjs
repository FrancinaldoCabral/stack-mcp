import 'dotenv/config';
import axios from 'axios';
const h = { 'X-N8N-API-KEY': process.env.N8N_API_KEY };
const wf = (await axios.get('https://workflows.vendly.chat/api/v1/workflows/jleu4RPvSnYDL8Gd', { headers: h })).data;

console.log('=== Quem conecta para Loop Chunks ===');
for (const [src, conns] of Object.entries(wf.connections)) {
  const outs = conns.main ?? [];
  outs.forEach((portConns, outIdx) => {
    for (const c of portConns ?? []) {
      if (c.node === 'Loop Chunks') {
        console.log(`  ${src} (output ${outIdx}) → Loop Chunks (input ${c.index})`);
      }
    }
  });
}

console.log('\n=== Cadeia após Loop Chunks output 0 (loop) ===');
function chain(node, depth=0, visited=new Set()) {
  if (visited.has(node) || depth > 10) return;
  visited.add(node);
  const conns = wf.connections[node]?.main ?? [];
  conns.forEach((portConns, outIdx) => {
    for (const c of portConns ?? []) {
      console.log('  '.repeat(depth) + `${node}[${outIdx}] → ${c.node}[${c.index}]`);
      chain(c.node, depth + 1, visited);
    }
  });
}
chain('Loop Chunks');

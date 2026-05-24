import 'dotenv/config';

const H = { 'X-N8N-API-KEY': process.env.N8N_API_KEY, 'Accept': 'application/json' };
const wf = await fetch('https://workflows.vendly.chat/api/v1/workflows/jleu4RPvSnYDL8Gd', { headers: H }).then(r => r.json());
const cp = wf.nodes.find(n => n.name === 'Construir Prompt');
const code = cp.parameters.jsCode;
const idx = code.indexOf("} else if (msg.tipo === 'audio')");
console.log('--- AUDIO BLOCK ---');
console.log(JSON.stringify(code.slice(idx, idx + 700)));

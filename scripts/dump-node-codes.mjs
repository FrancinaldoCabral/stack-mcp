import dotenv from 'dotenv';
dotenv.config();
const N8N = process.env.N8N_URL;
const H = { 'X-N8N-API-KEY': process.env.N8N_API_KEY, 'Accept': 'application/json, text/event-stream' };

const [wfAutoOpen, wfExecutor] = await Promise.all([
  fetch(`${N8N}/api/v1/workflows/Jijw4Dqil3QVYSp8`, { headers: H }).then(r => r.json()),
  fetch(`${N8N}/api/v1/workflows/jleu4RPvSnYDL8Gd`, { headers: H }).then(r => r.json()),
]);

const abrir = wfAutoOpen.nodes.find(n => n.name === 'Abrir Conversa');
const escalada = wfExecutor.nodes.find(n => n.name === 'Escalada Humano');

console.log('=== Abrir Conversa (COMPLETO) ===');
console.log(abrir?.parameters?.jsCode);

console.log('\n=== Escalada Humano (COMPLETO) ===');
console.log(escalada?.parameters?.jsCode);

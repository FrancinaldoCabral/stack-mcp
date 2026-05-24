import { config } from 'dotenv';
config();

const N8N_KEY = process.env.N8N_API_KEY;
const headers = { 'X-N8N-API-KEY': N8N_KEY, 'Accept': 'application/json', 'Content-Type': 'application/json' };

const r = await fetch('https://workflows.vendly.chat/api/v1/workflows/jleu4RPvSnYDL8Gd', { headers });
const w = await r.json();

// Print Parsear Chunks full code
const parsear = w.nodes.find(n => n.name === 'Parsear Chunks');
const construir = w.nodes.find(n => n.name === 'Construir Prompt');
const prepTrans = w.nodes.find(n => n.name === 'Prep Transcrição');

console.log('=== Parsear Chunks (audio mode) ===');
const pCode = parsear?.parameters?.jsCode ?? '';
const audioIdx = pCode.indexOf('if (respondWithAudio)');
console.log(pCode.slice(audioIdx, audioIdx + 800));

console.log('\n=== Construir Prompt (audio block) ===');
const cCode = construir?.parameters?.jsCode ?? '';
const audioIdx2 = cCode.indexOf("tipo === 'audio'");
console.log(cCode.slice(audioIdx2, audioIdx2 + 500));

console.log('\n=== Prep Transcrição (full) ===');
console.log(prepTrans?.parameters?.jsCode ?? '');

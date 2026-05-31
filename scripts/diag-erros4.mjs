import fs from 'node:fs';
const env = Object.fromEntries(fs.readFileSync('.env','utf8').split(/\r?\n/).filter(l=>l&&!l.startsWith('#')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i),l.slice(i+1)]}));
const N8N=env.N8N_URL, KEY=env.N8N_API_KEY;
const H={'X-N8N-API-KEY':KEY,'Accept':'application/json'};

const wf = await fetch(`${N8N}/api/v1/workflows/jleu4RPvSnYDL8Gd`,{headers:H}).then(r=>r.json());

// Ver Preparar Envio
const pe = wf.nodes.find(n=>n.name==='Preparar Envio');
console.log('=== Preparar Envio code ===');
console.log(pe?.parameters?.jsCode || pe?.type || JSON.stringify(pe?.parameters).slice(0,300));

// Ver Construir Prompt: linha openRouterBody completa
const cp = wf.nodes.find(n=>n.name==='Construir Prompt');
console.log('\n=== Construir Prompt: L129-135 ===');
const cpLines = cp.parameters.jsCode.split('\n');
cpLines.slice(128, 136).forEach((l,i)=>console.log(`  L${i+129}: ${l}`));

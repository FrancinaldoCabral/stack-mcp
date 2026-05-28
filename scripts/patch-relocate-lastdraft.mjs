// Move MongoDB GET Last Draft para antes de "IF Audio Input?" (em série, pega ambos ramos)
import fs from 'node:fs';
const env = Object.fromEntries(fs.readFileSync('.env','utf8').split('\n').filter(l=>l.includes('=')).map(l=>{const i=l.indexOf('=');return [l.slice(0,i).trim(), l.slice(i+1).trim()];}));
const N8N = env.N8N_URL.replace(/\/$/,'');
const KEY = env.N8N_API_KEY;
const WF = 'jleu4RPvSnYDL8Gd';
const H = { 'X-N8N-API-KEY': KEY, 'Accept': 'application/json', 'Content-Type': 'application/json' };

const wf = await (await fetch(`${N8N}/api/v1/workflows/${WF}`, { headers: H })).json();
const conns = wf.connections;

const NAME = 'MongoDB GET Last Draft';
const TARGET_NEXT = 'IF Audio Input?';

// 1) Reverter: desconectar Last Draft → Construir Prompt (vamos plugá-lo antes de IF Audio)
if (conns[NAME]) delete conns[NAME];

// 2) Reconectar predecessor que apontava para Last Draft (Transcrever Áudio) de volta ao Construir Prompt
for (const [src, info] of Object.entries(conns)) {
  for (const arr of info.main || []) {
    for (let i=arr.length-1; i>=0; i--) {
      if (arr[i].node === NAME) {
        arr.splice(i,1);
        arr.push({ node: 'Construir Prompt', type: 'main', index: 0 });
      }
    }
  }
}

// 3) Encontrar quem alimenta IF Audio Input?
let predOfIf = null;
for (const [src, info] of Object.entries(conns)) {
  for (const arr of info.main || []) {
    for (const c of (arr || [])) {
      if (c.node === TARGET_NEXT) predOfIf = src;
    }
  }
}
console.log('pred of', TARGET_NEXT, '=', predOfIf);

if (predOfIf) {
  // Reescrever: predOfIf → Last Draft → IF Audio Input?
  const mains = conns[predOfIf].main;
  for (const arr of mains) {
    for (let i=arr.length-1; i>=0; i--) if (arr[i].node === TARGET_NEXT) arr.splice(i,1);
    arr.push({ node: NAME, type: 'main', index: 0 });
  }
  conns[NAME] = { main: [[{ node: TARGET_NEXT, type: 'main', index: 0 }]] };
  console.log('rewired:', predOfIf, '->', NAME, '->', TARGET_NEXT);
}

const allowedSettings = ['executionOrder','saveManualExecutions','saveExecutionProgress','saveDataErrorExecution','saveDataSuccessExecution','timezone','executionTimeout','errorWorkflow','callerPolicy'];
const settings = {};
for (const k of allowedSettings) if (wf.settings && wf.settings[k] !== undefined) settings[k] = wf.settings[k];
if (!settings.executionOrder) settings.executionOrder = 'v1';
const body = { name: wf.name, nodes: wf.nodes, connections: conns, settings };
const res = await fetch(`${N8N}/api/v1/workflows/${WF}`, { method: 'PUT', headers: H, body: JSON.stringify(body) });
console.log('PUT', res.status);
if (res.status !== 200) console.log(await res.text());

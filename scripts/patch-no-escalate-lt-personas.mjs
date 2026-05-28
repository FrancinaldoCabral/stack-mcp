// Remove escalaSystemNote para personas LT (restaurant/deliverer) — grupos não escalam humano
import fs from 'node:fs';
const env = Object.fromEntries(fs.readFileSync('.env','utf8').split('\n').filter(l=>l.includes('=')).map(l=>{const i=l.indexOf('=');return [l.slice(0,i).trim(), l.slice(i+1).trim()];}));
const N8N = env.N8N_URL.replace(/\/$/,'');
const KEY = env.N8N_API_KEY;
const WF = 'jleu4RPvSnYDL8Gd';
const H = { 'X-N8N-API-KEY': KEY, 'Accept': 'application/json', 'Content-Type': 'application/json' };

const wf = await (await fetch(`${N8N}/api/v1/workflows/${WF}`, { headers: H })).json();
const n = wf.nodes.find(x => x.name === 'Construir Prompt');

const before = n.parameters.jsCode;
const oldLine = 'const sistemaPrompt = (customSystemPrompt || defaultPrompt) + __ctxBlock + customerCtx + intelligenceCtx + audioSystemNote + escalaSystemNote;';
const newLine = 'const __isLtGroup = (personaKey === "restaurant" || personaKey === "deliverer");\nconst sistemaPrompt = (customSystemPrompt || defaultPrompt) + __ctxBlock + customerCtx + intelligenceCtx + audioSystemNote + (__isLtGroup ? "" : escalaSystemNote);';

if (!before.includes(oldLine)) {
  console.error('MARCADOR não encontrado. Abortando.');
  process.exit(1);
}
n.parameters.jsCode = before.replace(oldLine, newLine);

const allowed = ['executionOrder','saveManualExecutions','saveExecutionProgress','saveDataErrorExecution','saveDataSuccessExecution','timezone','executionTimeout','errorWorkflow','callerPolicy'];
const settings = {};
for (const k of allowed) if (wf.settings && wf.settings[k] !== undefined) settings[k] = wf.settings[k];
if (!settings.executionOrder) settings.executionOrder = 'v1';
const body = { name: wf.name, nodes: wf.nodes, connections: wf.connections, settings };
const res = await fetch(`${N8N}/api/v1/workflows/${WF}`, { method: 'PUT', headers: H, body: JSON.stringify(body) });
console.log('PUT', res.status);

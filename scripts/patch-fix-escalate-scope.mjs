// Fix scope: usar __deliveryCtx.personaKey (não personaKey solto)
import fs from 'node:fs';
const env = Object.fromEntries(fs.readFileSync('.env','utf8').split('\n').filter(l=>l.includes('=')).map(l=>{const i=l.indexOf('=');return [l.slice(0,i).trim(), l.slice(i+1).trim()];}));
const N8N = env.N8N_URL.replace(/\/$/,'');
const H = { 'X-N8N-API-KEY': env.N8N_API_KEY, 'Accept': 'application/json', 'Content-Type': 'application/json' };
const wf = await (await fetch(`${N8N}/api/v1/workflows/jleu4RPvSnYDL8Gd`, { headers: H })).json();
const n = wf.nodes.find(x => x.name === 'Construir Prompt');

const old = 'const __isLtGroup = (personaKey === "restaurant" || personaKey === "deliverer");';
const fix = 'const __isLtGroup = (__deliveryCtx && (__deliveryCtx.personaKey === "restaurant" || __deliveryCtx.personaKey === "deliverer"));';
if (!n.parameters.jsCode.includes(old)) { console.error('marcador nao achado'); process.exit(1); }
n.parameters.jsCode = n.parameters.jsCode.replace(old, fix);

const allowed = ['executionOrder','saveManualExecutions','saveExecutionProgress','saveDataErrorExecution','saveDataSuccessExecution','timezone','executionTimeout','errorWorkflow','callerPolicy'];
const settings = {};
for (const k of allowed) if (wf.settings && wf.settings[k] !== undefined) settings[k] = wf.settings[k];
if (!settings.executionOrder) settings.executionOrder = 'v1';
const res = await fetch(`${N8N}/api/v1/workflows/jleu4RPvSnYDL8Gd`, { method: 'PUT', headers: H, body: JSON.stringify({ name: wf.name, nodes: wf.nodes, connections: wf.connections, settings }) });
console.log('PUT', res.status);

// Patch Construir Prompt: tool_choice específico por função quando heurística + lastDraft
import fs from 'node:fs';
const env = Object.fromEntries(fs.readFileSync('.env','utf8').split('\n').filter(l=>l.includes('=')).map(l=>{const i=l.indexOf('=');return [l.slice(0,i).trim(), l.slice(i+1).trim()];}));
const N8N = env.N8N_URL.replace(/\/$/,'');
const KEY = env.N8N_API_KEY;
const WF = 'jleu4RPvSnYDL8Gd';
const H = { 'X-N8N-API-KEY': KEY, 'Accept': 'application/json', 'Content-Type': 'application/json' };

const wf = await (await fetch(`${N8N}/api/v1/workflows/${WF}`, { headers: H })).json();
const n = wf.nodes.find(x => x.name === 'Construir Prompt');
let code = n.parameters.jsCode;

const oldBlock = `const __lastUserText = (typeof userContent === 'string' ? userContent : (Array.isArray(userContent) ? (userContent.find(c=>c.type==='text')?.text||'') : '')).toLowerCase();
const __looksLikeOrder = /(novo pedido|pedido novo|pedido:|preciso|cliente)/.test(__lastUserText) && /(r\\$|rua|av\\.|av\\s|fone|tel|telefone|\\d{8,})/.test(__lastUserText);
const __looksLikeConfirm = /^(ok|manda|confirma|confirmar|pode mandar|pode enviar|enviar|fechou|beleza)\\b/.test(__lastUserText.trim());
const __forceTool = (__extraTools.length > 0) && (__looksLikeOrder || __looksLikeConfirm);
const __toolChoice = __forceTool ? 'required' : 'auto';
const __openRouterBody = JSON.stringify({ model: __model, messages, temperature: 0.8, tools: [...__baseTools, ...__extraTools], tool_choice: __toolChoice });`;

const newBlock = `const __lastUserText = (typeof userContent === 'string' ? userContent : (Array.isArray(userContent) ? (userContent.find(c=>c.type==='text')?.text||'') : '')).toLowerCase();
const __looksLikeOrder = /(novo pedido|pedido novo|pedido:|preciso|cliente)/.test(__lastUserText) && /(r\\$|rua|av\\.|av\\s|fone|tel|telefone|\\d{8,})/.test(__lastUserText);
const __looksLikeConfirm = /^\\s*(ok|manda|confirma|confirmar|pode mandar|pode enviar|enviar|fechou|beleza|tá|ta|isso)\\b/.test(__lastUserText.trim());
const __toolNames = new Set([...__baseTools, ...__extraTools].map(t => t.function.name));
let __toolChoice = 'auto';
if (__extraTools.length > 0) {
  if (__looksLikeConfirm && __lastDraft && __toolNames.has('delivery_confirm_order')) {
    __toolChoice = { type: 'function', function: { name: 'delivery_confirm_order' } };
  } else if (__looksLikeOrder && __toolNames.has('delivery_draft_order')) {
    __toolChoice = { type: 'function', function: { name: 'delivery_draft_order' } };
  } else if (__looksLikeOrder || __looksLikeConfirm) {
    __toolChoice = 'required';
  }
}
const __openRouterBody = JSON.stringify({ model: __model, messages, temperature: 0.8, tools: [...__baseTools, ...__extraTools], tool_choice: __toolChoice });`;

if (!code.includes(oldBlock)) throw new Error('block not found');
code = code.replace(oldBlock, newBlock);

n.parameters.jsCode = code;

const allowedSettings = ['executionOrder','saveManualExecutions','saveExecutionProgress','saveDataErrorExecution','saveDataSuccessExecution','timezone','executionTimeout','errorWorkflow','callerPolicy'];
const settings = {};
for (const k of allowedSettings) if (wf.settings && wf.settings[k] !== undefined) settings[k] = wf.settings[k];
if (!settings.executionOrder) settings.executionOrder = 'v1';

const body = { name: wf.name, nodes: wf.nodes, connections: wf.connections, settings };
const res = await fetch(`${N8N}/api/v1/workflows/${WF}`, { method: 'PUT', headers: H, body: JSON.stringify(body) });
console.log('PUT', res.status);

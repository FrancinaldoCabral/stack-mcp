// Patch Construir Prompt: injetar último rascunho (orderId/orderRef) no contexto operacional
import fs from 'node:fs';
const env = Object.fromEntries(fs.readFileSync('.env','utf8').split('\n').filter(l=>l.includes('=')).map(l=>{const i=l.indexOf('=');return [l.slice(0,i).trim(), l.slice(i+1).trim()];}));
const N8N = env.N8N_URL.replace(/\/$/,'');
const KEY = env.N8N_API_KEY;
const WF = 'jleu4RPvSnYDL8Gd';
const H = { 'X-N8N-API-KEY': KEY, 'Accept': 'application/json', 'Content-Type': 'application/json' };

const wf = await (await fetch(`${N8N}/api/v1/workflows/${WF}`, { headers: H })).json();
const n = wf.nodes.find(x => x.name === 'Construir Prompt');
let code = n.parameters.jsCode;

// Adiciona lookup do último rascunho ANTES do __ctxBlock (substituindo a linha original)
const oldCtx = `/* delivery-ctx-injected */
const __deliveryCtx = (typeof $ === 'function' ? $('Resolver Persona').first()?.json : null) || {};
const __ctxBlock = __deliveryCtx.restaurantId ? \`\\n\\n## Contexto Operacional\\n- restaurantId: \${__deliveryCtx.restaurantId}\\n- personaKey: \${__deliveryCtx.personaKey || ''}\\n- Use este restaurantId em TODAS as chamadas de ferramenta delivery_*.\` : '';`;

const newCtx = `/* delivery-ctx-injected */
const __deliveryCtx = (typeof $ === 'function' ? $('Resolver Persona').first()?.json : null) || {};
/* delivery-last-draft-lookup */
let __lastDraft = null;
if (__deliveryCtx.restaurantId) {
  try {
    const __mcpUrl = 'https://app.vendly.chat/mcp';
    const __r = await fetch(__mcpUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
      body: JSON.stringify({ jsonrpc: '2.0', id: Date.now(), method: 'tools/call', params: { name: 'delivery_list_orders', arguments: { restaurantId: __deliveryCtx.restaurantId, status: 'rascunho', limit: 1 } } }),
    });
    const __txt = await __r.text();
    const __dline = __txt.split('\\n').reverse().find(l => l.startsWith('data:'));
    if (__dline) {
      const __j = JSON.parse(__dline.slice(5).trim());
      const __content = __j?.result?.content?.[0]?.text;
      if (__content) {
        const __parsed = JSON.parse(__content);
        const __o = (__parsed.orders || __parsed.items || (Array.isArray(__parsed) ? __parsed : []))[0];
        if (__o && (__o._id || __o.id)) {
          __lastDraft = { orderId: __o._id || __o.id, orderRef: __o.orderRef || __o.ref || '', summary: __o };
        }
      }
    }
  } catch (e) {}
}
const __draftLine = __lastDraft ? \`\\n- ÚLTIMO RASCUNHO (use este orderId em delivery_confirm_order / delivery_update_draft): orderId=\${__lastDraft.orderId}, orderRef=\${__lastDraft.orderRef}\` : '';
const __ctxBlock = __deliveryCtx.restaurantId ? \`\\n\\n## Contexto Operacional\\n- restaurantId: \${__deliveryCtx.restaurantId}\\n- personaKey: \${__deliveryCtx.personaKey || ''}\\n- Use este restaurantId em TODAS as chamadas de ferramenta delivery_*.\${__draftLine}\` : '';`;

if (!code.includes(oldCtx)) throw new Error('ctx block not found');
code = code.replace(oldCtx, newCtx);

n.parameters.jsCode = code;

const allowedSettings = ['executionOrder','saveManualExecutions','saveExecutionProgress','saveDataErrorExecution','saveDataSuccessExecution','timezone','executionTimeout','errorWorkflow','callerPolicy'];
const settings = {};
for (const k of allowedSettings) if (wf.settings && wf.settings[k] !== undefined) settings[k] = wf.settings[k];
if (!settings.executionOrder) settings.executionOrder = 'v1';

const body = { name: wf.name, nodes: wf.nodes, connections: wf.connections, settings };
const res = await fetch(`${N8N}/api/v1/workflows/${WF}`, { method: 'PUT', headers: H, body: JSON.stringify(body) });
console.log('PUT', res.status);

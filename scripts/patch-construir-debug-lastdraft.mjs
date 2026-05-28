// Expõe debug do lookup lastDraft no output do Construir Prompt
import fs from 'node:fs';
const env = Object.fromEntries(fs.readFileSync('.env','utf8').split('\n').filter(l=>l.includes('=')).map(l=>{const i=l.indexOf('=');return [l.slice(0,i).trim(), l.slice(i+1).trim()];}));
const N8N = env.N8N_URL.replace(/\/$/,'');
const KEY = env.N8N_API_KEY;
const WF = 'jleu4RPvSnYDL8Gd';
const H = { 'X-N8N-API-KEY': KEY, 'Accept': 'application/json', 'Content-Type': 'application/json' };

const wf = await (await fetch(`${N8N}/api/v1/workflows/${WF}`, { headers: H })).json();
const n = wf.nodes.find(x => x.name === 'Construir Prompt');
let code = n.parameters.jsCode;

// Adicionar capture do erro
const oldTry = `  } catch (e) {}
}
const __draftLine`;
const newTry = `  } catch (e) { __lastDraftErr = String(e && e.message || e); }
}
const __draftLine`;
if (!code.includes(oldTry)) throw new Error('try block not found');

const oldDecl = `let __lastDraft = null;`;
const newDecl = `let __lastDraft = null;\nlet __lastDraftErr = null;\nlet __lastDraftHttp = null;`;
code = code.replace(oldDecl, newDecl);

// Captura status http
const oldFetch = `const __r = await fetch(__mcpUrl, {`;
const newFetch = `const __r = await fetch(__mcpUrl, {`;
// substituir após await response, log status:
code = code.replace(`const __txt = await __r.text();`, `__lastDraftHttp = __r.status; const __txt = await __r.text();`);

code = code.replace(oldTry, newTry);

// expor no return
const oldReturn = `return [{ json: { ...msg, messages, historico, respondWithAudio, toolsAllowed: __deliveryCtx.toolsAllowed || [], restaurantId: __deliveryCtx.restaurantId || null, openRouterBody: __openRouterBody, model: __model } }];`;
const newReturn = `return [{ json: { ...msg, messages, historico, respondWithAudio, toolsAllowed: __deliveryCtx.toolsAllowed || [], restaurantId: __deliveryCtx.restaurantId || null, openRouterBody: __openRouterBody, model: __model, _lastDraft: __lastDraft, _lastDraftErr: __lastDraftErr, _lastDraftHttp: __lastDraftHttp } }];`;
code = code.replace(oldReturn, newReturn);

n.parameters.jsCode = code;

const allowedSettings = ['executionOrder','saveManualExecutions','saveExecutionProgress','saveDataErrorExecution','saveDataSuccessExecution','timezone','executionTimeout','errorWorkflow','callerPolicy'];
const settings = {};
for (const k of allowedSettings) if (wf.settings && wf.settings[k] !== undefined) settings[k] = wf.settings[k];
if (!settings.executionOrder) settings.executionOrder = 'v1';
const body = { name: wf.name, nodes: wf.nodes, connections: wf.connections, settings };
const res = await fetch(`${N8N}/api/v1/workflows/${WF}`, { method: 'PUT', headers: H, body: JSON.stringify(body) });
console.log('PUT', res.status);

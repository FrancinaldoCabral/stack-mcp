// Adiciona nó "MongoDB GET Last Draft" entre Resolver Persona e Construir Prompt
// e ajusta Construir Prompt para ler dele em vez do fetch fake.
import fs from 'node:fs';
const env = Object.fromEntries(fs.readFileSync('.env','utf8').split('\n').filter(l=>l.includes('=')).map(l=>{const i=l.indexOf('=');return [l.slice(0,i).trim(), l.slice(i+1).trim()];}));
const N8N = env.N8N_URL.replace(/\/$/,'');
const KEY = env.N8N_API_KEY;
const WF = 'jleu4RPvSnYDL8Gd';
const H = { 'X-N8N-API-KEY': KEY, 'Accept': 'application/json', 'Content-Type': 'application/json' };

const wf = await (await fetch(`${N8N}/api/v1/workflows/${WF}`, { headers: H })).json();

const NAME = 'MongoDB GET Last Draft';
let node = wf.nodes.find(x => x.name === NAME);
if (!node) {
  node = {
    parameters: {
      operation: 'find',
      collection: 'orders',
      options: { limit: 1, sort: '={{ JSON.stringify({ createdAt: -1 }) }}' },
      query: "={{ JSON.stringify({ restaurantId: $('Resolver Persona').first().json.restaurantId, status: 'rascunho' }) }}",
    },
    id: 'mongo-get-last-draft',
    name: NAME,
    type: 'n8n-nodes-base.mongoDb',
    typeVersion: 1,
    position: [-528, 408],
    alwaysOutputData: true,
    credentials: { mongoDb: { id: 'sv8EpRFYk3nNbQ4G', name: 'MongoDB Vendly' } },
  };
  wf.nodes.push(node);
  console.log('node added');
} else {
  console.log('node already exists; updating params');
  node.parameters = {
    operation: 'find',
    collection: 'orders',
    options: { limit: 1, sort: '={{ JSON.stringify({ createdAt: -1 }) }}' },
    query: "={{ JSON.stringify({ restaurantId: $('Resolver Persona').first().json.restaurantId, status: 'rascunho' }) }}",
  };
  node.alwaysOutputData = true;
  if (!node.credentials?.mongoDb) node.credentials = { mongoDb: { id: 'sv8EpRFYk3nNbQ4G', name: 'MongoDB Vendly' } };
}

// Plug em paralelo: Resolver Persona já alimenta vários nós; vou conectar Resolver Persona -> Last Draft -> Construir Prompt.
// Mas pode quebrar o fluxo paralelo. Estratégia menos invasiva: conectar Mesclar Histórico -> Last Draft -> Construir Prompt
// Atual: ... -> Construir Prompt (entradas múltiplas via $())
// Vou ligar Mesclar Historico -> Last Draft -> Construir Prompt (inseridndo entre)
const conns = wf.connections;

// Encontra origem que aponta para Construir Prompt
let predName = null;
for (const [src, info] of Object.entries(conns)) {
  const mains = info.main || [];
  for (const arr of mains) {
    for (const c of (arr || [])) {
      if (c.node === 'Construir Prompt') predName = src;
    }
  }
}
console.log('pred of Construir Prompt:', predName);

if (predName && predName !== NAME) {
  // remover ligação predName -> Construir Prompt e adicionar predName -> Last Draft -> Construir Prompt
  const mains = conns[predName].main;
  for (const arr of mains) {
    for (let i=arr.length-1; i>=0; i--) if (arr[i].node === 'Construir Prompt') arr.splice(i,1);
    arr.push({ node: NAME, type: 'main', index: 0 });
  }
  conns[NAME] = { main: [[{ node: 'Construir Prompt', type: 'main', index: 0 }]] };
  console.log('rewired:', predName, '->', NAME, '->', 'Construir Prompt');
}

// Patch Construir Prompt: substituir o bloco do fetch pelo lookup local
const cp = wf.nodes.find(x => x.name === 'Construir Prompt');
let code = cp.parameters.jsCode;

// Remover bloco antigo do fetch
const oldFetchBlock = /\/\* delivery-last-draft-lookup \*\/[\s\S]*?const __draftLine = __lastDraft \? `\\n- ÚLTIMO RASCUNHO[^`]*` : '';/;
const newLookupBlock = `/* delivery-last-draft-lookup (mongo node) */
let __lastDraft = null;
try {
  const __doc = (typeof $ === 'function' ? $('MongoDB GET Last Draft').first()?.json : null) || null;
  if (__doc && (__doc._id || __doc.id)) {
    __lastDraft = { orderId: __doc._id || __doc.id, orderRef: __doc.orderRef || __doc.ref || '', summary: __doc };
  }
} catch(e) {}
const __draftLine = __lastDraft ? \`\\n- ÚLTIMO RASCUNHO (use este orderId em delivery_confirm_order / delivery_update_draft): orderId=\${__lastDraft.orderId}, orderRef=\${__lastDraft.orderRef}\` : '';`;

if (!oldFetchBlock.test(code)) {
  console.warn('old fetch block not found; checking for already-replaced pattern');
}
code = code.replace(oldFetchBlock, newLookupBlock);

// Remover declarações de debug duplicadas (__lastDraft / __lastDraftErr / __lastDraftHttp)
code = code.replace(/\nlet __lastDraft = null;\nlet __lastDraftErr = null;\nlet __lastDraftHttp = null;\n/, '\n');

// Limpar retorno debug
code = code.replace(', _lastDraft: __lastDraft, _lastDraftErr: __lastDraftErr, _lastDraftHttp: __lastDraftHttp', '');

cp.parameters.jsCode = code;

const allowedSettings = ['executionOrder','saveManualExecutions','saveExecutionProgress','saveDataErrorExecution','saveDataSuccessExecution','timezone','executionTimeout','errorWorkflow','callerPolicy'];
const settings = {};
for (const k of allowedSettings) if (wf.settings && wf.settings[k] !== undefined) settings[k] = wf.settings[k];
if (!settings.executionOrder) settings.executionOrder = 'v1';

const body = { name: wf.name, nodes: wf.nodes, connections: wf.connections, settings };
const res = await fetch(`${N8N}/api/v1/workflows/${WF}`, { method: 'PUT', headers: H, body: JSON.stringify(body) });
console.log('PUT', res.status);
if (res.status !== 200) console.log(await res.text());

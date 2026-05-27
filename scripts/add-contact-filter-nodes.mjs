// Adiciona 2 nós ao workflow [CORE] Entrada de Mensagem:
//  - "Redis GET Contact Filter" (operation: get) — lê contact_filter:{instance}
//  - "Aplicar Filtro Contatos" (Code) — bloqueia ou permite a mensagem
// Re-wire: Normalizar Mensagem → Redis GET Contact Filter → Aplicar Filtro Contatos → Redis GET human_takeover
//
// Idempotente: se os nós já existem, não duplica.
//
// Uso: node scripts/add-contact-filter-nodes.mjs

import fs from 'node:fs';
import path from 'node:path';

const root = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1'));
const envPath = path.resolve(root, '..', '.env');
let env = {};
try {
  const envText = fs.readFileSync(envPath, 'utf8');
  env = Object.fromEntries(envText.split(/\r?\n/).filter(l => l && /^[A-Z_]+=/.test(l)).map(l => {
    const i = l.indexOf('='); return [l.slice(0, i), l.slice(i + 1).trim()];
  }));
} catch (e) { console.warn('.env não lido:', e.message); }

const N8N_URL = process.env.N8N_URL || env.N8N_URL || 'https://workflows.vendly.chat';
const N8N_API_KEY = process.env.N8N_API_KEY || env.N8N_API_KEY;
const WF_ID = 'bEb19TdWZfFloisU';
const REDIS_CRED_ID = 'zkKpThv7TlkK3IoB';
const REDIS_CRED_NAME = 'Redis Vendly';

const NODE_GET = 'Redis GET Contact Filter';
const NODE_APPLY = 'Aplicar Filtro Contatos';

if (!N8N_API_KEY) { console.error('N8N_API_KEY ausente'); process.exit(1); }

async function api(method, url, body) {
  const r = await fetch(`${N8N_URL}${url}`, {
    method,
    headers: {
      'X-N8N-API-KEY': N8N_API_KEY,
      'Accept': 'application/json, text/event-stream',
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`${method} ${url} → ${r.status}: ${text}`);
  return text ? JSON.parse(text) : {};
}

const wf = await api('GET', `/api/v1/workflows/${WF_ID}`);
console.log('Workflow:', wf.name);

const existingNames = new Set(wf.nodes.map(n => n.name));
const alreadyHas = existingNames.has(NODE_GET) && existingNames.has(NODE_APPLY);
if (alreadyHas) {
  console.log('Nós já existem — apenas garantindo conexões corretas.');
}

// Definir nós (idempotente)
const redisGetNode = {
  parameters: {
    operation: 'get',
    key: '={{ "contact_filter:" + $json.instance }}',
    propertyName: 'filter_raw',
    options: {},
  },
  id: 'redis-get-contact-filter',
  name: NODE_GET,
  type: 'n8n-nodes-base.redis',
  typeVersion: 1,
  position: [560, 200],
  credentials: { redis: { id: REDIS_CRED_ID, name: REDIS_CRED_NAME } },
};

const applyCode = `// Aplica filtro de contatos (blacklist/whitelist) salvo em Redis pelo dashboard.
// Sem filtro = atende todo mundo (compatibilidade retroativa).
const item = $input.first().json;
const raw = item.filter_raw; // string JSON ou null/undefined
let filter = null;
try { filter = raw ? JSON.parse(raw) : null; } catch { filter = null; }
delete item.filter_raw;

if (!filter) return [{ json: item }];

const mode = filter.mode === 'whitelist' ? 'whitelist' : 'blacklist';
const isGroup = !!item.isGroup;
const idStr = isGroup ? item.remoteJid : item.telefone;
const list = isGroup ? (filter.groups || []) : (filter.contacts || []);
const inList = list.includes(idStr);

if (mode === 'whitelist') {
  if (!inList) return [];
} else {
  if (inList) return [];
}
return [{ json: item }];
`;

const applyNode = {
  parameters: { mode: 'runOnceForEachItem', jsCode: applyCode },
  id: 'aplicar-filtro-contatos',
  name: NODE_APPLY,
  type: 'n8n-nodes-base.code',
  typeVersion: 2,
  position: [720, 200],
};

// Garante presença dos nós
let nodes = wf.nodes.slice();
nodes = nodes.filter(n => n.name !== NODE_GET && n.name !== NODE_APPLY);
nodes.push(redisGetNode, applyNode);

// Re-wire conexões: Normalizar Mensagem → Redis GET Contact Filter → Aplicar Filtro Contatos → Redis GET human_takeover
const connections = { ...wf.connections };
connections['Normalizar Mensagem'] = { main: [[{ node: NODE_GET, type: 'main', index: 0 }]] };
connections[NODE_GET] = { main: [[{ node: NODE_APPLY, type: 'main', index: 0 }]] };
connections[NODE_APPLY] = { main: [[{ node: 'Redis GET human_takeover', type: 'main', index: 0 }]] };

// PUT — somente campos permitidos
const body = {
  name: wf.name,
  nodes,
  connections,
  settings: {
    executionOrder: wf.settings?.executionOrder || 'v1',
    saveManualExecutions: wf.settings?.saveManualExecutions !== false,
  },
};

const updated = await api('PUT', `/api/v1/workflows/${WF_ID}`, body);
console.log('OK. Nós atuais:');
for (const n of updated.nodes) console.log(`  - ${n.name} (${n.type})`);

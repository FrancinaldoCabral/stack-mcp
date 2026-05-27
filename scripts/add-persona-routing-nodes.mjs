// Adiciona 2 nós ao workflow [AGENT] Executor (jleu4RPvSnYDL8Gd):
//  - "Redis GET Persona Routes" — lê persona_routes:{instance}
//  - "Resolver Persona" (Code) — injeta personaKey/systemPromptOverride/restaurantId no item
// Re-wire: Desembalar Payload → Redis GET Persona Routes → Resolver Persona → Redis GET Agente
//
// Também ajusta o nó "Construir Prompt" para honrar o systemPromptOverride da persona
// (substituição de uma única linha: customSystemPrompt agora vem da persona, com fallback
// no businessDoc.systemPrompt). Mantém todo o resto do nó intacto.
//
// Idempotente. Snapshot salvo em snapshots/wf-executor-pre-personas.json antes do PUT.
//
// Uso: node scripts/add-persona-routing-nodes.mjs

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
const WF_ID = 'jleu4RPvSnYDL8Gd';
const REDIS_CRED_ID = 'zkKpThv7TlkK3IoB';
const REDIS_CRED_NAME = 'Redis Vendly';

const NODE_GET = 'Redis GET Persona Routes';
const NODE_RESOLVE = 'Resolver Persona';
const UPSTREAM = 'Desembalar Payload';
const DOWNSTREAM = 'Redis GET Agente';
const PROMPT_NODE = 'Construir Prompt';

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

// Snapshot pré-mudança
const snapDir = path.resolve(root, '..', 'snapshots');
fs.mkdirSync(snapDir, { recursive: true });
const snapPath = path.join(snapDir, `wf-executor-pre-personas-${Date.now()}.json`);
fs.writeFileSync(snapPath, JSON.stringify(wf, null, 2));
console.log('Snapshot salvo em', snapPath);

// Sanity: nós obrigatórios existem?
const byName = Object.fromEntries(wf.nodes.map(n => [n.name, n]));
for (const required of [UPSTREAM, DOWNSTREAM, PROMPT_NODE]) {
  if (!byName[required]) {
    console.error(`Nó obrigatório ausente: ${required}`);
    process.exit(1);
  }
}

// Definir nós (idempotente)
const upstreamPos = byName[UPSTREAM].position || [0, 0];
const downstreamPos = byName[DOWNSTREAM].position || [upstreamPos[0] + 400, upstreamPos[1]];
const xMid1 = upstreamPos[0] + 180;
const xMid2 = upstreamPos[0] + 360;
const y = upstreamPos[1];

const redisGetNode = {
  parameters: {
    operation: 'get',
    key: '={{ "persona_routes:" + $json.instance }}',
    propertyName: 'persona_raw',
    options: {},
  },
  id: 'redis-get-persona-routes',
  name: NODE_GET,
  type: 'n8n-nodes-base.redis',
  typeVersion: 1,
  position: [xMid1, y],
  credentials: { redis: { id: REDIS_CRED_ID, name: REDIS_CRED_NAME } },
};

const resolverCode = `// Resolve qual persona aplicar a esta mensagem com base em persona_routes:{instance}.
// IMPORTANTE: Redis GET typeVersion 1 substitui o item por {persona_raw: ...} — restaura
// o item original via $('${UPSTREAM}').first().json (mesmo padrão de "Aplicar Filtro Contatos").
// Sem rotas configuradas = nada acontece (compatibilidade total com fluxo antigo).
const item = $('${UPSTREAM}').first().json;
const raw = $input.first().json?.persona_raw ?? null;

if (!raw) return [{ json: item }];

let cfg = null;
try { cfg = JSON.parse(String(raw)); } catch { cfg = null; }
if (!cfg || !Array.isArray(cfg.routes)) return [{ json: item }];

const remoteJid = String(item.remoteJid || '');
const telefone = String(item.telefone || '');
const route = cfg.routes.find(r => r.jid === remoteJid)
  || cfg.routes.find(r => r.jid === telefone)
  || null;

if (!route) return [{ json: item }];

const personas = cfg.personas || {};
const persona = personas[route.personaKey] || null;

return [{
  json: {
    ...item,
    personaKey: route.personaKey,
    personaLabel: persona?.label ?? route.personaKey,
    systemPromptOverride: persona?.systemPrompt ?? '',
    toolsAllowed: Array.isArray(persona?.tools) ? persona.tools : [],
    restaurantId: route.restaurantId ?? null,
  },
}];
`;

const resolverNode = {
  parameters: { jsCode: resolverCode },
  id: 'resolver-persona',
  name: NODE_RESOLVE,
  type: 'n8n-nodes-base.code',
  typeVersion: 1,
  position: [xMid2, y],
};

// Mantém todos os nós exceto os 2 que vamos recriar; recria
let nodes = wf.nodes.filter(n => n.name !== NODE_GET && n.name !== NODE_RESOLVE);

// Patch do Construir Prompt: troca a linha que define customSystemPrompt para honrar persona
const promptNodeOriginal = byName[PROMPT_NODE];
const promptNodeUpdated = JSON.parse(JSON.stringify(promptNodeOriginal));
const oldCode = promptNodeUpdated.parameters?.jsCode || '';

// Identificadores possíveis da linha a substituir (idempotente)
const PERSONA_MARKER = '/* persona-override-injected */';
let newCode = oldCode;
if (!oldCode.includes(PERSONA_MARKER)) {
  // Tenta substituir o primeiro padrão encontrado
  const patterns = [
    /const\s+customSystemPrompt\s*=\s*businessDoc\.systemPrompt\s*\|\|\s*['"]['"];?/,
    /const\s+customSystemPrompt\s*=\s*businessDoc\?\.systemPrompt\s*\|\|\s*['"]['"];?/,
    /const\s+customSystemPrompt\s*=\s*[^;]+;/,
  ];
  const replacement = `${PERSONA_MARKER}\nconst __personaOverride = (typeof $ === 'function' ? $('${NODE_RESOLVE}').first()?.json?.systemPromptOverride : null) || '';\nconst customSystemPrompt = __personaOverride || businessDoc?.systemPrompt || '';`;
  let patched = false;
  for (const re of patterns) {
    if (re.test(newCode)) {
      newCode = newCode.replace(re, replacement);
      patched = true;
      break;
    }
  }
  if (!patched) {
    console.warn(`AVISO: não encontrei a definição de customSystemPrompt em "${PROMPT_NODE}". Injetando no topo (fallback).`);
    newCode = `${replacement}\n${newCode}`;
  }
  promptNodeUpdated.parameters.jsCode = newCode;
}

nodes = nodes.map(n => n.name === PROMPT_NODE ? promptNodeUpdated : n);
nodes.push(redisGetNode, resolverNode);

// Re-wire conexões: UPSTREAM → NODE_GET → NODE_RESOLVE → DOWNSTREAM
const connections = { ...wf.connections };
connections[UPSTREAM] = { main: [[{ node: NODE_GET, type: 'main', index: 0 }]] };
connections[NODE_GET] = { main: [[{ node: NODE_RESOLVE, type: 'main', index: 0 }]] };
connections[NODE_RESOLVE] = { main: [[{ node: DOWNSTREAM, type: 'main', index: 0 }]] };
// Não tocamos nas conexões de saída de DOWNSTREAM nem de outros nós.

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
console.log('\n✅ Persona routing instalado. Lembre-se de configurar rotas no dashboard.');

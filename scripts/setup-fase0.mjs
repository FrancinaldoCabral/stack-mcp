/**
 * FASE 0 — Setup via MCP HTTP
 * Executa: MongoDB indexes, Qdrant collections, Redis streams
 */

const MCP_URL = 'http://fco8og80s4sw4c0wc0ogswws.157.173.111.65.sslip.io/mcp';

// ── MCP client ──────────────────────────────────────────────────────────────
async function mcpCall(method, params) {
  const headers = {
    'Content-Type': 'application/json',
    'Accept': 'application/json, text/event-stream',
  };

  // initialize
  await http_post({ jsonrpc: '2.0', id: 0, method: 'initialize', params: {
    protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'setup', version: '1.0' }
  }}, headers);
  await http_post({ jsonrpc: '2.0', method: 'notifications/initialized', params: {} }, headers);

  // actual call
  const res = await http_post({ jsonrpc: '2.0', id: 1, method, params }, headers);
  if (res?.error) throw new Error(JSON.stringify(res.error));
  return res?.result;
}

async function http_post(body, headers) {
  const { request } = await import('node:http');
  return new Promise((resolve, reject) => {
    const b = JSON.stringify(body);
    const u = new URL(MCP_URL);
    const opt = {
      hostname: u.hostname, port: 80, path: '/mcp', method: 'POST',
      headers: { ...headers, 'Content-Length': Buffer.byteLength(b) }
    };
    const req = request(opt, r => {
      let d = '';
      r.on('data', c => d += c);
      r.on('end', () => {
        if (!d.trim()) return resolve(null);
        const lines = d.split('\n').filter(l => l.startsWith('data: '));
        try { resolve(lines.length ? JSON.parse(lines[0].slice(6)) : JSON.parse(d)); }
        catch { resolve(null); }
      });
    });
    req.on('error', reject);
    req.write(b); req.end();
  });
}

async function tool(name, args) {
  const result = await mcpCall('tools/call', { name, arguments: args });
  const text = result?.content?.[0]?.text ?? JSON.stringify(result);
  return text;
}

function log(msg) { process.stdout.write(msg + '\n'); }
function ok(label) { log(`  ✅ ${label}`); }
function err(label, e) { log(`  ❌ ${label}: ${e?.message ?? e}`); }
function section(title) { log(`\n── ${title} ${'─'.repeat(50 - title.length)}`); }

// ── FASE 0.3 — Qdrant collections ───────────────────────────────────────────
const QDRANT_COLLECTIONS = [
  'messages',
  'agent_responses',
  'human_actions',
  'tool_patterns',
  'objective_flows',
  'product_context',
  'user_profiles',
  'external_signals',
];

async function setupQdrant() {
  section('FASE 0.3 — Qdrant');

  // Listar collections existentes
  const existing = await tool('qdrant_list_collections', {});
  log(`  Existentes: ${existing}`);

  for (const name of QDRANT_COLLECTIONS) {
    try {
      const res = await tool('qdrant_create_collection', {
        collection: name,
        size: 1536,
        distance: 'Cosine',
      });
      ok(`Collection "${name}" — ${res}`);
    } catch (e) {
      if (String(e).includes('already exists')) ok(`Collection "${name}" já existe`);
      else err(`Collection "${name}"`, e);
    }
  }
}

// ── FASE 0.1 — MongoDB: admin.businesses indexes ────────────────────────────
const MONGO_ADMIN_INDEXES = [
  { database: 'admin', collection: 'businesses', keys: { business_id: 1 },    opts: { unique: true } },
  { database: 'admin', collection: 'businesses', keys: { evolution_instance: 1 }, opts: { unique: true } },
  { database: 'admin', collection: 'businesses', keys: { status: 1 },          opts: {} },
];

// Indexes para databases por negócio — criados num database _template
// (serão recriados por business no onboarding via o mesmo padrão)
const MONGO_BIZ_INDEXES = [
  { collection: 'leads',      keys: { telefone: 1 },             opts: { unique: true } },
  { collection: 'objectives', keys: { telefone: 1, status: 1 },  opts: {} },
  { collection: 'objectives', keys: { status: 1, tempo_inicio: -1 }, opts: {} },
  { collection: 'events',     keys: { telefone: 1, timestamp: -1 }, opts: {} },
  { collection: 'events',     keys: { objetivo_id: 1 },           opts: {} },
  { collection: 'knowledge',  keys: { tipo: 1, fonte: 1 },        opts: {} },
  { collection: 'knowledge',  keys: { objetivo_id: 1 },           opts: {} },
];

async function setupMongoDB() {
  section('FASE 0.1 — MongoDB');

  // admin.businesses indexes
  for (const { database, collection, keys, opts } of MONGO_ADMIN_INDEXES) {
    try {
      const res = await tool('mongo_create_index', { database, collection, keys, options: opts });
      ok(`${database}.${collection} index ${JSON.stringify(keys)} — ${res}`);
    } catch (e) { err(`${database}.${collection} index`, e); }
  }

  // Template de indexes para databases por negócio
  // Aplicados ao database `_template` como referência
  for (const { collection, keys, opts } of MONGO_BIZ_INDEXES) {
    try {
      const res = await tool('mongo_create_index', {
        database: '_template',
        collection,
        keys,
        options: opts,
      });
      ok(`_template.${collection} index ${JSON.stringify(keys)} — ${res}`);
    } catch (e) { err(`_template.${collection} index`, e); }
  }

  // Inserir documento de exemplo no admin.businesses (cria a collection)
  try {
    const res = await tool('mongo_find_one', {
      database: 'admin',
      collection: 'businesses',
      filter: { _system: true },
    });
    if (!res || res.includes('null')) {
      await tool('mongo_insert_one', {
        database: 'admin',
        collection: 'businesses',
        document: {
          _system: true,
          _description: 'Documento de controle — não remover',
          criado_em: new Date().toISOString(),
        },
      });
      ok('admin.businesses — documento de controle inserido');
    } else {
      ok('admin.businesses — já existe');
    }
  } catch (e) { err('admin.businesses init', e); }
}

// ── FASE 0.2 — Redis: verificar conectividade e salvar config base ──────────
async function setupRedis() {
  section('FASE 0.2 — Redis');

  // Verificar conectividade via redis_info
  try {
    const info = await tool('redis_info', {});
    const version = info.match(/redis_version:(\S+)/)?.[1] ?? 'desconhecida';
    ok(`Conectividade — Redis ${version}`);
  } catch (e) { err('redis_info', e); return; }

  // Salvar chave de controle do sistema
  try {
    await tool('redis_set', { key: 'config:_system:initialized', value: new Date().toISOString() });
    ok('Chave config:_system:initialized salva');
  } catch (e) { err('redis_set', e); }

  // Nota: Redis Streams (XADD/XGROUP) serão criados dinamicamente no onboarding.
  // Os tools redis_xadd e redis_xgroup serão adicionados ao MCP server (FASE 0.2.2).
  log('  ℹ️  Redis Streams: serão criados via onboarding. Tools XADD/XGROUP a adicionar.');
}

// ── Main ─────────────────────────────────────────────────────────────────────
log('🚀 Setup FASE 0 — Sistema de Atendimento Inteligente');
log(`   MCP: ${MCP_URL}`);

try {
  await setupQdrant();
  await setupMongoDB();
  await setupRedis();
  log('\n✅ FASE 0 concluída.\n');
} catch (e) {
  log(`\n❌ Erro fatal: ${e?.message ?? e}\n`);
  process.exit(1);
}

/**
 * Fix completo do Agent workflow (jleu4RPvSnYDL8Gd):
 * 1. Adiciona nós "Garantir Fluxo" após MongoDB GET Business e GET Cliente
 *    para não parar quando as coleções estão vazias
 * 2. Corrige Redis GET Sessao key para usar $('Desembalar Payload') em vez de $json
 * 3. Corrige Construir Prompt para usar optional chaining nos acessos MongoDB
 */
import 'dotenv/config';
import https from 'https';

function req(method, path, body) {
  return new Promise((res, rej) => {
    const u = new URL(process.env.N8N_URL + path);
    const d = body ? JSON.stringify(body) : undefined;
    const opts = {
      hostname: u.hostname,
      path: u.pathname + u.search,
      method,
      headers: {
        'X-N8N-API-KEY': process.env.N8N_API_KEY,
        Accept: 'application/json',
        'Content-Type': 'application/json',
        ...(d ? { 'Content-Length': Buffer.byteLength(d) } : {}),
      },
    };
    const r = https.request(opts, (resp) => {
      let s = '';
      resp.on('data', (x) => (s += x));
      resp.on('end', () => {
        try { res({ status: resp.statusCode, body: JSON.parse(s) }); }
        catch { res({ status: resp.statusCode, body: s }); }
      });
    });
    r.on('error', rej);
    if (d) r.write(d);
    r.end();
  });
}

const { status: getStatus, body: wf } = await req('GET', '/api/v1/workflows/jleu4RPvSnYDL8Gd');
if (getStatus !== 200) { console.error('GET failed', getStatus); process.exit(1); }

// Helper para encontrar nó por nome
const findNode = (name) => wf.nodes.find((n) => n.name === name);

// ─── 1. Adicionar nó "Garantir Fluxo Business" após MongoDB GET Business ────
const garantirBizCode = `// Se MongoDB GET Business retornou 0 itens (coleção vazia), passa um item vazio
// para não bloquear o fluxo
const items = $input.all();
if (items.length > 0) return items;
return [{ json: { _businessNotFound: true } }];`;

const garantirBizNode = {
  id: 'garantir-fluxo-biz',
  name: 'Garantir Fluxo Business',
  type: 'n8n-nodes-base.code',
  typeVersion: 2,
  position: [1400, 240],
  parameters: { jsCode: garantirBizCode, mode: 'runOnceForEachItem' },
};

// ─── 2. Adicionar nó "Garantir Fluxo Cliente" após MongoDB GET Cliente ───────
const garantirClienteCode = `// Se MongoDB GET Cliente retornou 0 itens (cliente novo), passa um item vazio
// para não bloquear o fluxo
const items = $input.all();
if (items.length > 0) return items;
return [{ json: { _customerNotFound: true } }];`;

const garantirClienteNode = {
  id: 'garantir-fluxo-cliente',
  name: 'Garantir Fluxo Cliente',
  type: 'n8n-nodes-base.code',
  typeVersion: 2,
  position: [1600, 240],
  parameters: { jsCode: garantirClienteCode, mode: 'runOnceForEachItem' },
};

// Adicionar os novos nós ao workflow
wf.nodes.push(garantirBizNode, garantirClienteNode);

// ─── 3. Atualizar conexões ───────────────────────────────────────────────────
// Original: MongoDB GET Business → MongoDB GET Cliente
// Original: MongoDB GET Cliente  → Redis GET Sessao
// Novo:     MongoDB GET Business → Garantir Fluxo Business → MongoDB GET Cliente
// Novo:     MongoDB GET Cliente  → Garantir Fluxo Cliente  → Redis GET Sessao

const conn = wf.connections;

// MongoDB GET Business agora conecta a Garantir Fluxo Business
conn['MongoDB GET Business'] = { main: [[{ node: 'Garantir Fluxo Business', type: 'main', index: 0 }]] };

// Garantir Fluxo Business conecta a MongoDB GET Cliente
conn['Garantir Fluxo Business'] = { main: [[{ node: 'MongoDB GET Cliente', type: 'main', index: 0 }]] };

// MongoDB GET Cliente agora conecta a Garantir Fluxo Cliente
conn['MongoDB GET Cliente'] = { main: [[{ node: 'Garantir Fluxo Cliente', type: 'main', index: 0 }]] };

// Garantir Fluxo Cliente conecta a Redis GET Sessao
conn['Garantir Fluxo Cliente'] = { main: [[{ node: 'Redis GET Sessao', type: 'main', index: 0 }]] };

// ─── 4. Corrigir Redis GET Sessao key (usar $('Desembalar Payload') em vez de $json) ──
const redisGetSessao = findNode('Redis GET Sessao');
redisGetSessao.parameters.key =
  "={{ 'sessao:' + $('Desembalar Payload').first().json.instance + ':' + $('Desembalar Payload').first().json.telefone }}";

// ─── 5. Corrigir Construir Prompt: usar optional chaining (?.) ────────────────
const construirPrompt = findNode('Construir Prompt');
construirPrompt.parameters.jsCode = construirPrompt.parameters.jsCode
  // Fix MongoDB GET Business: .first().json → .first()?.json
  .replace(
    "const businessDoc = $('MongoDB GET Business').first().json ?? {};",
    "const businessDoc = $('MongoDB GET Business').first()?.json ?? {};"
  )
  // Fix MongoDB GET Cliente: .first().json → .first()?.json
  .replace(
    "const clienteDoc = $('MongoDB GET Cliente').first().json ?? {};",
    "const clienteDoc = $('MongoDB GET Cliente').first()?.json ?? {};"
  )
  // Fix Qdrant: .first().json?.result → .first()?.json?.result
  .replace(
    "const qdrantBlocks = ($('Qdrant Search Contexto').first().json?.result ?? [])",
    "const qdrantBlocks = ($('Qdrant Search Contexto').first()?.json?.result ?? [])"
  );

// ─── 6. Salvar workflow ──────────────────────────────────────────────────────
const { status, body: result } = await req('PUT', '/api/v1/workflows/jleu4RPvSnYDL8Gd', {
  name: wf.name,
  nodes: wf.nodes,
  connections: wf.connections,
  settings: { executionOrder: 'v1', saveManualExecutions: true },
});

if (status === 200) {
  console.log('Status: 200 OK');
  // Verificar nós adicionados
  const addedNodes = result.nodes.filter((n) => n.name.startsWith('Garantir'));
  console.log('Nós adicionados:', addedNodes.map((n) => n.name));
  // Verificar Redis key corrigida
  const rg = result.nodes.find((n) => n.name === 'Redis GET Sessao');
  console.log('Redis key:', rg?.parameters?.key);
  // Verificar conexões relevantes
  console.log('Conexões MongoDB GET Business:', JSON.stringify(result.connections['MongoDB GET Business']));
  console.log('Conexões MongoDB GET Cliente:', JSON.stringify(result.connections['MongoDB GET Cliente']));
} else {
  console.error('ERRO', status, JSON.stringify(result).slice(0, 500));
}

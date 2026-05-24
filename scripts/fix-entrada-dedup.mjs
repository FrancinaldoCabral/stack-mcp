/**
 * Fix: duplicata de respostas no [CORE] Entrada
 *
 * Problema: Chatwoot dispara o webhook várias vezes para a mesma mensagem
 * (message_updated, retries, etc.) e todas passam pelo filtro de message_type.
 *
 * Fix 1: Adiciona filtro `event !== 'message_created'` em Normalizar Mensagem.
 * Fix 2: Adiciona Redis dedup por cw_message_id após Normalizar:
 *   Normalizar → Redis GET Dedup → IF Já Processado? → (não visto) → Redis SET Dedup → PUSH Buffer → ...
 */

import 'dotenv/config';

const N8N_URL = process.env.N8N_URL;
const N8N_KEY = process.env.N8N_API_KEY;
const WF_ID   = 'bEb19TdWZfFloisU';
const HEADERS = { 'X-N8N-API-KEY': N8N_KEY, 'Accept': 'application/json', 'Content-Type': 'application/json' };

const REDIS_CRED = { id: 'zkKpThv7TlkK3IoB', name: 'Redis Vendly' };

// 1. Buscar workflow atual
const r = await fetch(`${N8N_URL}/api/v1/workflows/${WF_ID}`, { headers: HEADERS });
if (!r.ok) throw new Error(`GET failed: ${r.status}`);
const wf = await r.json();

const nodes = wf.nodes;
const conns = wf.connections;

// 2. Atualizar código do Normalizar Mensagem: adicionar filtro por event
const normNode = nodes.find(n => n.id === 'normalizar');
if (!normNode) throw new Error('Nó normalizar não encontrado');

const OLD_FILTER = `// Filtrar apenas mensagens de entrada (do contato/cliente)
const msgType = data.message_type;
if (msgType !== 'incoming' && msgType !== 0) return [];`;

const NEW_FILTER = `// Filtrar apenas eventos de criação de mensagem (evita message_updated e retries)
if (data.event && data.event !== 'message_created') return [];

// Filtrar apenas mensagens de entrada (do contato/cliente)
const msgType = data.message_type;
if (msgType !== 'incoming' && msgType !== 0) return [];`;

if (!normNode.parameters.jsCode.includes('Filtrar apenas mensagens de entrada')) {
  console.log('⚠️  Padrão do filtro não encontrado em Normalizar — pulando Fix 1');
} else {
  normNode.parameters.jsCode = normNode.parameters.jsCode.replace(OLD_FILTER, NEW_FILTER);
  console.log('✅ Fix 1: filtro event adicionado');
}

// 3. Verificar se nós de dedup já existem (idempotência)
if (nodes.find(n => n.id === 'redis-get-dedup')) {
  console.log('ℹ️  Nós de dedup já existem — pulando Fix 2');
} else {
  // 4. Posicionar novos nós: Normalizar está em [480,300], PUSH Buffer em [700,300]
  // Novos nós ocupam: GET[720], IF[960], SET[1200]
  // Nós existentes após normalizar: PUSH Buffer e posteriores deslocam +520
  for (const n of nodes) {
    if (['push-buffer-in', 'set-debounce-ts', 'redis-set-debounce-ts', 'call-debounce'].includes(n.id)) {
      n.position = [n.position[0] + 740, n.position[1]];
    }
  }

  // 5. Adicionar nó: Redis GET Dedup
  nodes.push({
    id: 'redis-get-dedup',
    name: 'Redis GET Dedup',
    type: 'n8n-nodes-base.redis',
    typeVersion: 1,
    position: [720, 300],
    parameters: {
      operation: 'get',
      key: "={{ 'cw_dedup:' + $json.cw_message_id }}",
      propertyName: 'dedup_seen',
      options: {},
    },
    credentials: { redis: REDIS_CRED },
  });

  // 6. Adicionar nó: IF Já Processado?
  nodes.push({
    id: 'if-dedup',
    name: 'IF Já Processado?',
    type: 'n8n-nodes-base.if',
    typeVersion: 2,
    position: [960, 300],
    parameters: {
      conditions: {
        options: { caseSensitive: false, leftValue: '', typeValidation: 'strict' },
        conditions: [{
          id: 'dedup-check',
          leftValue: "={{ $json.dedup_seen }}",
          rightValue: '',
          operator: { type: 'string', operation: 'notEquals', rightType: 'value' },
        }],
        combinator: 'and',
      },
    },
  });

  // 7. Adicionar nó: Redis SET Dedup (TTL 300s = 5 min)
  nodes.push({
    id: 'redis-set-dedup',
    name: 'Redis SET Dedup',
    type: 'n8n-nodes-base.redis',
    typeVersion: 1,
    position: [1200, 300],
    parameters: {
      operation: 'set',
      key: "={{ 'cw_dedup:' + $json.cw_message_id }}",
      value: '1',
      expire: true,
      ttl: 300,
      keyType: 'string',
    },
    credentials: { redis: REDIS_CRED },
  });

  // 8. Atualizar conexões
  // Remover: Normalizar → PUSH Buffer
  if (conns['Normalizar Mensagem']?.main?.[0]) {
    conns['Normalizar Mensagem'].main[0] = conns['Normalizar Mensagem'].main[0]
      .filter(t => t.node !== 'PUSH Buffer');
    // Adicionar: Normalizar → Redis GET Dedup
    conns['Normalizar Mensagem'].main[0].push({ node: 'Redis GET Dedup', type: 'main', index: 0 });
  }

  // Redis GET Dedup → IF Já Processado?
  conns['Redis GET Dedup'] = { main: [[{ node: 'IF Já Processado?', type: 'main', index: 0 }]] };

  // IF Já Processado?
  //   output 0 (true = já visto): morrer (sem conexão)
  //   output 1 (false = novo): → Redis SET Dedup
  conns['IF Já Processado?'] = { main: [[], [{ node: 'Redis SET Dedup', type: 'main', index: 0 }]] };

  // Redis SET Dedup → PUSH Buffer
  conns['Redis SET Dedup'] = { main: [[{ node: 'PUSH Buffer', type: 'main', index: 0 }]] };

  console.log('✅ Fix 2: nós de dedup adicionados e conexões atualizadas');
}

// 9. Salvar via PUT
const body = {
  name: wf.name,
  nodes: wf.nodes,
  connections: wf.connections,
  settings: { executionOrder: 'v1', saveManualExecutions: true },
};

const rPut = await fetch(`${N8N_URL}/api/v1/workflows/${WF_ID}`, {
  method: 'PUT',
  headers: HEADERS,
  body: JSON.stringify(body),
});

const result = await rPut.json();
if (!rPut.ok) {
  console.error('❌ PUT falhou:', rPut.status, JSON.stringify(result).slice(0, 400));
  process.exit(1);
}

console.log('✅ Workflow salvo com sucesso!');

// 10. Verificar resultado
const updConns = result.connections;
console.log('\nFluxo após Normalizar:');
const normConns = updConns['Normalizar Mensagem']?.main?.[0];
console.log('  Normalizar →', normConns?.map(t => t.node).join(', ') ?? '(nada)');
console.log('  Redis GET Dedup →', updConns['Redis GET Dedup']?.main?.[0]?.map(t => t.node).join(', ') ?? '(nada)');
const ifConns = updConns['IF Já Processado?']?.main;
console.log('  IF[0=sim/dup] →', ifConns?.[0]?.map(t => t.node).join(', ') ?? '(morreu)');
console.log('  IF[1=novo] →', ifConns?.[1]?.map(t => t.node).join(', ') ?? '(nada)');
console.log('  Redis SET Dedup →', updConns['Redis SET Dedup']?.main?.[0]?.map(t => t.node).join(', ') ?? '(nada)');

// Verificar fix 1
const updNorm = result.nodes.find(n => n.id === 'normalizar');
const hasEventFilter = updNorm?.parameters?.jsCode?.includes("data.event !== 'message_created'");
console.log('\nFiltro event em Normalizar:', hasEventFilter ? '✅' : '❌');

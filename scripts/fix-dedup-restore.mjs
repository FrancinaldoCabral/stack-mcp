/**
 * Corrige o problema: Redis GET Dedup substitui o item inteiro por {dedup_seen: null},
 * perdendo conversation_id e todos os outros campos da mensagem.
 *
 * Fix: adiciona Code node "Restaurar Item Dedup" após o IF (output 1 = novo)
 * que restaura o item original do Normalizar Mensagem antes de prosseguir.
 *
 * Fluxo novo:
 *   Normalizar → Redis GET Dedup → IF Já Processado?
 *     IF[0 = já visto] → dead end
 *     IF[1 = novo]     → Restaurar Item Dedup → Redis SET Dedup → PUSH Buffer → ...
 */
import 'dotenv/config';

const N8N_URL = process.env.N8N_URL;
const N8N_KEY = process.env.N8N_API_KEY;
const WF_ID   = 'bEb19TdWZfFloisU';
const HEADERS = { 'X-N8N-API-KEY': N8N_KEY, 'Accept': 'application/json', 'Content-Type': 'application/json' };

const r = await fetch(`${N8N_URL}/api/v1/workflows/${WF_ID}`, { headers: HEADERS });
const wf = await r.json();

// 1. Verificar se o nó já existe
const existing = wf.nodes.find(n => n.id === 'restaurar-item-dedup');
if (existing) {
  console.log('Nó restaurar-item-dedup já existe, verificando conexões...');
} else {
  // 2. Criar o nó Code "Restaurar Item Dedup"
  const restaurarNode = {
    id: 'restaurar-item-dedup',
    name: 'Restaurar Item Dedup',
    type: 'n8n-nodes-base.code',
    typeVersion: 2,
    position: [1200, 300],  // entre IF (900,300) e Redis SET Dedup (1440,300)
    parameters: {
      jsCode: `// Redis GET Dedup substitui o item por {dedup_seen: value}, perdendo os campos originais.
// Restauramos o item original do Normalizar Mensagem antes de prosseguir.
const original = $('Normalizar Mensagem').first().json;
return [{ json: original }];`,
    },
  };
  wf.nodes.push(restaurarNode);
  console.log('✅ Nó restaurar-item-dedup adicionado');
}

// 3. Atualizar conexões:
//    IF[1] → Restaurar Item Dedup → Redis SET Dedup (em vez de IF[1] → Redis SET Dedup diretamente)
const conns = wf.connections;

// IF output 1 → Restaurar Item Dedup (em vez de Redis SET Dedup)
if (conns['IF Já Processado?']) {
  conns['IF Já Processado?'].main[1] = [{ node: 'Restaurar Item Dedup', type: 'main', index: 0 }];
  console.log('✅ IF output 1 → Restaurar Item Dedup');
}

// Restaurar Item Dedup → Redis SET Dedup
conns['Restaurar Item Dedup'] = { main: [[{ node: 'Redis SET Dedup', type: 'main', index: 0 }]] };
console.log('✅ Restaurar Item Dedup → Redis SET Dedup');

// 4. Salvar
const rPut = await fetch(`${N8N_URL}/api/v1/workflows/${WF_ID}`, {
  method: 'PUT',
  headers: HEADERS,
  body: JSON.stringify({
    name: wf.name,
    nodes: wf.nodes,
    connections: conns,
    settings: { executionOrder: 'v1', saveManualExecutions: true },
  }),
});

const result = await rPut.json();
if (!rPut.ok) {
  console.error('PUT falhou:', rPut.status, JSON.stringify(result).slice(0, 300));
  process.exit(1);
}

// 5. Verificar resultado
const updConns = result.connections;
console.log('\nConexões IF:', JSON.stringify(updConns['IF Já Processado?']?.main));
console.log('Conexões Restaurar:', JSON.stringify(updConns['Restaurar Item Dedup']?.main));
console.log('\n✅ Workflow salvo com sucesso!');

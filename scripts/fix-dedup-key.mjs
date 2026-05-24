/**
 * Corrige a chave do dedup Redis de 'cw_dedup:{cw_message_id}' para
 * 'cw_dedup:{conversation_id}:{timestamp}' (= created_at da mensagem Chatwoot).
 *
 * Dois eventos Chatwoot para o mesmo áudio têm o mesmo created_at mas
 * IDs diferentes (ex: 227 e 228). A chave por conv_id:created_at pega isso.
 *
 * Também aumenta o TTL de 300s → 120s (suficiente para cobrir o gap de 29s).
 */
import 'dotenv/config';

const N8N_URL = process.env.N8N_URL;
const N8N_KEY = process.env.N8N_API_KEY;
const WF_ID   = 'bEb19TdWZfFloisU';
const HEADERS = { 'X-N8N-API-KEY': N8N_KEY, 'Accept': 'application/json', 'Content-Type': 'application/json' };

const r = await fetch(`${N8N_URL}/api/v1/workflows/${WF_ID}`, { headers: HEADERS });
const wf = await r.json();

let changed = 0;

for (const node of wf.nodes) {
  if (node.id === 'redis-get-dedup') {
    console.log('redis-get-dedup key antes:', node.parameters.key);
    // Usa conversation_id + timestamp (= created_at da mensagem)
    node.parameters.key = "={{ 'cw_dedup:' + $json.conversation_id + ':' + $json.timestamp }}";
    console.log('redis-get-dedup key depois:', node.parameters.key);
    changed++;
  }
  if (node.id === 'redis-set-dedup') {
    console.log('redis-set-dedup key antes:', node.parameters.key);
    node.parameters.key = "={{ 'cw_dedup:' + $json.conversation_id + ':' + $json.timestamp }}";
    node.parameters.ttl = 120; // 2 minutos — suficiente para cobrir retries do Chatwoot
    console.log('redis-set-dedup key depois:', node.parameters.key);
    changed++;
  }
}

if (changed < 2) {
  console.error(`Esperava 2 mudanças, fiz ${changed}. Verificar IDs dos nós.`);
  process.exit(1);
}

const rPut = await fetch(`${N8N_URL}/api/v1/workflows/${WF_ID}`, {
  method: 'PUT',
  headers: HEADERS,
  body: JSON.stringify({
    name: wf.name,
    nodes: wf.nodes,
    connections: wf.connections,
    settings: { executionOrder: 'v1', saveManualExecutions: true },
  }),
});

const result = await rPut.json();
if (!rPut.ok) { console.error('PUT falhou:', rPut.status, JSON.stringify(result).slice(0, 300)); process.exit(1); }

// Verificar
const gNode = result.nodes.find(n => n.id === 'redis-get-dedup');
const sNode = result.nodes.find(n => n.id === 'redis-set-dedup');
console.log('\n✅ Chaves atualizadas:');
console.log('  GET key:', gNode?.parameters?.key);
console.log('  SET key:', sNode?.parameters?.key, 'TTL:', sNode?.parameters?.ttl);

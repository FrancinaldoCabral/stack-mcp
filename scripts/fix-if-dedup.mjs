/**
 * Corrige o nó IF Já Processado? para funcionar corretamente
 * quando Redis GET retorna null (chave não existe = mensagem nova).
 */
import 'dotenv/config';

const N8N_URL = process.env.N8N_URL;
const N8N_KEY = process.env.N8N_API_KEY;
const WF_ID   = 'bEb19TdWZfFloisU';
const HEADERS = { 'X-N8N-API-KEY': N8N_KEY, 'Accept': 'application/json', 'Content-Type': 'application/json' };

const r = await fetch(`${N8N_URL}/api/v1/workflows/${WF_ID}`, { headers: HEADERS });
const wf = await r.json();

const ifNode = wf.nodes.find(n => n.id === 'if-dedup');
if (!ifNode) { console.error('Nó if-dedup não encontrado'); process.exit(1); }

console.log('Condição atual:', JSON.stringify(ifNode.parameters, null, 2));

// Corrigir: usar notEmpty com typeValidation: loose
// null/undefined/'' → vazio → false (output 1 = não visto = deixar passar)
// "1" → não vazio → true (output 0 = já visto = parar)
ifNode.parameters = {
  conditions: {
    options: {
      caseSensitive: false,
      typeValidation: 'loose',
    },
    conditions: [{
      id: 'dedup-check',
      leftValue: "={{ $json.dedup_seen ?? '' }}",
      rightValue: '',
      operator: { type: 'string', operation: 'notEmpty' },
    }],
    combinator: 'and',
  },
};

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

const updIf = result.nodes.find(n => n.id === 'if-dedup');
console.log('\n✅ IF atualizado:');
console.log(JSON.stringify(updIf.parameters, null, 2));

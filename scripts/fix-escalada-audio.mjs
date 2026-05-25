/**
 * fix-escalada-audio.mjs
 *
 * Corrige 2 bugs no [AGENT] Executor que causam o ciclo de erros:
 *
 * Bug 1 — Escalada Humano usa fetch() → falha silenciosa
 *   Fix: remove o bloco fetch() do Code node e adiciona nó HTTP Request
 *        (Chatwoot Nota Escalada) após Escalada Humano para postar a nota privada.
 *
 * Bug 2 — Escalada Humano nunca roda no caminho de ÁUDIO
 *   Quando bot responde em áudio dizendo "vou transferir para humano",
 *   Loop Chunks nunca executa → Escalada Humano nunca roda → Redis takeover nunca é setado
 *   → bot continua respondendo mesmo após dizer que vai transferir.
 *   Fix: adicionar conexão Chatwoot Enviar Audio → Escalada Humano.
 */

import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dir = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dir, '..', '.env') });

const N8N_URL = process.env.N8N_URL;
const N8N_API_KEY = process.env.N8N_API_KEY;
const WF_ID = 'jleu4RPvSnYDL8Gd'; // [AGENT] Executor

const h = { 'X-N8N-API-KEY': N8N_API_KEY, 'Accept': 'application/json', 'Content-Type': 'application/json' };

const ok  = (msg) => console.log('  ✓', msg);
const fail = (msg) => { console.log('  ✗', msg); process.exitCode = 1; };

// ---------------------------------------------------------------------------
// 1. GET workflow atual
// ---------------------------------------------------------------------------
console.log('Buscando workflow atual...');
const wfRes = await fetch(`${N8N_URL}/api/v1/workflows/${WF_ID}`, { headers: h });
if (!wfRes.ok) { fail(`GET workflow: ${wfRes.status}`); process.exit(1); }
const wf = await wfRes.json();
console.log(`  workflow: "${wf.name}" (${wf.nodes.length} nós)`);

// ---------------------------------------------------------------------------
// 2. Fix Bug 1 — remover fetch() do nó Escalada Humano
// ---------------------------------------------------------------------------
const escaladaNode = wf.nodes.find(n => n.name === 'Escalada Humano');
if (!escaladaNode) { fail('Nó Escalada Humano não encontrado'); process.exit(1); }

const oldCode = escaladaNode.parameters.jsCode;
console.log('\nBug 1 — Removendo fetch() de Escalada Humano...');

// Remover bloco: // Nota privada no Chatwoot para o agente humano \ntry { ... } catch ...
const fetchBlockRegex = /\n+\/\/ Nota privada no Chatwoot para o agente humano\s*\ntry\s*\{[\s\S]*?\}\s*catch\s*\([^)]*\)\s*\{[^\}]*\}/;
const newCode = oldCode.replace(fetchBlockRegex, '');

if (newCode === oldCode) {
  fail('Bloco fetch() não encontrado no código — verificar manualmente');
  console.log('  Código atual:\n', oldCode.slice(0, 500));
  process.exit(1);
}

escaladaNode.parameters.jsCode = newCode;
ok('fetch() removido de Escalada Humano');

// ---------------------------------------------------------------------------
// 3. Fix Bug 1 (cont.) — adicionar nó HTTP Request "Chatwoot Nota Escalada"
// ---------------------------------------------------------------------------
console.log('\nAdicionando nó Chatwoot Nota Escalada...');

// Verificar se já existe
if (wf.nodes.find(n => n.name === 'Chatwoot Nota Escalada')) {
  ok('Nó Chatwoot Nota Escalada já existe — pulando criação');
} else {
  const newNode = {
    id: 'cw-nota-escalada',
    name: 'Chatwoot Nota Escalada',
    type: 'n8n-nodes-base.httpRequest',
    typeVersion: 4.2,
    position: [2090, 650],
    parameters: {
      method: 'POST',
      url: "={{ 'https://chatwoot.vendly.chat/api/v1/accounts/' + ($json.account_id ?? '1') + '/conversations/' + $json.conversation_id + '/messages' }}",
      authentication: 'genericCredentialType',
      genericAuthType: 'httpHeaderAuth',
      sendBody: true,
      specifyBody: 'json',
      jsonBody: "={{ JSON.stringify({ content: '🤖 IA transferiu para atendimento humano. Aguardando atendente.', message_type: 'outgoing', private: true }) }}",
      options: {
        response: {
          response: {
            neverError: true,
          },
        },
      },
    },
    credentials: {
      httpHeaderAuth: {
        id: 'ah2jhDk7ADl68x9G',
        name: 'Chatwoot Vendly',
      },
    },
  };
  wf.nodes.push(newNode);
  ok('Nó Chatwoot Nota Escalada adicionado');
}

// ---------------------------------------------------------------------------
// 4. Fix Bug 1 (cont.) — conectar Escalada Humano → Chatwoot Nota Escalada
// ---------------------------------------------------------------------------
console.log('\nAtualizando conexões...');

if (!wf.connections['Escalada Humano']) {
  wf.connections['Escalada Humano'] = { main: [[]] };
}

const escaladaConns = wf.connections['Escalada Humano'].main[0];
const alreadyHasNota = escaladaConns.some(c => c.node === 'Chatwoot Nota Escalada');
if (!alreadyHasNota) {
  escaladaConns.push({ node: 'Chatwoot Nota Escalada', type: 'main', index: 0 });
  ok('Conexão Escalada Humano → Chatwoot Nota Escalada adicionada');
} else {
  ok('Conexão Escalada Humano → Chatwoot Nota Escalada já existe');
}

// Verificar que Escalada Humano → Redis SET Takeover Escalada ainda existe
const hasRedis = escaladaConns.some(c => c.node === 'Redis SET Takeover Escalada');
if (!hasRedis) {
  escaladaConns.push({ node: 'Redis SET Takeover Escalada', type: 'main', index: 0 });
  ok('Conexão Escalada Humano → Redis SET Takeover Escalada restaurada');
} else {
  ok('Conexão Escalada Humano → Redis SET Takeover Escalada intacta');
}

// ---------------------------------------------------------------------------
// 5. Fix Bug 2 — conectar Chatwoot Enviar Audio → Escalada Humano
// ---------------------------------------------------------------------------
if (!wf.connections['Chatwoot Enviar Audio']) {
  wf.connections['Chatwoot Enviar Audio'] = { main: [[]] };
}

const cwAudioConns = wf.connections['Chatwoot Enviar Audio'].main[0];
const alreadyHasEscalada = cwAudioConns.some(c => c.node === 'Escalada Humano');
if (!alreadyHasEscalada) {
  cwAudioConns.push({ node: 'Escalada Humano', type: 'main', index: 0 });
  ok('Conexão Chatwoot Enviar Audio → Escalada Humano adicionada (fix Bug 2)');
} else {
  ok('Conexão Chatwoot Enviar Audio → Escalada Humano já existe');
}

// ---------------------------------------------------------------------------
// 6. PUT workflow
// ---------------------------------------------------------------------------
console.log('\nAplicando no N8N...');
const putRes = await fetch(`${N8N_URL}/api/v1/workflows/${WF_ID}`, {
  method: 'PUT',
  headers: h,
  body: JSON.stringify({
    name: wf.name,
    nodes: wf.nodes,
    connections: wf.connections,
    settings: { executionOrder: 'v1', saveManualExecutions: true },
  }),
});

if (!putRes.ok) {
  const body = await putRes.text();
  fail(`PUT workflow: ${putRes.status} — ${body.slice(0, 300)}`);
  process.exit(1);
}
ok('Workflow atualizado com sucesso');

// ---------------------------------------------------------------------------
// 7. Verificações cirúrgicas
// ---------------------------------------------------------------------------
console.log('\n── Verificações pós-apply ──');
const verRes = await fetch(`${N8N_URL}/api/v1/workflows/${WF_ID}`, { headers: h });
const verWf = await verRes.json();

const escNode = verWf.nodes.find(n => n.name === 'Escalada Humano');
const cwNotaNode = verWf.nodes.find(n => n.name === 'Chatwoot Nota Escalada');

// Check 1: fetch() removido
if (!(escNode?.parameters?.jsCode ?? '').includes('await fetch(')) {
  ok('Escalada Humano: sem fetch() — não falhará silenciosamente');
} else {
  fail('Escalada Humano: fetch() ainda presente');
}

// Check 2: Chatwoot Nota Escalada é HTTP Request
cwNotaNode?.type === 'n8n-nodes-base.httpRequest'
  ? ok('Chatwoot Nota Escalada: é HTTP Request node')
  : fail('Chatwoot Nota Escalada: não encontrado ou tipo errado');

// Check 3: usa credencial Chatwoot Vendly
cwNotaNode?.credentials?.httpHeaderAuth?.id === 'ah2jhDk7ADl68x9G'
  ? ok('Chatwoot Nota Escalada: usa credencial Chatwoot Vendly')
  : fail('Chatwoot Nota Escalada: credencial incorreta');

// Check 4: private: true na nota
(cwNotaNode?.parameters?.jsonBody ?? '').includes('private: true')
  ? ok('Chatwoot Nota Escalada: private: true (não duplica no WhatsApp)')
  : fail('Chatwoot Nota Escalada: private não é true');

// Check 5: conexão Chatwoot Enviar Audio → Escalada Humano
const audioToEscalada = (verWf.connections['Chatwoot Enviar Audio']?.main?.[0] ?? [])
  .some(c => c.node === 'Escalada Humano');
audioToEscalada
  ? ok('Conexão Chatwoot Enviar Audio → Escalada Humano: presente')
  : fail('Conexão Chatwoot Enviar Audio → Escalada Humano: ausente');

// Check 6: conexão Escalada Humano → Redis SET Takeover Escalada
const escToRedis = (verWf.connections['Escalada Humano']?.main?.[0] ?? [])
  .some(c => c.node === 'Redis SET Takeover Escalada');
escToRedis
  ? ok('Conexão Escalada Humano → Redis SET Takeover Escalada: presente')
  : fail('Conexão Escalada Humano → Redis SET Takeover Escalada: ausente');

// Check 7: conexão Escalada Humano → Chatwoot Nota Escalada
const escToNota = (verWf.connections['Escalada Humano']?.main?.[0] ?? [])
  .some(c => c.node === 'Chatwoot Nota Escalada');
escToNota
  ? ok('Conexão Escalada Humano → Chatwoot Nota Escalada: presente')
  : fail('Conexão Escalada Humano → Chatwoot Nota Escalada: ausente');

console.log('\n──────────────────────────────────────────────────');
if (process.exitCode === 1) {
  console.log('Resultado: ✗ FALHOU — verificar erros acima');
} else {
  console.log('Resultado: ✅ BUGS CORRIGIDOS');
  console.log('\nO que foi feito:');
  console.log('  [Bug 1] Escalada Humano: fetch() removido + Chatwoot Nota Escalada (HTTP Request) adicionado');
  console.log('  [Bug 2] Chatwoot Enviar Audio agora conecta a Escalada Humano');
  console.log('           → Quando bot responde em ÁUDIO dizendo "vou transferir para humano",');
  console.log('             o Redis takeover agora É setado, bot para de responder.');
}

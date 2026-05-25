/**
 * fix-audio-bugs.mjs
 * Fix 1: Montar Tool Result — modelo inválido 'google/gemini-2.5-flash-preview' → 'google/gemini-2.5-flash-lite'
 * Fix 2: Chatwoot Enviar Audio — Code node com fetch() (falha silenciosamente) → HTTP Request node
 * Fix 3: Escalada Humano — mesma falha silenciosa com fetch() → logar erro no throw para visibilidade
 */

import dotenv from 'dotenv';
dotenv.config();

const N8N_KEY = process.env.N8N_API_KEY;
const EXECUTOR_ID = 'jleu4RPvSnYDL8Gd';

async function n8n(path, method = 'GET', body = null) {
  const opts = {
    method,
    headers: { 'X-N8N-API-KEY': N8N_KEY, 'Accept': 'application/json', 'Content-Type': 'application/json' },
  };
  if (body) opts.body = JSON.stringify(body);
  const r = await fetch(`https://workflows.vendly.chat/api/v1${path}`, opts);
  if (!r.ok) {
    const text = await r.text();
    throw new Error(`N8N ${method} ${path} → ${r.status}: ${text.slice(0, 300)}`);
  }
  return r.json();
}

console.log('Carregando workflow Executor...');
const wf = await n8n(`/workflows/${EXECUTOR_ID}`);
const nodes = wf.nodes;

// ─────────────────────────────────────────────────────────────────────────────
// FIX 1: Montar Tool Result — fallback de modelo inválido
// ─────────────────────────────────────────────────────────────────────────────
const montarToolResult = nodes.find(n => n.name === 'Montar Tool Result');
if (!montarToolResult) throw new Error('Nó "Montar Tool Result" não encontrado');

const oldCode = montarToolResult.parameters.jsCode;
if (!oldCode.includes("'google/gemini-2.5-flash-preview'")) {
  console.log('Fix 1 já aplicado ou código diferente do esperado');
  console.log('Trecho atual:', oldCode.match(/model:.*?[\n,]/)?.[0]);
} else {
  montarToolResult.parameters.jsCode = oldCode.replace(
    "'google/gemini-2.5-flash-preview'",
    "'google/gemini-2.5-flash-lite'"
  );
  console.log('Fix 1: Montar Tool Result — modelo corrigido ✓');
}

// ─────────────────────────────────────────────────────────────────────────────
// FIX 2: Chatwoot Enviar Audio — Code node → HTTP Request node
// O fetch() dentro de Code nodes N8N falha silenciosamente no sandbox
// Converter para HTTP Request node com credencial (como Chatwoot Enviar)
// ─────────────────────────────────────────────────────────────────────────────
const cwAudioIdx = nodes.findIndex(n => n.name === 'Chatwoot Enviar Audio');
if (cwAudioIdx === -1) throw new Error('Nó "Chatwoot Enviar Audio" não encontrado');

const cwAudioNode = nodes[cwAudioIdx];
const currentPos = cwAudioNode.position;
const currentId = cwAudioNode.id;

// Substituir pelo HTTP Request node
// Usa o mesmo credential ID que "Chatwoot Enviar" (ah2jhDk7ADl68x9G = Chatwoot Vendly)
nodes[cwAudioIdx] = {
  id: currentId,
  name: 'Chatwoot Enviar Audio',
  type: 'n8n-nodes-base.httpRequest',
  typeVersion: 4.2,
  position: currentPos,
  parameters: {
    method: 'POST',
    // URL com account_id e conversation_id vindos de Parsear Chunks
    url: "={{ 'https://chatwoot.vendly.chat/api/v1/accounts/' + ($('Parsear Chunks').first().json.account_id ?? '1') + '/conversations/' + $('Parsear Chunks').first().json.conversation_id + '/messages' }}",
    authentication: 'genericCredentialType',
    genericAuthType: 'httpHeaderAuth',
    sendBody: true,
    specifyBody: 'json',
    // Texto completo de todos os chunks (em modo áudio é 1 chunk)
    jsonBody: "={{ JSON.stringify({ content: $('Parsear Chunks').all().map(function(c){ return c.json.chunk; }).filter(Boolean).join('\\n'), message_type: 'outgoing', private: false }) }}",
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
console.log('Fix 2: Chatwoot Enviar Audio → HTTP Request node ✓');

// ─────────────────────────────────────────────────────────────────────────────
// FIX 3: Escalada Humano — a nota privada também usa fetch() que falha
// Converter para retornar dados + usar nó HTTP externo, OU usar $http se disponível
// Por ora: fazer throw no catch para tornar o erro visível
// ─────────────────────────────────────────────────────────────────────────────
const escNode = nodes.find(n => n.name === 'Escalada Humano');
if (escNode?.parameters?.jsCode?.includes("} catch (e) {}")) {
  escNode.parameters.jsCode = escNode.parameters.jsCode.replace(
    "} catch (e) {}",
    "} catch (e) { console.error('Chatwoot escalada note error:', e.message ?? e); }"
  );
  console.log('Fix 3: Escalada Humano — catch com log de erro ✓');
} else {
  console.log('Fix 3: Escalada Humano catch já atualizado ou não encontrado');
}

// ─────────────────────────────────────────────────────────────────────────────
// Salvar
// ─────────────────────────────────────────────────────────────────────────────
const payload = {
  name: wf.name,
  nodes,
  connections: wf.connections,
  settings: {
    executionOrder: 'v1',
    saveManualExecutions: true,
  },
};

console.log('\nSalvando workflow...');
const result = await n8n(`/workflows/${EXECUTOR_ID}`, 'PUT', payload);
console.log('PUT status OK, id:', result.id ?? result.name ?? '?');

// ─────────────────────────────────────────────────────────────────────────────
// Verificação pós-fix
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n=== VERIFICAÇÃO ===');
const wf2 = await n8n(`/workflows/${EXECUTOR_ID}`);

const mtr2 = wf2.nodes.find(n => n.name === 'Montar Tool Result');
const modelLine = mtr2?.parameters?.jsCode?.match(/model:.*?[,\n]/)?.[0];
console.log('Montar Tool Result modelo:', modelLine ?? '?');
const hasWrongModel = mtr2?.parameters?.jsCode?.includes('gemini-2.5-flash-preview');
hasWrongModel
  ? console.log('  ✗ AINDA tem gemini-2.5-flash-preview!')
  : console.log('  ✓ gemini-2.5-flash-preview removido');

const cwa2 = wf2.nodes.find(n => n.name === 'Chatwoot Enviar Audio');
console.log('Chatwoot Enviar Audio tipo:', cwa2?.type);
cwa2?.type === 'n8n-nodes-base.httpRequest'
  ? console.log('  ✓ É HTTP Request node')
  : console.log('  ✗ AINDA é Code node');
if (cwa2?.type === 'n8n-nodes-base.httpRequest') {
  console.log('  URL:', cwa2.parameters?.url?.slice(0, 80));
  console.log('  credential:', cwa2.credentials?.httpHeaderAuth?.name);
}

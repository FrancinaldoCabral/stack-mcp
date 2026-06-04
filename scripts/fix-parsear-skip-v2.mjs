/**
 * fix-parsear-skip-v2.mjs
 *
 * Corrige a inserção incorreta do bloco [SKIP] em "Parsear Chunks".
 * O bloco foi inserido no meio da expressão `content = _choice?.message?.content ?? ...`
 * quebrando o token `??`.
 *
 * Fix:
 * 1. Restaura a linha `content = ...` completa (remove o bloco que foi injetado no meio)
 * 2. Re-insere o bloco [SKIP] no lugar correto: APÓS o fechar do if/else de content,
 *    ANTES do hallucination-guard.
 */
import 'dotenv/config';

const N8N = process.env.N8N_URL || 'https://workflows.vendly.chat';
const KEY = process.env.N8N_API_KEY;
const WF_ID = 'jleu4RPvSnYDL8Gd';
if (!KEY) { console.error('N8N_API_KEY ausente'); process.exit(1); }
const h = { 'X-N8N-API-KEY': KEY, 'Accept': 'application/json', 'Content-Type': 'application/json' };

async function n8n(method, path, body) {
  const r = await fetch(`${N8N}/api/v1${path}`, { method, headers: h, body: body ? JSON.stringify(body) : undefined });
  const t = await r.text();
  if (!r.ok) throw new Error(`${method} ${path} → ${r.status}: ${t.slice(0, 300)}`);
  return t ? JSON.parse(t) : {};
}

const wf = await n8n('GET', `/workflows/${WF_ID}`);
const pcNode = wf.nodes.find(n => n.name === 'Parsear Chunks');
if (!pcNode) throw new Error('"Parsear Chunks" não encontrado');

let code = pcNode.parameters.jsCode;

// ── Passo 1: Remover o bloco que foi inserido errado (dentro da expressão ??) ──
// O bloco inserido errado está entre "content = _choice?.message?.content" e "?? (resp.error..."
// Vamos identificar e reparar a expressão inteira.

const SKIP_START = '/* skip-signal-start */';
const SKIP_END = '/* skip-signal-end */';

// Remove qualquer versão existente do skip block (pode estar em posição errada)
const skipRe = new RegExp(
  SKIP_START.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '[\\s\\S]*?' + SKIP_END.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
  'g'
);
const hadSkipBlock = skipRe.test(code);
code = code.replace(skipRe, '');
console.log(hadSkipBlock ? '✓ Bloco [SKIP] incorreto removido' : '  (sem bloco [SKIP] anterior)');

// ── Passo 2: Corrigir a expressão `content = ...` que pode ter ficado fraturada ──
// O problema é que a linha pode ter ficado como:
//   content = _choice?.message?.content
//     ?? (resp.error ? (resp.error.message ?? JSON.stringify(resp.error)) : null)
//     ?? '...';
// mas com linhas em branco extras. Vamos normalizar.

// Detecta se há quebra estranha entre "content = _choice?.message?.content" e "??"
const fracturadoRe = /(content\s*=\s*_choice\??\.message\??\.content)\s*\n+\s*(\?\?)/;
if (fracturadoRe.test(code)) {
  code = code.replace(fracturadoRe, '$1\n    $2');
  console.log('✓ Expressão content = ... restaurada (quebra de linha extra removida)');
} else {
  console.log('  (expressão content = ... OK — sem quebra estranha)');
}

// ── Passo 3: Inserir o bloco [SKIP] no lugar correto ──────────────────────────
// O lugar correto é APÓS o fechamento do bloco if/else que define `content`
// e ANTES do /* hallucination-guard-start */.
// Âncora: "/* hallucination-guard-start */" ou, se não existir, antes de "_lastUserRaw"

const SKIP_BLOCK = `${SKIP_START}
// [SKIP] = agente decidiu nao responder (mensagem informal do grupo de entregadores)
if (typeof content === 'string' && content.trim() === '[SKIP]') {
  return [];
}
${SKIP_END}

`;

const ANCHORS = [
  '/* hallucination-guard-start */',
  'const _lastUserRaw',
  'const _userPediuHumano',
  'const escalarHumano',
];

let inserted = false;
for (const anchor of ANCHORS) {
  const idx = code.indexOf(anchor);
  if (idx !== -1) {
    code = code.slice(0, idx) + SKIP_BLOCK + code.slice(idx);
    console.log(`✓ Bloco [SKIP] inserido antes de "${anchor}"`);
    inserted = true;
    break;
  }
}
if (!inserted) {
  throw new Error('Nenhuma âncora encontrada para inserir o bloco [SKIP]. Código do nó pode ter mudado.');
}

// ── Passo 4: Salvar ──────────────────────────────────────────────────────────
pcNode.parameters.jsCode = code;

const allowedSettings = ['saveExecutionProgress','saveManualExecutions','saveDataErrorExecution','saveDataSuccessExecution','executionTimeout','errorWorkflow','timezone','executionOrder'];
const cleanSettings = {};
for (const k of allowedSettings) if (wf.settings?.[k] !== undefined) cleanSettings[k] = wf.settings[k];
if (!cleanSettings.executionOrder) cleanSettings.executionOrder = 'v1';

const put = await n8n('PUT', `/workflows/${WF_ID}`, {
  name: wf.name, nodes: wf.nodes, connections: wf.connections, settings: cleanSettings,
});
console.log('✅ Workflow salvo (id=' + put.id + ')');
console.log('   Parsear Chunks corrigido — [SKIP] no lugar certo, sem quebrar ??');

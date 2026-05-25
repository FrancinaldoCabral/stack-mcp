/**
 * fix-escalada-e-autoassign.mjs
 *
 * Corrige dois bugs:
 * 1. Parsear Chunks não inclui `escalarHumano` no modo TEXTO → Escalada Humano sempre retorna []
 * 2. Inbox 11 com enable_auto_assignment=true → ao abrir conversa, Chatwoot auto-atribui a um
 *    agente humano → dispara conversation_updated com assignee → Redis SET human_takeover →
 *    bot para de responder em TODA conversa nova
 */

import dotenv from 'dotenv';
dotenv.config();

const H = { 'X-N8N-API-KEY': process.env.N8N_API_KEY, Accept: 'application/json', 'Content-Type': 'application/json' };
const base = process.env.N8N_URL;
const CW_BASE = process.env.CHATWOOT_URL;
const CW_H = { 'api_access_token': process.env.CHATWOOT_API_KEY, 'Content-Type': 'application/json' };

// ── 1. Patch Parsear Chunks: add `escalarHumano` ao return do modo TEXTO ──
console.log('=== Fix 1: Parsear Chunks ===');
const wf = await fetch(`${base}/api/v1/workflows/jleu4RPvSnYDL8Gd`, { headers: H }).then(r => r.json());
const parsearChunks = wf.nodes.find(n => n.name === 'Parsear Chunks');

// Modo texto retorna chunks sem escalarHumano — verificar se o patch já foi aplicado
if (parsearChunks.parameters.jsCode.includes('escalarHumano,\n    contexto,')) {
  console.log('  Patch já aplicado');
} else {
  // Encontrar o bloco do return no modo texto (após o if respondWithAudio)
  const OLD = `    respondWithAudio: false,\n    contexto,`;
  const NEW = `    respondWithAudio: false,\n    escalarHumano,\n    contexto,`;

  if (!parsearChunks.parameters.jsCode.includes(OLD)) {
    // Tentar variante com espaços diferentes
    console.error('  ERRO: trecho esperado não encontrado no Parsear Chunks!');
    const idx = parsearChunks.parameters.jsCode.indexOf('respondWithAudio: false');
    console.error('  Contexto atual:', JSON.stringify(parsearChunks.parameters.jsCode.slice(Math.max(0, idx - 10), idx + 150)));
    process.exit(1);
  }

  parsearChunks.parameters.jsCode = parsearChunks.parameters.jsCode.replace(OLD, NEW);
  console.log('  Patch aplicado (escalarHumano adicionado ao modo texto)');

  const putRes = await fetch(`${base}/api/v1/workflows/jleu4RPvSnYDL8Gd`, {
    method: 'PUT', headers: H,
    body: JSON.stringify({
      name: wf.name, nodes: wf.nodes, connections: wf.connections,
      settings: { executionOrder: wf.settings?.executionOrder ?? 'v1', saveManualExecutions: true },
    }),
  });
  if (putRes.status !== 200) {
    const err = await putRes.text();
    throw new Error(`PUT falhou ${putRes.status}: ${err.slice(0, 300)}`);
  }
  const updated = await putRes.json();
  console.log(`  ✓ [AGENT] Executor atualizado. Nós: ${updated.nodes?.length}`);
}

// ── 2. Desabilitar enable_auto_assignment no inbox 11 ─────────────────────
console.log('\n=== Fix 2: Inbox auto-assignment ===');
const cwPatch = await fetch(`${CW_BASE}/api/v1/accounts/1/inboxes/11`, {
  method: 'PATCH', headers: CW_H,
  body: JSON.stringify({ channel: { enable_auto_assignment: false } }),
});
console.log('  PATCH status:', cwPatch.status);
const cwBody = await cwPatch.json().catch(() => ({}));
if (cwPatch.status === 200) {
  console.log(`  ✓ enable_auto_assignment: ${cwBody.enable_auto_assignment}`);
} else {
  console.error('  ERRO:', JSON.stringify(cwBody).slice(0, 200));
}

console.log('\n✓ Correções aplicadas!');

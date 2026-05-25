/**
 * revert-assign-button.mjs
 *
 * Reverte as mudanças do fix-assign-button.mjs que quebraram o fluxo:
 *
 * PROBLEMA INTRODUZIDO:
 * - Abrir Conversa agora só reagia a conversation_created
 * - Quando Evolution reabre uma conversa resolvida (nova msg) → ela fica STUCK em pending
 * - Usuário vê a mensagem na aba "Pending" mas não na aba "Open" do Chatwoot
 *
 * REVERT:
 * A) Abrir Conversa: volta a reagir a qualquer evento com conversa pending (original)
 * B) Escalada Humano: remove a mudança de status pending (o Redis key já impede o bot)
 *
 * NOTA: o botão de assign é o dropdown "Assigned Agent" no painel direito do Chatwoot.
 * Ele agora funciona porque Naldo Cabral foi adicionado como membro do inbox 11.
 */

import dotenv from 'dotenv';
dotenv.config();
const N8N = process.env.N8N_URL;
const H = { 'X-N8N-API-KEY': process.env.N8N_API_KEY, 'Accept': 'application/json, text/event-stream', 'Content-Type': 'application/json' };

const [wfAutoOpen, wfExecutor] = await Promise.all([
  fetch(`${N8N}/api/v1/workflows/Jijw4Dqil3QVYSp8`, { headers: H }).then(r => r.json()),
  fetch(`${N8N}/api/v1/workflows/jleu4RPvSnYDL8Gd`, { headers: H }).then(r => r.json()),
]);

// ── Revert A: Abrir Conversa ───────────────────────────────────────────────
const abrirNode = wfAutoOpen.nodes.find(n => n.name === 'Abrir Conversa');
const oldAbrir = abrirNode.parameters.jsCode;
abrirNode.parameters.jsCode = oldAbrir.replace(
  `// Só abrir em conversation_created — mudanças manuais de status (escalada) ficam pending\nif (event !== 'conversation_created') return [];`,
  `if (event !== 'conversation_created' && !data.conversation) return [];`
);

if (abrirNode.parameters.jsCode === oldAbrir) {
  console.log('Revert A: Abrir Conversa já está na versão original (sem mudança necessária)');
} else {
  const r = await fetch(`${N8N}/api/v1/workflows/Jijw4Dqil3QVYSp8`, {
    method: 'PUT', headers: H,
    body: JSON.stringify({
      name: wfAutoOpen.name,
      nodes: wfAutoOpen.nodes,
      connections: wfAutoOpen.connections,
      settings: { executionOrder: 'v1', saveManualExecutions: true },
    }),
  });
  console.log('Revert A — PUT Auto-open status:', r.status);
}

// ── Revert B: Escalada Humano ──────────────────────────────────────────────
const escaladaNode = wfExecutor.nodes.find(n => n.name === 'Escalada Humano');
const oldEscalada = escaladaNode.parameters.jsCode;

// Remover o bloco de mudança de status que foi adicionado
const statusChangeBlock = `
  // Mudar conversa para "pending" → botão Accept fica visível para agentes
  await fetch('https://chatwoot.vendly.chat/api/v1/accounts/' + (account_id || '1') + '/conversations/' + conversation_id, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', 'api_access_token': 'Db9GHGsN9YVUDhJvD5CHbVTz' },
    body: JSON.stringify({ status: 'pending' }),
  }).catch(() => {});`;

if (!oldEscalada.includes("status: 'pending'")) {
  console.log('Revert B: Escalada Humano já está na versão original (sem mudança necessária)');
} else {
  escaladaNode.parameters.jsCode = oldEscalada.replace(statusChangeBlock, '');
  const r = await fetch(`${N8N}/api/v1/workflows/jleu4RPvSnYDL8Gd`, {
    method: 'PUT', headers: H,
    body: JSON.stringify({
      name: wfExecutor.name,
      nodes: wfExecutor.nodes,
      connections: wfExecutor.connections,
      settings: { executionOrder: 'v1', saveManualExecutions: true },
    }),
  });
  console.log('Revert B — PUT Executor status:', r.status);
}

// ── Abrir conversa 10 agora (stuck em pending) ─────────────────────────────
console.log('\nAbrindo conversa 10 (stuck em pending)...');
const CW_BASE = process.env.CHATWOOT_URL;
const CW_H = { 'api_access_token': process.env.CHATWOOT_API_KEY, 'Content-Type': 'application/json' };
const r10 = await fetch(`${CW_BASE}/api/v1/accounts/1/conversations/10/toggle_status`, {
  method: 'POST', headers: CW_H,
  body: JSON.stringify({ status: 'open' }),
});
console.log('Abrir conversa 10 status:', r10.status);

// ── Verificação ────────────────────────────────────────────────────────────
console.log('\nVerificando...');
const [verAO, verEx] = await Promise.all([
  fetch(`${N8N}/api/v1/workflows/Jijw4Dqil3QVYSp8`, { headers: H }).then(r => r.json()),
  fetch(`${N8N}/api/v1/workflows/jleu4RPvSnYDL8Gd`, { headers: H }).then(r => r.json()),
]);
const verAbrir = verAO.nodes.find(n => n.name === 'Abrir Conversa');
const verEsc = verEx.nodes.find(n => n.name === 'Escalada Humano');

const abrirOK = verAbrir?.parameters?.jsCode?.includes("event !== 'conversation_created' && !data.conversation");
const escOK = !verEsc?.parameters?.jsCode?.includes("status: 'pending'");

console.log(`Abrir Conversa: ${abrirOK ? '✓ reage a qualquer conversa pending' : '✗ FALHOU'}`);
console.log(`Escalada Humano: ${escOK ? '✓ sem mudança de status' : '✗ ainda tem pending'}`);

if (abrirOK && escOK) {
  console.log('\n✓ Revert aplicado com sucesso!');
}

/**
 * fix-inbox-agentbot-members.mjs
 *
 * 1. Associa o Agent Bot (Vendly AI, id=1) ao inbox 11
 *    → faz aparecer o botão "Take Over" / "Assign" no Chatwoot
 * 2. Adiciona Naldo (ou todos os agentes da conta) como membros do inbox 11
 *    → preenche o dropdown de atribuição de agente
 */

import dotenv from 'dotenv';
dotenv.config();

const CW_BASE = process.env.CHATWOOT_URL;
const CW_H = { 'api_access_token': process.env.CHATWOOT_API_KEY, 'Content-Type': 'application/json' };

// ── 1. Listar agentes da conta ────────────────────────────────────────────
console.log('=== Agentes da conta ===');
const agentsRes = await fetch(`${CW_BASE}/api/v1/accounts/1/agents`, { headers: CW_H });
const agents = await agentsRes.json();
console.log(JSON.stringify(agents.map(a => ({ id: a.id, name: a.name, role: a.role })), null, 2));

const agentIds = agents.map(a => a.id);
if (agentIds.length === 0) { console.error('Nenhum agente encontrado!'); process.exit(1); }

// ── 2. Adicionar todos os agentes como membros do inbox 11 ────────────────
console.log('\n=== Adicionando membros ao inbox 11 ===');
const membersRes = await fetch(`${CW_BASE}/api/v1/accounts/1/inbox_members`, {
  method: 'POST', headers: CW_H,
  body: JSON.stringify({ inbox_id: 11, user_ids: agentIds }),
});
const membersBody = await membersRes.json().catch(() => ({}));
console.log('Status:', membersRes.status);
if (membersRes.status === 200) {
  const memberList = membersBody.payload ?? membersBody;
  console.log('Membros adicionados:', JSON.stringify(Array.isArray(memberList) ? memberList.map(m => ({ id: m.id, name: m.name })) : memberList, null, 2));
} else {
  console.error('Erro ao adicionar membros:', JSON.stringify(membersBody).slice(0, 200));
}

// ── 3. Associar Agent Bot (id=1) ao inbox 11 ─────────────────────────────
console.log('\n=== Associando Agent Bot ao inbox 11 ===');
// Endpoint específico para set_agent_bot
const botRes = await fetch(`${CW_BASE}/api/v1/accounts/1/inboxes/11/set_agent_bot`, {
  method: 'POST', headers: CW_H,
  body: JSON.stringify({ agent_bot: 1 }),
});
console.log('set_agent_bot status:', botRes.status);
const botBody = await botRes.text();
console.log('Response:', botBody.slice(0, 200));

// Verificar resultado
const verifyRes = await fetch(`${CW_BASE}/api/v1/accounts/1/inboxes/11/agent_bot`, { headers: CW_H });
const verifyBody = await verifyRes.json().catch(() => ({}));
console.log('Agent Bot atual no inbox 11:', JSON.stringify(verifyBody, null, 2));

console.log('\n✓ Configuração concluída!');

/**
 * fix-assign-button.mjs
 *
 * Problema: O botão "Accept/Assign" do Chatwoot desaparece muito rápido porque:
 * 1. Chatwoot cria conversas como "pending" quando inbox tem Agent Bot
 * 2. [CORE] Auto-open as abre imediatamente para "open" (inclusive ao mudar status manualmente)
 * 3. Na escalada, o agente não tem botão proeminente para aceitar a conversa
 *
 * Solução:
 * A) Abrir Conversa: apenas reagir em conversation_created (não em mudanças de status)
 *    → Conversas que são mudadas para pending manualmente (ex: na escalada) ficam pending
 * B) Escalada Humano: após nota privada, mudar conversa para pending
 *    → Botão "Accept" aparece para os agentes quando bot escala
 */

import dotenv from 'dotenv';
dotenv.config();
const N8N = process.env.N8N_URL;
const H = { 'X-N8N-API-KEY': process.env.N8N_API_KEY, 'Accept': 'application/json, text/event-stream', 'Content-Type': 'application/json' };

// ── Carregar workflows ──────────────────────────────────────────────────────
console.log('Carregando workflows...');
const [wfAutoOpen, wfExecutor] = await Promise.all([
  fetch(`${N8N}/api/v1/workflows/Jijw4Dqil3QVYSp8`, { headers: H }).then(r => r.json()),
  fetch(`${N8N}/api/v1/workflows/jleu4RPvSnYDL8Gd`, { headers: H }).then(r => r.json()),
]);

// ── Fix A: Abrir Conversa — só reagir em conversation_created ───────────────
const abrirNode = wfAutoOpen.nodes.find(n => n.name === 'Abrir Conversa');
if (!abrirNode) throw new Error('Nó Abrir Conversa não encontrado');

const oldAbrirCode = abrirNode.parameters.jsCode;
const newAbrirCode = oldAbrirCode.replace(
  `if (event !== 'conversation_created' && !data.conversation) return [];`,
  `// Só abrir em conversation_created — mudanças manuais de status (escalada) ficam pending\nif (event !== 'conversation_created') return [];`
);

if (oldAbrirCode === newAbrirCode) {
  console.log('Fix A: Abrir Conversa já está corrigido (nenhuma mudança necessária)');
} else {
  abrirNode.parameters.jsCode = newAbrirCode;
  console.log('Fix A: Abrir Conversa — aplicando correção...');
}

// ── Fix B: Escalada Humano — mudar conversa para pending ao escalar ─────────
const escaladaNode = wfExecutor.nodes.find(n => n.name === 'Escalada Humano');
if (!escaladaNode) throw new Error('Nó Escalada Humano não encontrado');

const oldEscaladaCode = escaladaNode.parameters.jsCode;

// Verificar se já tem a correção
if (oldEscaladaCode.includes('status: .pending.') || oldEscaladaCode.includes("status: 'pending'")) {
  console.log('Fix B: Escalada Humano já tem mudança de status (nenhuma mudança necessária)');
} else {
  // Inserir chamada para mudar status para pending após a nota privada
  const insertAfter = `  });
} catch (e) {}

return [{`;
  const replacement = `  });

  // Mudar conversa para "pending" → botão Accept fica visível para agentes
  await fetch('https://chatwoot.vendly.chat/api/v1/accounts/' + (account_id || '1') + '/conversations/' + conversation_id, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', 'api_access_token': 'Db9GHGsN9YVUDhJvD5CHbVTz' },
    body: JSON.stringify({ status: 'pending' }),
  }).catch(() => {});
} catch (e) {}

return [{`;
  
  if (!oldEscaladaCode.includes(insertAfter)) {
    throw new Error('Fix B: ponto de inserção não encontrado no código da Escalada Humano\nCódigo atual:\n' + oldEscaladaCode);
  }
  
  escaladaNode.parameters.jsCode = oldEscaladaCode.replace(insertAfter, replacement);
  console.log('Fix B: Escalada Humano — aplicando mudança de status pending...');
}

// ── Aplicar mudança no Auto-open ───────────────────────────────────────────
if (oldAbrirCode !== abrirNode.parameters.jsCode) {
  const payload = {
    name: wfAutoOpen.name,
    nodes: wfAutoOpen.nodes,
    connections: wfAutoOpen.connections,
    settings: { executionOrder: 'v1', saveManualExecutions: true },
  };
  const r = await fetch(`${N8N}/api/v1/workflows/Jijw4Dqil3QVYSp8`, {
    method: 'PUT', headers: H, body: JSON.stringify(payload),
  });
  console.log('PUT Auto-open status:', r.status);
  if (r.status !== 200) {
    const body = await r.json().catch(() => ({}));
    console.error('Erro ao atualizar Auto-open:', JSON.stringify(body));
  }
}

// ── Aplicar mudança no Executor ────────────────────────────────────────────
if (oldEscaladaCode !== escaladaNode.parameters.jsCode) {
  const payload = {
    name: wfExecutor.name,
    nodes: wfExecutor.nodes,
    connections: wfExecutor.connections,
    settings: { executionOrder: 'v1', saveManualExecutions: true },
  };
  const r = await fetch(`${N8N}/api/v1/workflows/jleu4RPvSnYDL8Gd`, {
    method: 'PUT', headers: H, body: JSON.stringify(payload),
  });
  console.log('PUT Executor status:', r.status);
  if (r.status !== 200) {
    const body = await r.json().catch(() => ({}));
    console.error('Erro ao atualizar Executor:', JSON.stringify(body));
  }
}

// ── Verificação ────────────────────────────────────────────────────────────
console.log('\nVerificando...');
const [verAutoOpen, verExecutor] = await Promise.all([
  fetch(`${N8N}/api/v1/workflows/Jijw4Dqil3QVYSp8`, { headers: H }).then(r => r.json()),
  fetch(`${N8N}/api/v1/workflows/jleu4RPvSnYDL8Gd`, { headers: H }).then(r => r.json()),
]);

const verAbrir = verAutoOpen.nodes.find(n => n.name === 'Abrir Conversa');
const verEscalada = verExecutor.nodes.find(n => n.name === 'Escalada Humano');

const abrirOK = verAbrir?.parameters?.jsCode?.includes("if (event !== 'conversation_created') return []");
const escaladaOK = verEscalada?.parameters?.jsCode?.includes("status: 'pending'");

console.log(`Abrir Conversa: ${abrirOK ? '✓ só reage em conversation_created' : '✗ FALHOU'}`);
console.log(`Escalada Humano: ${escaladaOK ? '✓ muda status para pending' : '✗ FALHOU'}`);

if (abrirOK && escaladaOK) {
  console.log('\n✓ Ambas as correções aplicadas com sucesso!');
  console.log('\nNovo comportamento:');
  console.log('  • Conversas novas: criadas como pending → Auto-open abre para open (bot responde)');
  console.log('  • Escalada para humano: bot muda conversa para pending → botão Accept/Assign aparece');
  console.log('  • Agente aceita conversa → conversation_updated com assignee → Redis SET → bot para');
  console.log('  • Agente resolve → conversation_status_changed resolved → Redis DEL → bot volta');
} else {
  process.exitCode = 1;
}

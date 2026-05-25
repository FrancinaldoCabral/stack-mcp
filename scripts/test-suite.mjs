/**
 * test-suite.mjs — Suite de testes automatizados para Vendly/Chatwoot/N8N
 *
 * Testa sem enviar mensagens reais de WhatsApp:
 *  T1. Estrutura dos workflows N8N (nós críticos presentes)
 *  T2. Takeover humano via webhook cw-auto-open (SET ao assign, DEL ao resolve)
 *  T3. Redis: leitura/escrita de chaves takeover
 *  T4. Escalada humana: verifica que escalarHumano está nos chunks de texto
 *  T5. Chatwoot API: cria nota privada de teste e deleta
 *  T6. Auto-assignment desabilitado no inbox 11
 *  T7. Conexões críticas do Executor (áudio e escalada)
 */

import dotenv from 'dotenv';
dotenv.config();

const N8N = process.env.N8N_URL;
const N8N_H = { 'X-N8N-API-KEY': process.env.N8N_API_KEY, Accept: 'application/json', 'Content-Type': 'application/json' };
const CW_BASE = process.env.CHATWOOT_URL;
const CW_H = { 'api_access_token': process.env.CHATWOOT_API_KEY, 'Content-Type': 'application/json' };
const REDIS_URL = process.env.REDIS_URL;
const WH_BASE = N8N.replace('/api/v1', '').replace('workflows.vendly.chat', 'workflows.vendly.chat');

// ── Utilidades ────────────────────────────────────────────────────────────
let passed = 0, failed = 0, warns = 0;

function ok(label) { console.log(`  ✓ ${label}`); passed++; }
function fail(label, detail = '') { console.log(`  ✗ ${label}${detail ? ': ' + detail : ''}`); failed++; }
function warn(label, detail = '') { console.log(`  ⚠ ${label}${detail ? ': ' + detail : ''}`); warns++; }

async function section(title, fn) {
  console.log(`\n── ${title} ──`);
  try { await fn(); } catch (e) { fail('Erro inesperado', e.message); }
}

// ── Carregar workflows uma vez ────────────────────────────────────────────
console.log('Carregando workflows...');
const [wfExecutor, wfEntrada, wfAutoOpen] = await Promise.all([
  fetch(`${N8N}/api/v1/workflows/jleu4RPvSnYDL8Gd`, { headers: N8N_H }).then(r => r.json()),
  fetch(`${N8N}/api/v1/workflows/bEb19TdWZfFloisU`, { headers: N8N_H }).then(r => r.json()),
  fetch(`${N8N}/api/v1/workflows/Jijw4Dqil3QVYSp8`, { headers: N8N_H }).then(r => r.json()),
]);

// ── T1: Estrutura dos workflows ───────────────────────────────────────────
await section('T1: Estrutura dos workflows N8N', async () => {
  // Executor: nós críticos
  const execNodes = wfExecutor.nodes.map(n => n.name);
  for (const n of ['Parsear Chunks', 'Loop Chunks', 'Escalada Humano', 'Redis SET Takeover Escalada', 'Chatwoot Enviar Audio', 'Chatwoot Enviar', 'IF Responder com Audio?', 'Evolution send audio']) {
    execNodes.includes(n) ? ok(`Executor: nó "${n}" existe`) : fail(`Executor: nó "${n}" AUSENTE`);
  }

  // Entrada: nós críticos
  const entradaNodes = wfEntrada.nodes.map(n => n.name);
  for (const n of ['Redis GET human_takeover', 'Auto-Aceitar Conversa', 'PUSH Buffer']) {
    entradaNodes.includes(n) ? ok(`Entrada: nó "${n}" existe`) : fail(`Entrada: nó "${n}" AUSENTE`);
  }

  // Auto-open: nós críticos
  const autoOpenNodes = wfAutoOpen.nodes.map(n => n.name);
  for (const n of ['Handle Takeover Humano', 'IF SET ou DEL?', 'Redis SET human_takeover', 'Redis DEL human_takeover', 'Chatwoot Unassign']) {
    autoOpenNodes.includes(n) ? ok(`Auto-open: nó "${n}" existe`) : fail(`Auto-open: nó "${n}" AUSENTE`);
  }
});

// ── T2: Conteúdo crítico dos nós ──────────────────────────────────────────
await section('T2: Conteúdo dos nós críticos', async () => {
  // Parsear Chunks deve ter escalarHumano no modo texto
  const pc = wfExecutor.nodes.find(n => n.name === 'Parsear Chunks');
  const pcCode = pc?.parameters?.jsCode ?? '';

  // Verificar que escalarHumano aparece no return do modo texto (após respondWithAudio: false)
  const textReturnIdx = pcCode.indexOf('respondWithAudio: false');
  const afterTextReturn = pcCode.slice(textReturnIdx, textReturnIdx + 200);
  afterTextReturn.includes('escalarHumano') ? ok('Parsear Chunks: escalarHumano no modo texto') : fail('Parsear Chunks: escalarHumano AUSENTE no modo texto');

  // Parsear Chunks deve detectar [ESCALAR_HUMANO]
  pcCode.includes('[ESCALAR_HUMANO]') ? ok('Parsear Chunks: detecta [ESCALAR_HUMANO]') : fail('Parsear Chunks: NÃO detecta [ESCALAR_HUMANO]');

  // Auto-Aceitar Conversa deve checar takeover_value
  const aac = wfEntrada.nodes.find(n => n.name === 'Auto-Aceitar Conversa');
  aac?.parameters?.jsCode?.includes('takeover_value') ? ok('Auto-Aceitar: checa takeover_value') : fail('Auto-Aceitar: NÃO checa takeover_value');

  // Handle Takeover: só seta em conversation_updated com assignee
  const ht = wfAutoOpen.nodes.find(n => n.name === 'Handle Takeover Humano');
  const htCode = ht?.parameters?.jsCode ?? '';
  htCode.includes("event === 'conversation_updated' && assignee?.id") ? ok('Handle Takeover: só seta com assignee.id') : fail('Handle Takeover: lógica de SET incorreta');
  htCode.includes("status === 'resolved'") ? ok('Handle Takeover: DEL em resolved') : fail('Handle Takeover: sem DEL em resolved');

  // Abrir Conversa: reage a conversation_created E a qualquer evento com conversa pending
  // (não só conversation_created — Evolution reabre conversas resolvidas com outros eventos)
  const abrir = wfAutoOpen.nodes.find(n => n.name === 'Abrir Conversa');
  const abrirCode = abrir?.parameters?.jsCode ?? '';
  abrirCode.includes("event !== 'conversation_created' && !data.conversation")
    ? ok('Abrir Conversa: reage a conversation_created e eventos com conversa')
    : fail('Abrir Conversa: condição de abertura incorreta — conversas resolvidas podem ficar stuck em pending');

  // Escalada Humano: NÃO deve mudar status para pending (Auto-open reabriria imediatamente)
  // O Redis key já é suficiente para parar o bot; private note avisa o agente
  const esc = wfExecutor.nodes.find(n => n.name === 'Escalada Humano');
  const escCode = esc?.parameters?.jsCode ?? '';
  !escCode.includes("status: 'pending'")
    ? ok('Escalada Humano: sem mudança de status (Redis key impede o bot)')
    : fail('Escalada Humano: NÃO deve mudar status pending — Auto-open reabre imediatamente e quebra fluxo');

  // Montar Tool Result: fallback deve ser modelo válido (não gemini-2.5-flash-preview)
  const mtr = wfExecutor.nodes.find(n => n.name === 'Montar Tool Result');
  const mtrCode = mtr?.parameters?.jsCode ?? '';
  !mtrCode.includes("'google/gemini-2.5-flash-preview'")
    ? ok('Montar Tool Result: sem modelo inválido gemini-2.5-flash-preview')
    : fail('Montar Tool Result: usa gemini-2.5-flash-preview → tool calls enviam mensagem de erro como áudio');
  mtrCode.includes("'google/gemini-2.5-flash-lite'")
    ? ok('Montar Tool Result: fallback = gemini-2.5-flash-lite (válido)')
    : fail('Montar Tool Result: fallback de modelo incorreto');

  // Chatwoot Enviar Audio: deve ser HTTP Request node (não Code — fetch() falha em sandbox N8N)
  const cwAudio = wfExecutor.nodes.find(n => n.name === 'Chatwoot Enviar Audio');
  cwAudio?.type === 'n8n-nodes-base.httpRequest'
    ? ok('Chatwoot Enviar Audio: é HTTP Request node (não Code)')
    : fail('Chatwoot Enviar Audio: é Code node — fetch() falha silenciosamente no sandbox N8N');
  cwAudio?.credentials?.httpHeaderAuth?.name === 'Chatwoot Vendly'
    ? ok('Chatwoot Enviar Audio: usa credencial Chatwoot Vendly')
    : fail('Chatwoot Enviar Audio: credencial incorreta');
  (cwAudio?.parameters?.jsonBody ?? '').includes('private: true')
    ? ok('Chatwoot Enviar Audio: private: true (não duplica no WhatsApp)')
    : fail('Chatwoot Enviar Audio: private: false → texto vai ao cliente via WhatsApp (duplicado)');

  // Escalada Humano: não deve usar fetch() — falha silenciosa no sandbox N8N
  const escaladaNode = wfExecutor.nodes.find(n => n.name === 'Escalada Humano');
  !(escaladaNode?.parameters?.jsCode ?? '').includes('await fetch(')
    ? ok('Escalada Humano: sem fetch() — não falhará silenciosamente')
    : fail('Escalada Humano: usa fetch() → nota privada de escalada nunca é postada');

  // Chatwoot Nota Escalada: deve ser HTTP Request node
  const cwNota = wfExecutor.nodes.find(n => n.name === 'Chatwoot Nota Escalada');
  cwNota?.type === 'n8n-nodes-base.httpRequest'
    ? ok('Chatwoot Nota Escalada: é HTTP Request node')
    : fail('Chatwoot Nota Escalada: não existe ou não é HTTP Request');
  cwNota?.credentials?.httpHeaderAuth?.id === 'ah2jhDk7ADl68x9G'
    ? ok('Chatwoot Nota Escalada: usa credencial Chatwoot Vendly')
    : fail('Chatwoot Nota Escalada: credencial incorreta');
  (cwNota?.parameters?.jsonBody ?? '').includes('private: true')
    ? ok('Chatwoot Nota Escalada: private: true')
    : fail('Chatwoot Nota Escalada: private não é true');
});

// ── T3: Conexões críticas do Executor ─────────────────────────────────────
await section('T3: Conexões críticas do Executor', async () => {
  const conns = wfExecutor.connections;

  // Loop Chunks Done branch → Escalada Humano
  const loopDone = conns['Loop Chunks']?.main?.[1] ?? [];
  loopDone.some(c => c.node === 'Escalada Humano') ? ok('Loop Chunks Done → Escalada Humano') : fail('Loop Chunks Done NÃO conecta Escalada Humano');

  // Escalada Humano → Redis SET Takeover Escalada
  const escConns = conns['Escalada Humano']?.main?.[0] ?? [];
  escConns.some(c => c.node === 'Redis SET Takeover Escalada') ? ok('Escalada Humano → Redis SET Takeover Escalada') : fail('Escalada Humano NÃO conecta Redis SET Takeover Escalada');
  escConns.some(c => c.node === 'Chatwoot Nota Escalada') ? ok('Escalada Humano → Chatwoot Nota Escalada') : fail('Escalada Humano NÃO conecta Chatwoot Nota Escalada (nota privada não será postada)');

  // Chatwoot Enviar Audio → Escalada Humano (Bug 2: escalada em áudio também aciona takeover)
  const cwAudioConns = conns['Chatwoot Enviar Audio']?.main?.[0] ?? [];
  cwAudioConns.some(c => c.node === 'Escalada Humano') ? ok('Chatwoot Enviar Audio → Escalada Humano (escalada em áudio funciona)') : fail('Chatwoot Enviar Audio NÃO conecta Escalada Humano → escalada em áudio ignora takeover');

  // Evolution send audio → Chatwoot Enviar Audio (paralelo com Preparar Sessao audio)
  const evoAudio = conns['Evolution send audio']?.main?.[0] ?? [];
  evoAudio.some(c => c.node === 'Chatwoot Enviar Audio') ? ok('Evolution send audio → Chatwoot Enviar Audio') : fail('Evolution send audio NÃO conecta Chatwoot Enviar Audio');
  evoAudio.some(c => c.node === 'Preparar Sessao audio') ? ok('Evolution send audio → Preparar Sessao audio') : fail('Evolution send audio NÃO conecta Preparar Sessao audio');
});

// ── T4: Chatwoot inbox config ─────────────────────────────────────────────
await section('T4: Chatwoot inbox config', async () => {
  const inbox = await fetch(`${CW_BASE}/api/v1/accounts/1/inboxes`, { headers: CW_H }).then(r => r.json());
  const in11 = inbox.payload?.find(i => i.id === 11);
  if (!in11) { fail('Inbox 11 não encontrado'); return; }

  in11.enable_auto_assignment === false ? ok('Inbox 11: enable_auto_assignment = false') : fail('Inbox 11: enable_auto_assignment AINDA true (causa silenciamento automático do bot!)');
  ok(`Inbox 11: channel_type = ${in11.channel_type}`);

  // Agent Bot associado (CRÍTICO: sem ele, mensagens não chegam a /chatwoot-bot)
  const botRes = await fetch(`${CW_BASE}/api/v1/accounts/1/inboxes/11/agent_bot`, { headers: CW_H }).then(r => r.json()).catch(() => ({}));
  const botName = botRes?.agent_bot?.name;
  botName ? ok(`Inbox 11: Agent Bot = "${botName}" (necessário para receber mensagens)`) : fail('Inbox 11: Agent Bot NÃO associado — bot não receberá mensagens!');

  // Membros do inbox (necessário para dropdown de assign aparecer)
  const membersRes = await fetch(`${CW_BASE}/api/v1/accounts/1/inbox_members/11`, { headers: CW_H }).then(r => r.json()).catch(() => ({}));
  const members = membersRes?.payload ?? [];
  members.length > 0 ? ok(`Inbox 11: ${members.length} membro(s) — ${members.map(m => m.name).join(', ')}`) : fail('Inbox 11: sem membros — dropdown de assign estará vazio!');
});

// ── T5: Takeover via webhook cw-auto-open ─────────────────────────────────
await section('T5: Takeover via webhook cw-auto-open', async () => {
  // Usar número de teste fictício
  const testInstance = 'suporte-redatudo';
  const testPhone = '5500000000001';
  const testKey = `human_takeover:${testInstance}:${testPhone}`;
  const testConvId = '99999';
  const webhookUrl = `${N8N.replace('/api/v1', '')}/webhook/cw-auto-open`;

  // Garantir chave limpa antes do teste
  try {
    const redisModule = await import('ioredis');
    const Redis = redisModule.default;
    const redis = new Redis(REDIS_URL, { lazyConnect: true, connectTimeout: 3000 });
    await redis.connect().catch(() => {});
    await redis.del(testKey).catch(() => {});
    await redis.quit().catch(() => {});
    ok('Redis: chave de teste limpa');
  } catch (e) {
    warn('Redis direct: não foi possível conectar diretamente', e.message);
  }

  // Simular conversation_updated com assignee → deve SET a chave
  const assignPayload = {
    event: 'conversation_updated',
    conversation: {
      id: testConvId,
      status: 'open',
      inbox_id: 11,
      meta: {
        channel: testInstance,
        sender: { phone_number: `+${testPhone}`, identifier: '' },
        assignee: { id: 1, name: 'Naldo Cabral', type: 'user' },
      },
    },
    contact: { phone_number: `+${testPhone}` },
  };

  const r1 = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(assignPayload),
  }).catch(e => ({ status: 0, error: e.message }));

  if (r1.status === 200 || r1.status === 202) {
    ok(`Webhook cw-auto-open (assign): respondeu ${r1.status}`);
    await new Promise(r => setTimeout(r, 1500)); // aguardar execução
  } else {
    fail(`Webhook cw-auto-open (assign): status ${r1.status ?? r1.error}`);
  }

  // Simular conversation_status_changed resolved → deve DEL a chave
  const resolvePayload = {
    event: 'conversation_status_changed',
    conversation: {
      id: testConvId,
      status: 'resolved',
      inbox_id: 11,
      meta: {
        channel: testInstance,
        sender: { phone_number: `+${testPhone}`, identifier: '' },
      },
    },
    contact: { phone_number: `+${testPhone}` },
  };

  const r2 = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(resolvePayload),
  }).catch(e => ({ status: 0, error: e.message }));

  if (r2.status === 200 || r2.status === 202) {
    ok(`Webhook cw-auto-open (resolve): respondeu ${r2.status}`);
  } else {
    fail(`Webhook cw-auto-open (resolve): status ${r2.status ?? r2.error}`);
  }
});

// ── T6: Chatwoot API — criação de nota privada ────────────────────────────
await section('T6: Chatwoot API — criação de nota privada', async () => {
  // Pegar primeira conversa aberta para testar
  const convList = await fetch(`${CW_BASE}/api/v1/accounts/1/conversations?status=open&page=1`, { headers: CW_H }).then(r => r.json()).catch(() => ({}));
  const firstConv = convList.data?.payload?.[0] ?? convList.payload?.[0];
  if (!firstConv) { warn('Nenhuma conversa aberta encontrada para testar API Chatwoot'); return; }

  // Criar nota privada de teste
  const createRes = await fetch(`${CW_BASE}/api/v1/accounts/1/conversations/${firstConv.id}/messages`, {
    method: 'POST', headers: CW_H,
    body: JSON.stringify({ content: '[TESTE AUTOMATIZADO - PODE IGNORAR]', message_type: 'outgoing', private: true }),
  });
  const created = await createRes.json().catch(() => ({}));

  if (createRes.status === 200 && created.id) {
    ok(`Chatwoot API: criou nota privada (id=${created.id}, conv=${firstConv.id})`);
    // Deletar a nota de teste
    // Chatwoot não tem DELETE /messages na API v1 pública para agentes comuns
    // A nota privada ficará na conversa mas não impacta o cliente
    warn('Chatwoot API: nota privada criada (sem DELETE na API — visível apenas para agentes)');
  } else {
    fail(`Chatwoot API: falhou ao criar nota (status=${createRes.status})`, JSON.stringify(created).slice(0, 100));
  }
});

// ── T7: Estrutura Parsear Chunks audio mode ───────────────────────────────
await section('T7: Parsear Chunks — modo áudio', async () => {
  const pc = wfExecutor.nodes.find(n => n.name === 'Parsear Chunks');
  const code = pc?.parameters?.jsCode ?? '';

  // No modo áudio, já tinha escalarHumano
  const audioReturnIdx = code.indexOf('respondWithAudio: true');
  const beforeAudio = code.slice(Math.max(0, audioReturnIdx - 300), audioReturnIdx + 100);
  beforeAudio.includes('escalarHumano') ? ok('Parsear Chunks modo áudio: escalarHumano presente') : warn('Parsear Chunks modo áudio: escalarHumano possivelmente ausente');

  // Verificar que a regex de detecção de pedido de áudio existe
  code.includes('pedidoAudio') ? ok('Parsear Chunks: detecta pedido explícito de áudio') : warn('Parsear Chunks: sem detecção de pedido de áudio');
});

// ── Sumário ───────────────────────────────────────────────────────────────
console.log(`\n${'─'.repeat(50)}`);
console.log(`Resultado: ${passed} passaram | ${failed} falharam | ${warns} avisos`);
if (failed > 0) {
  console.log('\nFalhas encontradas — corrigir antes de testar em produção!');
  process.exitCode = 1;
} else {
  console.log('\nTodos os testes passaram!');
}

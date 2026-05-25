/**
 * fix-bot-resume-and-escalation.mjs
 *
 * Corrige 3 problemas:
 * 1. [CORE] Entrada: remove verificação de assignee (que impedia bot de responder após resolve)
 *    Substitui por verificação do Redis key human_takeover (controlada pelo [CORE] Auto-open)
 * 2. [CORE] Auto-open: ao resolver conversa, também remove assignee no Chatwoot para evitar
 *    "ghost assignee" quando a conversa é reaberta. Remove DEL errado no conversation_updated.
 * 3. [AGENT] Executor: adiciona capacidade de escalada humana via marcador [ESCALAR_HUMANO]
 *    no início da resposta da IA. Instrução adicionada ao system prompt.
 */

import dotenv from 'dotenv';
dotenv.config();

const N8N_BASE = process.env.N8N_URL;
const N8N_H = {
  'X-N8N-API-KEY': process.env.N8N_API_KEY,
  'Content-Type': 'application/json',
  'Accept': 'application/json',
};

const REDIS_CRED = 'zkKpThv7TlkK3IoB';
const CW_TOKEN = process.env.CHATWOOT_API_KEY;
const CW_URL = process.env.CHATWOOT_URL || 'https://chatwoot.vendly.chat';
const CW_ACCOUNT = process.env.CHATWOOT_ACCOUNT_ID || '1';

// IDs
const ENTRADA_ID = 'bEb19TdWZfFloisU';
const AUTOOPEN_ID = 'Jijw4Dqil3QVYSp8';
const EXECUTOR_ID = 'jleu4RPvSnYDL8Gd';

async function putWorkflow(id, wf) {
  const res = await fetch(`${N8N_BASE}/api/v1/workflows/${id}`, {
    method: 'PUT',
    headers: N8N_H,
    body: JSON.stringify({
      name: wf.name,
      nodes: wf.nodes,
      connections: wf.connections,
      settings: {
        executionOrder: wf.settings?.executionOrder ?? 'v1',
        saveManualExecutions: wf.settings?.saveManualExecutions ?? true,
      },
    }),
  });
  if (res.status !== 200) {
    const err = await res.text();
    throw new Error(`PUT ${id} falhou ${res.status}: ${err.slice(0, 400)}`);
  }
  return res.json();
}

// ═══════════════════════════════════════════════════════════════════════════
// FIX 1: [CORE] Entrada — Redis human_takeover ao invés de assignee hardcoded
// ═══════════════════════════════════════════════════════════════════════════
async function fixCoreEntrada() {
  console.log('=== Fix [CORE] Entrada ===');

  const res = await fetch(`${N8N_BASE}/api/v1/workflows/${ENTRADA_ID}`, { headers: N8N_H });
  const wf = await res.json();

  // ── 1. Remover verificação de assignee do Normalizar Mensagem ──────────
  const norm = wf.nodes.find(n => n.name === 'Normalizar Mensagem');
  const assigneeBlock = `\n// Bot silencia se conversa tem agente humano atribuído (handoff)\nconst assignee = data.conversation?.meta?.assignee ?? data.conversation?.assignee ?? null;\nif (assignee) return [];\n\n// Nota: Redis takeover flag ('human_takeover:{inbox}:{phone}') é verificado como backup\n// quando o assignee pode não estar no payload. O Events Handler mantém essa chave.`;
  norm.parameters.jsCode = norm.parameters.jsCode.replace(assigneeBlock, '');
  console.log('  Normalizar: bloco assignee removido');

  // ── 2. Adicionar Redis GET human_takeover (se ainda não existir) ────────
  if (!wf.nodes.find(n => n.name === 'Redis GET human_takeover')) {
    wf.nodes.push({
      id: 'redis-get-takeover',
      name: 'Redis GET human_takeover',
      type: 'n8n-nodes-base.redis',
      typeVersion: 1,
      position: [600, 300],
      parameters: {
        operation: 'get',
        key: "={{ 'human_takeover:' + $json.instance + ':' + $json.telefone }}",
        propertyName: 'takeover_value',
        options: {},
      },
      credentials: { redis: { id: REDIS_CRED, name: 'Redis Vendly' } },
    });
    console.log('  Redis GET human_takeover: adicionado');
  } else {
    console.log('  Redis GET human_takeover: já existe');
  }

  // ── 3. Atualizar Auto-Aceitar Conversa para checar takeover_value ───────
  const autoAceitar = wf.nodes.find(n => n.name === 'Auto-Aceitar Conversa');
  autoAceitar.parameters.jsCode = `// Verificar se há takeover humano ativo e auto-aceitar conversa pendente
const msg = $input.first().json;

// Se Redis tem chave human_takeover → humano controla → bot silencia
const takeover = msg.takeover_value ?? null;
if (takeover !== null && takeover !== '') {
  return [];
}

// Auto-aceitar conversa pendente (sem isso, Agent Bot não consegue operar)
if (msg.conversation_id && msg.conversation_status === 'pending') {
  try {
    await fetch(
      '${CW_URL}/api/v1/accounts/${CW_ACCOUNT}/conversations/' + msg.conversation_id + '/toggle_status',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'api_access_token': '${CW_TOKEN}' },
        body: JSON.stringify({ status: 'open' }),
      }
    );
  } catch (e) {}
}

return [$input.first()];`;
  console.log('  Auto-Aceitar Conversa: código atualizado com verificação takeover');

  // ── 4. Atualizar conexões: Normalizar → Redis GET → Auto-Aceitar ────────
  // Remover Normalizar → Auto-Aceitar (direto)
  wf.connections['Normalizar Mensagem'] = {
    main: [[{ node: 'Redis GET human_takeover', type: 'main', index: 0 }]],
  };
  // Redis GET → Auto-Aceitar
  wf.connections['Redis GET human_takeover'] = {
    main: [[{ node: 'Auto-Aceitar Conversa', type: 'main', index: 0 }]],
  };
  console.log('  Conexões: Normalizar → Redis GET → Auto-Aceitar');

  // ── 5. Ajustar posições ──────────────────────────────────────────────────
  const normNode = wf.nodes.find(n => n.name === 'Normalizar Mensagem');
  const autoNode = wf.nodes.find(n => n.name === 'Auto-Aceitar Conversa');
  const redisGetNode = wf.nodes.find(n => n.name === 'Redis GET human_takeover');
  const redisDedup = wf.nodes.find(n => n.name === 'Redis GET Dedup');

  normNode.position = [480, 300];
  redisGetNode.position = [700, 300];
  autoNode.position = [920, 300];
  if (redisDedup) redisDedup.position = [1140, 300];

  // Ajustar nós mais à frente
  const toShift = ['IF Já Processado?', 'Redis SET Dedup', 'Restaurar Item Dedup',
                   'PUSH Buffer', 'Setar Timestamp Debounce', 'Redis SET Debounce TS', 'Chamar Debounce'];
  const baseShift = 420; // shift total para a direita
  toShift.forEach((name, i) => {
    const n = wf.nodes.find(x => x.name === name);
    if (n) {
      // Só shifta se estiver antes da posição 1380
      if (n.position[0] < 1400) {
        n.position[0] += baseShift;
      }
    }
  });

  const updated = await putWorkflow(ENTRADA_ID, wf);
  console.log(`  ✓ [CORE] Entrada atualizado. Nós: ${updated.nodes?.length}`);
}

// ═══════════════════════════════════════════════════════════════════════════
// FIX 2: [CORE] Auto-open — Unassign no Chatwoot ao resolver, corrigir Handle Takeover
// ═══════════════════════════════════════════════════════════════════════════
async function fixAutoOpen() {
  console.log('\n=== Fix [CORE] Auto-open ===');

  const res = await fetch(`${N8N_BASE}/api/v1/workflows/${AUTOOPEN_ID}`, { headers: N8N_H });
  const wf = await res.json();

  // ── 1. Corrigir Handle Takeover Humano ─────────────────────────────────
  // - Remover DEL quando conversation_updated sem assignee (era um falso positivo)
  // - Adicionar conversation_id no caso de resolve (para o unassign)
  const takeover = wf.nodes.find(n => n.name === 'Handle Takeover Humano');
  takeover.parameters.jsCode = `
// Detectar takeover humano e gerenciar Redis
const raw = $input.first().json;
const data = raw.body ?? raw;
const event = data.event ?? '';

// Só processa estes eventos
if (!['conversation_updated', 'conversation_status_changed'].includes(event)) return [];

const conv = data.conversation ?? {};
const inboxName = conv.meta?.channel ?? data.inbox?.name ?? String(conv.inbox_id ?? '');

// Fallback: usar inbox_id 11 = suporte-redatudo
const resolvedInbox = inboxName || (conv.inbox_id === 11 ? 'suporte-redatudo' : String(conv.inbox_id ?? ''));
if (!resolvedInbox) return [];

const sender = data.contact ?? conv.meta?.sender ?? {};
const phoneRaw = sender.phone_number ?? '';
const identifier = sender.identifier ?? '';
const isGroup = identifier.includes('@g.us');
const phone = isGroup ? identifier : phoneRaw.replace(/\\D/g, '');

if (!phone) return [];

const assignee = conv.meta?.assignee ?? conv.assignee ?? null;
const status = conv.status ?? '';

// conversation_status_changed resolvida → limpar takeover + unassign no Chatwoot
if (event === 'conversation_status_changed' && status === 'resolved') {
  const convId = String(conv.id ?? data.id ?? data.conversation?.id ?? '');
  return [{ json: {
    _action: 'delete',
    key: 'human_takeover:' + resolvedInbox + ':' + phone,
    conversation_id: convId,
    account_id: '${CW_ACCOUNT}',
  }}];
}

// conversation_updated → apenas SET quando assignee definido
// Não fazer DEL aqui (pode ser mudança de label/time — só deleta no resolve)
if (event === 'conversation_updated' && assignee?.id) {
  return [{ json: {
    _action: 'set',
    key: 'human_takeover:' + resolvedInbox + ':' + phone,
    value: assignee.name ?? 'human',
  }}];
}

return [];
`;
  console.log('  Handle Takeover: corrigido (sem DEL em conversation_updated sem assignee)');

  // ── 2. Adicionar Chatwoot Unassign Code node ────────────────────────────
  if (!wf.nodes.find(n => n.name === 'Chatwoot Unassign')) {
    wf.nodes.push({
      id: 'cw-unassign',
      name: 'Chatwoot Unassign',
      type: 'n8n-nodes-base.code',
      typeVersion: 2,
      position: [1200, 620],
      parameters: {
        jsCode: `
// Remover assignee do Chatwoot ao resolver conversa
// Isso evita "ghost assignee" quando a conversa é reaberta por nova mensagem
const msg = $input.first().json;
const convId = msg.conversation_id;
const accountId = msg.account_id || '${CW_ACCOUNT}';

if (!convId || convId === 'undefined') return [$input.first()];

try {
  await fetch('${CW_URL}/api/v1/accounts/' + accountId + '/conversations/' + convId + '/assignments', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', 'api_access_token': '${CW_TOKEN}' },
    body: JSON.stringify({ assignee_id: null }),
  });
} catch (e) {}

return [$input.first()];
`,
      },
    });
    console.log('  Chatwoot Unassign: adicionado');
  } else {
    console.log('  Chatwoot Unassign: já existe');
  }

  // ── 3. Conectar Redis DEL → Chatwoot Unassign ───────────────────────────
  wf.connections['Redis DEL human_takeover'] = {
    main: [[{ node: 'Chatwoot Unassign', type: 'main', index: 0 }]],
  };
  console.log('  Conexão: Redis DEL → Chatwoot Unassign');

  const updated = await putWorkflow(AUTOOPEN_ID, wf);
  console.log(`  ✓ [CORE] Auto-open atualizado. Nós: ${updated.nodes?.length}`);
}

// ═══════════════════════════════════════════════════════════════════════════
// FIX 3: [AGENT] Executor — Escalada humana com [ESCALAR_HUMANO]
// ═══════════════════════════════════════════════════════════════════════════
async function addEscalationToExecutor() {
  console.log('\n=== Adicionar Escalada ao [AGENT] Executor ===');

  const res = await fetch(`${N8N_BASE}/api/v1/workflows/${EXECUTOR_ID}`, { headers: N8N_H });
  const wf = await res.json();

  // Verificar se já foi adicionado
  if (wf.nodes.find(n => n.name === 'Escalada Humano')) {
    console.log('  Escalada Humano já existe — pulando');
    return;
  }

  // ── 1. Atualizar Parsear Chunks — detectar [ESCALAR_HUMANO] ────────────
  const parsear = wf.nodes.find(n => n.name === 'Parsear Chunks');

  // Encontrar onde content é atribuído para inserir detecção logo após
  const oldBlock = `const historico = promptData.historico ?? [];`;
  const newBlock = `// Detectar e limpar marcador de escalada para humano
const escalarHumano = content.includes('[ESCALAR_HUMANO]');
content = content.replace(/\\[ESCALAR_HUMANO\\]/g, '').trim();

const historico = promptData.historico ?? [];`;
  parsear.parameters.jsCode = parsear.parameters.jsCode.replace(oldBlock, newBlock);

  // Adicionar escalarHumano ao item de áudio
  parsear.parameters.jsCode = parsear.parameters.jsCode.replace(
    `    json: {\n      chunk: audioContent,\n      fullText: audioContent,\n      isLast: true,\n      respondWithAudio: true,`,
    `    json: {\n      chunk: audioContent,\n      fullText: audioContent,\n      isLast: true,\n      respondWithAudio: true,\n      escalarHumano,`
  );

  // Adicionar escalarHumano aos itens de texto (no map de chunks)
  parsear.parameters.jsCode = parsear.parameters.jsCode.replace(
    `    delay: 800 + i * 600,\n    conversation_id: promptData.conversation_id ?? '',\n    account_id: promptData.account_id ?? '',\n  }`,
    `    delay: 800 + i * 600,\n    escalarHumano,\n    conversation_id: promptData.conversation_id ?? '',\n    account_id: promptData.account_id ?? '',\n  }`
  );

  console.log('  Parsear Chunks: [ESCALAR_HUMANO] detectado');

  // ── 2. Atualizar Construir Prompt — adicionar instrução de escalada ─────
  const construir = wf.nodes.find(n => n.name === 'Construir Prompt');
  const oldSistema = `const sistemaPrompt = (customSystemPrompt || defaultPrompt) + customerCtx + intelligenceCtx + audioSystemNote;`;
  const newSistema = `const escalaSystemNote = '\\n\\n## Transferência para Atendimento Humano\\nQuando o cliente solicitar explicitamente falar com um humano/atendente/pessoa, estiver muito frustrado, ou a situação exigir intervenção humana imediata: inclua [ESCALAR_HUMANO] no início da sua resposta. Exemplo: "[ESCALAR_HUMANO] Claro! Vou te conectar com um atendente agora. Um momento! 🙏". O sistema faz a transferência automaticamente. Após o marcador, escreva normalmente a mensagem para o cliente.';
const sistemaPrompt = (customSystemPrompt || defaultPrompt) + customerCtx + intelligenceCtx + audioSystemNote + escalaSystemNote;`;
  construir.parameters.jsCode = construir.parameters.jsCode.replace(oldSistema, newSistema);
  console.log('  Construir Prompt: instruções de escalada adicionadas');

  // ── 3. Adicionar nó Escalada Humano (Code) ─────────────────────────────
  wf.nodes.push({
    id: 'escalada-humano',
    name: 'Escalada Humano',
    type: 'n8n-nodes-base.code',
    typeVersion: 2,
    position: [1850, 500],
    parameters: {
      jsCode: `
// Processar escalada para atendimento humano
// Este nó roda no Done branch do Loop Chunks (após enviar a resposta para o cliente)
const chunks = $('Parsear Chunks').all();
const hasEscalada = chunks.some(i => i.json.escalarHumano === true);
if (!hasEscalada) return [];

const ctx = chunks[0]?.json?.contexto ?? {};
const { instance, telefone, conversation_id, account_id } = ctx;

if (!instance || !telefone) return [];

// Nota privada no Chatwoot para o agente humano
try {
  await fetch('${CW_URL}/api/v1/accounts/' + (account_id || '${CW_ACCOUNT}') + '/conversations/' + conversation_id + '/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'api_access_token': '${CW_TOKEN}' },
    body: JSON.stringify({
      content: '🤖 IA transferiu para atendimento humano. Aguardando atendente.',
      message_type: 'outgoing',
      private: true,
    }),
  });
} catch (e) {}

return [{
  json: {
    takeover_key: 'human_takeover:' + instance + ':' + telefone,
    takeover_value: 'escalado',
    conversation_id: String(conversation_id),
    account_id: String(account_id || '${CW_ACCOUNT}'),
  },
}];
`,
    },
  });

  // ── 4. Adicionar Redis SET Takeover Escalada ────────────────────────────
  wf.nodes.push({
    id: 'redis-set-takeover-escalada',
    name: 'Redis SET Takeover Escalada',
    type: 'n8n-nodes-base.redis',
    typeVersion: 1,
    position: [2090, 500],
    parameters: {
      operation: 'set',
      key: '={{ $json.takeover_key }}',
      value: '={{ $json.takeover_value }}',
      expire: true,
      ttl: 86400, // 24h
    },
    credentials: { redis: { id: REDIS_CRED, name: 'Redis Vendly' } },
  });

  // ── 5. Conectar Loop Chunks Done branch → Escalada Humano → Redis ───────
  // Loop Chunks Done branch (main[1]) → Escalada Humano
  wf.connections['Loop Chunks'].main[1] = [{ node: 'Escalada Humano', type: 'main', index: 0 }];

  // Escalada Humano → Redis SET Takeover Escalada
  wf.connections['Escalada Humano'] = {
    main: [[{ node: 'Redis SET Takeover Escalada', type: 'main', index: 0 }]],
  };
  console.log('  Conexão: Loop Chunks Done → Escalada Humano → Redis SET Takeover Escalada');

  const updated = await putWorkflow(EXECUTOR_ID, wf);
  console.log(`  ✓ [AGENT] Executor atualizado. Nós: ${updated.nodes?.length}`);
}

// ═══════════════════════════════════════════════════════════════════════════
(async () => {
  try {
    await fixCoreEntrada();
    await fixAutoOpen();
    await addEscalationToExecutor();

    console.log('\n✓ Todas as correções aplicadas!');
    console.log('  → Bot retoma após resolve (Redis human_takeover ao invés de assignee)');
    console.log('  → Chatwoot unassign automático ao resolver conversa');
    console.log('  → IA pode escalar com [ESCALAR_HUMANO] no início da resposta');
  } catch (e) {
    console.error('\nErro:', e.message);
    process.exit(1);
  }
})();

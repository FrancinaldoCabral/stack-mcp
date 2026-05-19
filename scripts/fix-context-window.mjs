/**
 * Adiciona gerenciamento de janela de contexto ao Agent Executor:
 * - Verificar Janela de Contexto: estima tokens do histórico
 * - IF Precisa Resumir?: threshold 500k tokens (50% de 1M)
 * - Preparar Resumo: formata conversa para summarização
 * - OpenRouter Resumo: chama Gemini para resumir 30% mais antigos
 * - Comprimir Histórico: substitui mensagens antigas pelo resumo
 * - Mesclar Histórico: ponto único que alimenta Gerar Embedding
 */
import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dir = path.dirname(fileURLToPath(import.meta.url));
const env = {};
readFileSync(path.join(__dir, '../.env'), 'utf8').split('\n').forEach(l => {
  const q = l.indexOf('=');
  if (q > 0 && !l.startsWith('#')) env[l.slice(0, q).trim()] = l.slice(q + 1).trim();
});

const BASE = 'https://workflows.vendly.chat/api/v1';
const h = { 'X-N8N-API-KEY': env.N8N_API_KEY, 'Accept': 'application/json', 'Content-Type': 'application/json' };
const get = url => fetch(url, { headers: h }).then(r => r.json());

const WF = 'jleu4RPvSnYDL8Gd';
const w = await get(`${BASE}/workflows/${WF}`);

// ── Posições de referência ────────────────────────────────────────────────────
const redisGetNode = w.nodes.find(n => n.name === 'Redis GET Sessao');
const gerarEmbNode = w.nodes.find(n => n.name === 'Gerar Embedding');
const baseX = redisGetNode.position[0];
const baseY = redisGetNode.position[1];

// ── Novos nós ─────────────────────────────────────────────────────────────────
const novosNos = [
  {
    id: 'verificar-janela',
    name: 'Verificar Janela de Contexto',
    type: 'n8n-nodes-base.code',
    typeVersion: 2,
    position: [baseX + 220, baseY],
    parameters: {
      jsCode: `// Lê histórico e verifica se precisa de compressão
const sessao = $input.first().json;
let historico = [];
try {
  const raw = sessao.value ?? null;
  if (typeof raw === 'string') historico = JSON.parse(raw);
  else if (Array.isArray(raw)) historico = raw;
} catch {}

// Estima tokens: ~3.5 chars/token (conservador para pt-BR com timestamps)
const totalChars = historico.reduce((acc, m) => {
  const c = typeof m.content === 'string' ? m.content : JSON.stringify(m.content ?? '');
  return acc + c.length;
}, 0);
const estimatedTokens = Math.ceil(totalChars / 3.5);

// 500k = 50% de 1M (deixa 50% para system prompt, msgs atuais e resposta)
const THRESHOLD = 500_000;
const COMPRESS_RATIO = 0.30; // comprimir 30% mais antigas

const needsSummarize = estimatedTokens > THRESHOLD && historico.length >= 20;
const compressCount = needsSummarize ? Math.floor(historico.length * COMPRESS_RATIO) : 0;

return [{ json: { historico, needsSummarize, compressCount, estimatedTokens } }];`,
    },
  },
  {
    id: 'if-resumir',
    name: 'IF Precisa Resumir?',
    type: 'n8n-nodes-base.if',
    typeVersion: 2,
    position: [baseX + 440, baseY],
    parameters: {
      conditions: {
        options: { caseSensitive: true, leftValue: '', typeValidation: 'strict' },
        conditions: [
          {
            id: 'cond1',
            leftValue: '={{ $json.needsSummarize }}',
            rightValue: true,
            operator: { type: 'boolean', operation: 'equals', singleValue: true },
          },
        ],
        combinator: 'and',
      },
    },
  },
  {
    id: 'preparar-resumo',
    name: 'Preparar Resumo',
    type: 'n8n-nodes-base.code',
    typeVersion: 2,
    position: [baseX + 660, baseY - 120],
    parameters: {
      jsCode: `// Prepara payload para resumir as mensagens mais antigas
const { historico, compressCount } = $input.first().json;
const oldest = historico.slice(0, compressCount);
const remaining = historico.slice(compressCount);

// Formatar conversa para summarização
const conversation = oldest.map(m => {
  const role = m.role === 'user' ? 'Cliente' : m.role === 'assistant' ? 'Assistente' : 'Sistema';
  const content = typeof m.content === 'string' ? m.content : '[conteúdo não-textual]';
  return role + ': ' + content;
}).join('\\n');

const openrouterBody = {
  model: 'google/gemini-2.5-flash-preview',
  messages: [
    {
      role: 'system',
      content: 'Resuma esta conversa em português. Preserve: nome do cliente (se mencionado), preferências expressas, problemas relatados, decisões tomadas, datas/horários importantes, informações de pedidos ou produtos, e qualquer fato relevante para o atendimento futuro. Seja conciso (máximo 400 palavras).'
    },
    { role: 'user', content: conversation }
  ],
  max_tokens: 600,
};

return [{ json: { openrouterBody, remaining, compressCount } }];`,
    },
  },
  {
    id: 'openrouter-resumo',
    name: 'OpenRouter Resumo',
    type: 'n8n-nodes-base.httpRequest',
    typeVersion: 4.2,
    position: [baseX + 880, baseY - 120],
    parameters: {
      method: 'POST',
      url: 'https://openrouter.ai/api/v1/chat/completions',
      authentication: 'genericCredentialType',
      genericAuthType: 'httpHeaderAuth',
      sendBody: true,
      specifyBody: 'json',
      jsonBody: '={{ JSON.stringify($json.openrouterBody) }}',
      options: { response: { response: { neverError: true } } },
    },
    credentials: { httpHeaderAuth: { id: 'H0XlPAbxjEUzplW4', name: 'OpenRouter' } },
  },
  {
    id: 'comprimir-historico',
    name: 'Comprimir Histórico',
    type: 'n8n-nodes-base.code',
    typeVersion: 2,
    position: [baseX + 1100, baseY - 120],
    parameters: {
      jsCode: `// Monta histórico com resumo + mensagens recentes
const resp = $input.first().json;
const { remaining, compressCount } = $('Preparar Resumo').first().json;

const summary = resp.choices?.[0]?.message?.content ?? '';

let historico;
if (summary) {
  historico = [
    { role: 'system', content: '[RESUMO — ' + compressCount + ' mensagens anteriores comprimidas]: ' + summary },
    ...remaining,
  ];
} else {
  // Fallback: descarta as mais antigas sem resumo (evita context overflow)
  historico = remaining;
}

return [{ json: { historico } }];`,
    },
  },
  {
    id: 'mesclar-historico',
    name: 'Mesclar Histórico',
    type: 'n8n-nodes-base.code',
    typeVersion: 2,
    position: [baseX + 1100, baseY],
    parameters: {
      jsCode: `// Passthrough — recebe do caminho comprimido OU do caminho direto
// O item chegando sempre tem { historico: [...] }
return [$input.first()];`,
    },
  },
];

// ── Adicionar nós ao workflow ─────────────────────────────────────────────────
novosNos.forEach(n => {
  if (!w.nodes.find(existing => existing.name === n.name)) {
    w.nodes.push(n);
    console.log('+ Nó adicionado:', n.name);
  } else {
    // Atualiza se já existe
    const idx = w.nodes.findIndex(existing => existing.name === n.name);
    w.nodes[idx] = { ...w.nodes[idx], ...n };
    console.log('~ Nó atualizado:', n.name);
  }
});

// ── Conexões ─────────────────────────────────────────────────────────────────
const conn = w.connections;

// Remover: Redis GET Sessao → Gerar Embedding
if (conn['Redis GET Sessao']?.main?.[0]) {
  conn['Redis GET Sessao'].main[0] = conn['Redis GET Sessao'].main[0].filter(t => t.node !== 'Gerar Embedding');
}

// Redis GET Sessao → Verificar Janela de Contexto
if (!conn['Redis GET Sessao']) conn['Redis GET Sessao'] = { main: [[]] };
if (!conn['Redis GET Sessao'].main[0].some(t => t.node === 'Verificar Janela de Contexto')) {
  conn['Redis GET Sessao'].main[0].push({ node: 'Verificar Janela de Contexto', type: 'main', index: 0 });
}

// Verificar Janela → IF Precisa Resumir?
conn['Verificar Janela de Contexto'] = { main: [[{ node: 'IF Precisa Resumir?', type: 'main', index: 0 }]] };

// IF Precisa Resumir? → TRUE → Preparar Resumo
// IF Precisa Resumir? → FALSE → Mesclar Histórico
conn['IF Precisa Resumir?'] = {
  main: [
    [{ node: 'Preparar Resumo', type: 'main', index: 0 }],       // output 0 = TRUE
    [{ node: 'Mesclar Histórico', type: 'main', index: 0 }],     // output 1 = FALSE
  ],
};

// Preparar Resumo → OpenRouter Resumo → Comprimir Histórico → Mesclar Histórico
conn['Preparar Resumo'] = { main: [[{ node: 'OpenRouter Resumo', type: 'main', index: 0 }]] };
conn['OpenRouter Resumo'] = { main: [[{ node: 'Comprimir Histórico', type: 'main', index: 0 }]] };
conn['Comprimir Histórico'] = { main: [[{ node: 'Mesclar Histórico', type: 'main', index: 0 }]] };

// Mesclar Histórico → Gerar Embedding
conn['Mesclar Histórico'] = { main: [[{ node: 'Gerar Embedding', type: 'main', index: 0 }]] };

// Remover: MongoDB GET Cliente → Redis GET Sessao → Gerar Embedding (a conexão para Gerar Embedding já foi removida acima)
// Garantir que MongoDB GET Cliente → Redis GET Sessao ainda existe
if (!conn['MongoDB GET Cliente']?.main?.[0]?.some(t => t.node === 'Redis GET Sessao')) {
  if (!conn['MongoDB GET Cliente']) conn['MongoDB GET Cliente'] = { main: [[]] };
  conn['MongoDB GET Cliente'].main[0].push({ node: 'Redis GET Sessao', type: 'main', index: 0 });
}

// ── Atualizar Construir Prompt para ler de Mesclar Histórico ─────────────────
const cpNode = w.nodes.find(n => n.name === 'Construir Prompt');
// Redirecionar leitura da sessão: Redis GET Sessao → Mesclar Histórico
// (mantém o nome da variável `sessao` para não quebrar outras referências)
cpNode.parameters.jsCode = cpNode.parameters.jsCode
  .replace(
    "const sessao = $('Redis GET Sessao').first().json;",
    "const sessao = $('Mesclar Histórico').first().json;"
  )
  // Substituir o bloco de parse do histórico — agora vem diretamente como campo `historico`
  .replace(
    /\/\/ Histórico de sessão\nlet historico = \[\];\ntry \{\n[\s\S]*?\} catch \{\}/,
    `// Histórico de sessão (já processado/comprimido por Mesclar Histórico)\nconst historico = sessao.historico ?? [];`
  );

console.log('✓ Construir Prompt atualizado para ler de Mesclar Histórico');

// ── Salvar workflow ───────────────────────────────────────────────────────────
const body = {
  name: w.name,
  nodes: w.nodes,
  connections: conn,
  settings: { executionOrder: 'v1', saveManualExecutions: true },
};

const res = await fetch(`${BASE}/workflows/${WF}`, {
  method: 'PUT',
  headers: h,
  body: JSON.stringify(body),
});
const updated = await res.json();
if (!updated.id) {
  console.error('❌ Erro:', JSON.stringify(updated).slice(0, 300));
  process.exit(1);
}
console.log('\n✅ Context window management adicionado ao workflow');

// ── Verificação ───────────────────────────────────────────────────────────────
const wCheck = await get(`${BASE}/workflows/${WF}`);
console.log('\n=== Verificação ===');
const nomes = ['Verificar Janela de Contexto', 'IF Precisa Resumir?', 'Preparar Resumo', 'OpenRouter Resumo', 'Comprimir Histórico', 'Mesclar Histórico'];
nomes.forEach(nome => {
  const exists = wCheck.nodes.some(n => n.name === nome);
  console.log(nome + ':', exists ? 'OK' : 'FALTANDO');
});
// Verificar conexão Redis → Verificar Janela
const redisConn = wCheck.connections['Redis GET Sessao']?.main?.[0] ?? [];
console.log('Redis → Verificar Janela:', redisConn.some(t => t.node === 'Verificar Janela de Contexto') ? 'OK' : 'FALTANDO');
// Verificar se Gerar Embedding ainda está conectado
const gerarConn = wCheck.connections['Mesclar Histórico']?.main?.[0] ?? [];
console.log('Mesclar → Gerar Embedding:', gerarConn.some(t => t.node === 'Gerar Embedding') ? 'OK' : 'FALTANDO');
const cpCheck = wCheck.nodes.find(n => n.name === 'Construir Prompt');
console.log("Construir Prompt lê 'Mesclar Histórico':", cpCheck.parameters.jsCode.includes("$('Mesclar Histórico')") ? 'OK' : 'FALTANDO');

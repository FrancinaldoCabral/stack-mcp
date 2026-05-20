/**
 * fix-executor.mjs
 * 1. Mostra modelos atuais nos nós OpenRouter
 * 2. Adiciona: redis-get-agente + if-tem-agente antes do fluxo principal
 * 3. Atualiza build-prompt para ler config do agente (Redis) em vez do businessDoc
 * 4. Corrige modelo padrão para google/gemini-2.5-flash-lite em todos os nós OpenRouter
 */
import 'dotenv/config';
import { readFile } from 'fs/promises';

const N8N = process.env.N8N_URL;
const KEY = process.env.N8N_API_KEY;
const WF_ID = 'jleu4RPvSnYDL8Gd';

const h = { 'X-N8N-API-KEY': KEY, 'Accept': 'application/json', 'Content-Type': 'application/json' };

async function get(path) {
  const r = await fetch(`${N8N}/api/v1${path}`, { headers: h });
  return r.json();
}

async function put(path, body) {
  const r = await fetch(`${N8N}/api/v1${path}`, { method: 'PUT', headers: h, body: JSON.stringify(body) });
  const j = await r.json();
  if (r.status >= 400) throw new Error(`PUT ${path} → ${r.status}: ${JSON.stringify(j)}`);
  return j;
}

const wf = await get(`/workflows/${WF_ID}`);
const nodes = wf.nodes;
const conns = wf.connections;

// ── 1. Mostrar modelos atuais ──────────────────────────────────────────────────
console.log('\n=== Modelos OpenRouter atuais ===');
nodes.filter(n => n.type === 'n8n-nodes-base.httpRequest' && n.id.includes('openrouter'))
  .forEach(n => {
    const body = n.parameters.jsonBody ?? '';
    const m = body.match(/model[^,\n}]{0,80}/);
    console.log(` ${n.id}: ${m?.[0] ?? '(não encontrado)'}`);
  });

// ── 2. Localizar nós relevantes ───────────────────────────────────────────────
const unwrap   = nodes.find(n => n.id === 'unwrap-payload');
const buildPr  = nodes.find(n => n.id === 'build-prompt');
const openrLLM = nodes.find(n => n.id === 'openrouter-llm');
const openrRes = nodes.find(n => n.id === 'openrouter-resumo');
const openrFer = nodes.find(n => n.id === 'openrouter-com-ferramenta');

// ── 3. Adicionar redis-get-agente (GET agente:{instance}) ─────────────────────
const redisCredId = nodes.find(n => n.type === 'n8n-nodes-base.redis')?.credentials?.redis?.id ?? '';
const redisCredName = nodes.find(n => n.type === 'n8n-nodes-base.redis')?.credentials?.redis?.name ?? 'Redis Vendly';

// Verificar se nós já existem (idempotente)
const existsGetAgente = nodes.find(n => n.id === 'redis-get-agente');
const existsIfAgente  = nodes.find(n => n.id === 'if-tem-agente');
const existsParseAgt  = nodes.find(n => n.id === 'parse-agente');

if (existsGetAgente) {
  console.log('\n[INFO] Nós de agente já existem. Apenas corrigindo modelos e build-prompt.');
} else {
  console.log('\n[INFO] Adicionando nós redis-get-agente, if-tem-agente, parse-agente...');

  const posX = unwrap.position[0] + 240;
  const posY = unwrap.position[1] - 120;

  // redis-get-agente
  nodes.push({
    id: 'redis-get-agente',
    name: 'Redis GET Agente',
    type: 'n8n-nodes-base.redis',
    typeVersion: 1,
    position: [posX, posY],
    parameters: {
      operation: 'get',
      key: "={{ 'agente:' + $('Desembalar Payload').first().json.instance }}",
      propertyName: 'value',
      options: {},
    },
    credentials: { redis: { id: redisCredId, name: redisCredName } },
  });

  // if-tem-agente
  nodes.push({
    id: 'if-tem-agente',
    name: 'IF Tem Agente?',
    type: 'n8n-nodes-base.if',
    typeVersion: 2,
    position: [posX + 240, posY],
    parameters: {
      conditions: {
        options: { caseSensitive: true, leftValue: '', typeValidation: 'strict' },
        conditions: [{
          id: 'cond-agente',
          leftValue: "={{ $json.value }}",
          rightValue: '',
          operator: { type: 'string', operation: 'notEmpty' },
        }],
        combinator: 'and',
      },
      looseTypeValidation: true,
    },
  });

  // parse-agente (Code node — parse JSON do Redis)
  nodes.push({
    id: 'parse-agente',
    name: 'Parse Agente Config',
    type: 'n8n-nodes-base.code',
    typeVersion: 2,
    position: [posX + 480, posY],
    parameters: {
      jsCode: "const raw = $input.first().json.value;\nconst cfg = raw ? JSON.parse(raw) : {};\nreturn [{ json: cfg }];",
    },
  });

  // ── Conexões: unwrap → redis-get-agente → if-tem-agente (true) → parse-agente
  if (!conns['Desembalar Payload']) conns['Desembalar Payload'] = { main: [[]] };

  conns['Desembalar Payload'].main[0].push({ node: 'Redis GET Agente', type: 'main', index: 0 });

  conns['Redis GET Agente'] = { main: [[{ node: 'IF Tem Agente?', type: 'main', index: 0 }]] };
  conns['IF Tem Agente?']   = { main: [
    [{ node: 'Parse Agente Config', type: 'main', index: 0 }], // true → continua
    [],                                                          // false → para
  ]};
  conns['Parse Agente Config'] = { main: [[]] }; // sem saída direta (build-prompt usa $() ref)
}

// ── 4. Corrigir modelo em todos os nós OpenRouter ────────────────────────────
const DEFAULT_MODEL = 'google/gemini-2.5-flash-lite';

function fixModel(node) {
  if (!node) return;
  const body = node.parameters.jsonBody ?? '';
  // Substitui qualquer hardcode de model por fallback correto
  const fixed = body
    .replace(/model:\s*['"][^'"]+['"]/g, `model: $json.model ?? '${DEFAULT_MODEL}'`)
    .replace(/model:\s*\$json\.model\s*\?\?\s*['"][^'"]+['"]/g, `model: $json.model ?? '${DEFAULT_MODEL}'`);
  node.parameters.jsonBody = fixed;
  console.log(`[FIX] ${node.id} model → ok`);
}
fixModel(openrLLM);
fixModel(openrRes);
fixModel(openrFer);

// ── 5. Atualizar build-prompt para ler agente do Redis ────────────────────────
const NEW_BUILD_PROMPT_CODE = `const msg = $('Desembalar Payload').first().json;
const sessao = $('Mesclar Histórico').first().json;

// Config do AGENTE (Redis agente:{instance}) — obrigatório
const agenteRaw = $('Redis GET Agente').first()?.json?.value ?? null;
const agente = agenteRaw ? JSON.parse(agenteRaw) : null;
if (!agente) return []; // sem agente configurado — abandona

const customSystemPrompt = agente.systemPrompt || '';
const nomeAssistente = agente.assistantName || 'Assistente';
const modeloLLM = agente.model || '${DEFAULT_MODEL}';

// Perfil do cliente do MongoDB
const clienteDoc = $('MongoDB GET Cliente').first().json ?? {};
const hasCustomer = !!(clienteDoc._id || clienteDoc.name);

// Data e hora atual (fuso de São Paulo)
const agora = new Date();
const dataHora = agora.toLocaleString('pt-BR', {
  timeZone: 'America/Sao_Paulo',
  weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric',
  hour: '2-digit', minute: '2-digit',
});

// Blocos de inteligência do Qdrant
const qdrantBlocks = ($('Qdrant Search Contexto').first()?.json?.result ?? [])
  .filter(r => (r.score ?? 0) >= 0.4)
  .map(r => r.payload?.content ?? '')
  .filter(Boolean);
const intelligenceCtx = qdrantBlocks.length > 0
  ? '\\n\\n## Base de Conhecimento:\\n' + qdrantBlocks.map((b, i) => \`\${i+1}. \${b}\`).join('\\n')
  : '';

// Histórico de sessão
const historico = sessao.historico ?? [];

// Contexto do cliente
const nomeCliente = clienteDoc.name || null;
const customerCtx = hasCustomer && nomeCliente
  ? \`\\nCliente registrado: \${nomeCliente} | interações: \${clienteDoc.conversation_count || 0}\${clienteDoc.profile?.notes ? '. Notas: ' + clienteDoc.profile.notes : ''}\`
  : '';

// System prompt
const defaultPrompt = \`Você é \${nomeAssistente}, atendente de WhatsApp.\\nData e hora atual: \${dataHora}\`;
const sistemaPrompt = (customSystemPrompt || defaultPrompt) + customerCtx + intelligenceCtx;

// Timestamp da mensagem
const msgTs = msg.timestamp
  ? new Date(msg.timestamp * 1000).toLocaleString('pt-BR', {
      timeZone: 'America/Sao_Paulo',
      hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit', year: 'numeric',
    })
  : null;

const tsPrefix = msgTs ? \`[\${msgTs}] \` : '';
let userContent;
if (msg.tipo === 'imagem' && msg.metadata?.url) {
  userContent = [
    { type: 'text', text: tsPrefix + (msg.conteudo || 'O cliente enviou uma imagem. Analise e responda:') },
    { type: 'image_url', image_url: { url: msg.metadata.url } },
  ];
} else if (msg.tipo === 'audio') {
  userContent = tsPrefix + '[mensagem de voz recebida] Peça educadamente ao cliente que envie a mensagem em texto.';
} else if (msg.tipo === 'documento') {
  userContent = tsPrefix + \`[documento: \${msg.metadata?.fileName || msg.conteudo}]\`;
} else if (msg.tipo === 'video') {
  userContent = tsPrefix + '[vídeo recebido] Informe ao cliente que não consegue visualizar vídeos e peça que descreva o conteúdo.';
} else {
  userContent = tsPrefix + (msg.conteudo || '');
}

const messages = [
  { role: 'system', content: sistemaPrompt },
  ...historico,
  { role: 'user', content: userContent },
];

return [{ json: { messages, model: modeloLLM, instance: msg.instance, telefone: msg.telefone, tipo: msg.tipo } }];
`;

buildPr.parameters.jsCode = NEW_BUILD_PROMPT_CODE;
console.log('[FIX] build-prompt → lê agente do Redis');

// ── 6. Salvar workflow ────────────────────────────────────────────────────────
console.log('\nSalvando workflow...');
await put(`/workflows/${WF_ID}`, {
  name: wf.name,
  nodes,
  connections: conns,
  settings: { executionOrder: 'v1', saveManualExecutions: true },
});
console.log('✓ Workflow atualizado com sucesso!');

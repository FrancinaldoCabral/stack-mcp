/**
 * Fix dois problemas do Agent Executor:
 * 1. Sessão nunca salva: SplitInBatches typeVersion 1 tem bug no Done branch.
 *    Solução: conectar Parsear Chunks → Preparar Sessao diretamente (em paralelo com o loop)
 *    e remover a conexão do Done branch do Loop Chunks.
 * 2. System prompt confuso: injetava pushName como "Nome do cliente" e expunha Instância.
 *    Solução: reformular para ser dica, não verdade absoluta, e instruir a usar nome da conversa.
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

const WF_AGENT = 'jleu4RPvSnYDL8Gd';

const w = await get(`${BASE}/workflows/${WF_AGENT}`);

// ── 1. Consertar conexões ─────────────────────────────────────────────────────
const conn = w.connections;

// REMOVER: Loop Chunks → Preparar Sessao (output 1 / done branch — nunca dispara no typeVersion 1)
if (conn['Loop Chunks']?.main?.[1]) {
  conn['Loop Chunks'].main[1] = conn['Loop Chunks'].main[1].filter(t => t.node !== 'Preparar Sessao');
  console.log('✓ Removida conexão Loop Chunks (done) → Preparar Sessao');
}

// ADICIONAR: Parsear Chunks → Preparar Sessao (em paralelo com IF Responder com Audio?)
if (!conn['Parsear Chunks']) conn['Parsear Chunks'] = { main: [[]] };
if (!conn['Parsear Chunks'].main[0]) conn['Parsear Chunks'].main[0] = [];

const jaSalva = conn['Parsear Chunks'].main[0].some(t => t.node === 'Preparar Sessao');
if (!jaSalva) {
  conn['Parsear Chunks'].main[0].push({ node: 'Preparar Sessao', type: 'main', index: 0 });
  console.log('✓ Adicionada conexão Parsear Chunks → Preparar Sessao');
}

// ── 2. Consertar system prompt no Construir Prompt ───────────────────────────
const cpNode = w.nodes.find(n => n.name === 'Construir Prompt');
if (!cpNode) throw new Error('Nó Construir Prompt não encontrado');

const novoPromptCode = `// Fontes: Desembalar Payload, Redis GET Sessao, MongoDB GET Business, MongoDB GET Cliente, Qdrant Search
const msg = $('Desembalar Payload').first().json;
const sessao = $('Redis GET Sessao').first().json;

// Perfil do cliente do MongoDB (alwaysOutputData: retorna {} se não encontrado)
const clienteDoc = $('MongoDB GET Cliente').first().json ?? {};
const hasCustomer = !!(clienteDoc._id || clienteDoc.name);

// Config do negócio do MongoDB (alwaysOutputData: retorna {} se não encontrado)
const businessDoc = $('MongoDB GET Business').first().json ?? {};
const customSystemPrompt = businessDoc.systemPrompt || '';

// Blocos de inteligência do Qdrant (neverError: true — retorna {} se falhar)
const qdrantBlocks = ($('Qdrant Search Contexto').first()?.json?.result ?? [])
  .filter(r => (r.score ?? 0) >= 0.4)
  .map(r => r.payload?.content ?? '')
  .filter(Boolean);
const intelligenceCtx = qdrantBlocks.length > 0
  ? '\\n\\n## Base de Conhecimento:\\n' + qdrantBlocks.map((b, i) => \`\${i+1}. \${b}\`).join('\\n')
  : '';

// Histórico de sessão
let historico = [];
try {
  const raw = sessao.value ?? null;
  if (typeof raw === 'string') historico = JSON.parse(raw);
  else if (Array.isArray(raw)) historico = raw;
} catch {}

// Contexto do cliente (do MongoDB se disponível)
const nomeCliente = clienteDoc.name || null;
const customerCtx = hasCustomer && nomeCliente
  ? \`\\nInformação do cliente: nome registrado = \${nomeCliente} | interações anteriores = \${clienteDoc.conversation_count || 0}.\${clienteDoc.profile?.notes ? ' Notas: ' + clienteDoc.profile.notes : ''}\`
  : '';

// System prompt
// IMPORTANTE: pushName é o apelido/usuário WhatsApp, não necessariamente o nome real.
// O cliente pode ter se apresentado com um nome diferente — use o que ele disse na conversa.
const defaultPrompt = \`Você é um assistente de atendimento. Responda em português, de forma natural e amigável.
Canal: WhatsApp
Identificador WhatsApp do contato: \${msg.pushName || 'cliente'}

Regras:
- Se o cliente se apresentar com um nome durante a conversa, use esse nome
- O campo "Identificador WhatsApp" é o apelido técnico da conta, não necessariamente o nome real
- Divida respostas longas em múltiplas mensagens curtas (máximo 3 parágrafos por mensagem)
- Use emojis com moderação
- Nunca envie blocos longos de texto de uma vez
- Responda apenas ao que foi perguntado
- Seja natural, como uma conversa de WhatsApp\`;

const sistemaPrompt = (customSystemPrompt || defaultPrompt) + customerCtx + intelligenceCtx;

// Conteúdo multimodal do usuário
let userContent;
if (msg.tipo === 'imagem' && msg.metadata?.url) {
  userContent = [
    { type: 'text', text: msg.conteudo || 'O cliente enviou uma imagem. Analise e responda:' },
    { type: 'image_url', image_url: { url: msg.metadata.url } },
  ];
} else if (msg.tipo === 'audio') {
  userContent = '[mensagem de voz recebida] Peça educadamente ao cliente que envie a mensagem em texto.';
} else if (msg.tipo === 'documento') {
  userContent = \`[documento: \${msg.metadata?.fileName || msg.conteudo}]\`;
} else if (msg.tipo === 'video') {
  userContent = \`[vídeo enviado: \${msg.conteudo}]\`;
} else if (msg.tipo === 'localizacao') {
  userContent = \`[localização: lat=\${msg.metadata?.lat}, lng=\${msg.metadata?.lng}]\`;
} else {
  userContent = msg.conteudo;
}

const messages = [
  { role: 'system', content: sistemaPrompt },
  ...historico.slice(-100),
  { role: 'user', content: userContent },
];

return [{ json: { ...msg, messages, historico, respondWithAudio: false } }];`;

cpNode.parameters.jsCode = novoPromptCode;
console.log('✓ System prompt corrigido: pushName como identificador, não nome do cliente');

// ── 3. Atualizar workflow ─────────────────────────────────────────────────────
const body = {
  name: w.name,
  nodes: w.nodes,
  connections: conn,
  settings: { executionOrder: 'v1', saveManualExecutions: true },
};

const res = await fetch(`${BASE}/workflows/${WF_AGENT}`, {
  method: 'PUT',
  headers: h,
  body: JSON.stringify(body),
});
const updated = await res.json();
if (updated.id) {
  console.log('\n✅ Workflow atualizado com sucesso');
} else {
  console.error('\n❌ Erro ao atualizar:', JSON.stringify(updated).slice(0, 300));
  process.exit(1);
}

// ── 4. Verificação ───────────────────────────────────────────────────────────
const wCheck = await get(`${BASE}/workflows/${WF_AGENT}`);
const cpCheck = wCheck.nodes.find(n => n.name === 'Construir Prompt');
const parsearConn = wCheck.connections['Parsear Chunks']?.main?.[0] ?? [];
const loopDoneConn = wCheck.connections['Loop Chunks']?.main?.[1] ?? [];

console.log('\n=== Verificação ===');
console.log('Parsear Chunks → Preparar Sessao:', parsearConn.some(t => t.node === 'Preparar Sessao') ? 'OK' : 'FALHOU');
console.log('Loop Chunks done → Preparar Sessao removido:', !loopDoneConn.some(t => t.node === 'Preparar Sessao') ? 'OK' : 'FALHOU');
console.log('Construir Prompt sem "Nome do cliente:":', !cpCheck.parameters.jsCode.includes('Nome do cliente:') ? 'OK' : 'FALHOU');
console.log('Construir Prompt sem "Instância:":', !cpCheck.parameters.jsCode.includes('Instância:') ? 'OK' : 'FALHOU');
console.log('Construir Prompt com "Identificador WhatsApp":', cpCheck.parameters.jsCode.includes('Identificador WhatsApp') ? 'OK' : 'FALHOU');

console.log('\n=== Conexões Parsear Chunks ===');
parsearConn.forEach(t => console.log(' ', 'Parsear Chunks ->', t.node));

/**
 * Fix de identidade, memória e data/hora:
 * 1. Construir Prompt: system prompt com identidade clara do assistente + data/hora + timestamp nas mensagens
 * 2. Parsear Chunks: adiciona timestamp nas entradas do histórico (user e assistant)
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

// ── 1. Novo código do Construir Prompt ───────────────────────────────────────
const novoConstruirPrompt = `const msg = $('Desembalar Payload').first().json;
const sessao = $('Redis GET Sessao').first().json;

// Perfil do cliente do MongoDB (alwaysOutputData: retorna {} se não encontrado)
const clienteDoc = $('MongoDB GET Cliente').first().json ?? {};
const hasCustomer = !!(clienteDoc._id || clienteDoc.name);

// Config do negócio do MongoDB (alwaysOutputData: retorna {} se não encontrado)
const businessDoc = $('MongoDB GET Business').first().json ?? {};
const customSystemPrompt = businessDoc.systemPrompt || '';
const nomeAssistente = businessDoc.assistantName || 'Assistente';

// Data e hora atual (fuso de São Paulo)
const agora = new Date();
const dataHora = agora.toLocaleString('pt-BR', {
  timeZone: 'America/Sao_Paulo',
  weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric',
  hour: '2-digit', minute: '2-digit',
});

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

// Contexto do cliente registrado (MongoDB)
const nomeCliente = clienteDoc.name || null;
const customerCtx = hasCustomer && nomeCliente
  ? \`\\nCliente registrado: \${nomeCliente} | interações: \${clienteDoc.conversation_count || 0}\${clienteDoc.profile?.notes ? '. Notas: ' + clienteDoc.profile.notes : ''}\`
  : '';

// System prompt padrão — claro sobre identidade e comportamento
const defaultPrompt = \`Você é um assistente de atendimento chamado \${nomeAssistente}.
Data e hora atual: \${dataHora}
Canal: WhatsApp

IDENTIDADE (regras críticas):
- Você é o ASSISTENTE de atendimento — não é um cliente, não é uma pessoa física
- O username WhatsApp do contato é "\${msg.pushName || 'desconhecido'}" — isso é o apelido técnico da conta, NÃO é o seu nome
- Se perguntarem "é o [qualquer nome] por aí?", responda que você é o \${nomeAssistente}, o assistente de atendimento
- Nunca diga "sou eu" ou "é sim" quando perguntarem se você é uma pessoa específica
- Se o cliente se apresentar com um nome na conversa (ex: "aqui é o João"), use esse nome ao se referir a ele

FORMATO DE RESPOSTA:
- Mensagens curtas e diretas, máximo 2-3 parágrafos por mensagem
- Use emojis com moderação
- Nunca envie blocos longos de texto de uma vez
- Responda apenas ao que foi perguntado
- Seja natural como numa conversa de WhatsApp\`;

const sistemaPrompt = (customSystemPrompt || defaultPrompt) + customerCtx + intelligenceCtx;

// Timestamp da mensagem atual
const msgTs = msg.timestamp
  ? new Date(msg.timestamp * 1000).toLocaleString('pt-BR', {
      timeZone: 'America/Sao_Paulo',
      hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit', year: 'numeric',
    })
  : null;

// Conteúdo multimodal do usuário (com timestamp prefixado)
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
  userContent = tsPrefix + \`[vídeo enviado: \${msg.conteudo}]\`;
} else if (msg.tipo === 'localizacao') {
  userContent = tsPrefix + \`[localização: lat=\${msg.metadata?.lat}, lng=\${msg.metadata?.lng}]\`;
} else {
  userContent = tsPrefix + (msg.conteudo || '');
}

const messages = [
  { role: 'system', content: sistemaPrompt },
  ...historico.slice(-100),
  { role: 'user', content: userContent },
];

return [{ json: { ...msg, messages, historico, respondWithAudio: false } }];`;

// ── 2. Novo código do Parsear Chunks (com timestamp no histórico) ─────────────
const novoParsearChunks = `const promptData = $('Construir Prompt').first().json;
const resp = $input.first().json;

const content = resp.choices?.[0]?.message?.content ?? resp.error?.message ?? 'Desculpe, erro interno.';
const historico = promptData.historico ?? [];
const respondWithAudio = promptData.respondWithAudio ?? false;

const chunks = content
  .split(/\\n+/)
  .map(s => s.trim())
  .filter(s => s.length > 0)
  .flatMap(s => {
    if (s.length <= 180) return [s];
    return s.match(/[^.!?]+[.!?]+/g)?.map(x => x.trim()).filter(Boolean) ?? [s];
  });

// Timestamp de agora (Brasil)
const agora = new Date();
const tsAgora = agora.toLocaleString('pt-BR', {
  timeZone: 'America/Sao_Paulo',
  hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit', year: 'numeric',
});

// Converter conteúdo multimodal em texto para o histórico (URLs de imagem expiram)
const rawUserContent = promptData.messages[promptData.messages.length - 1]?.content;
let userContentForHistory;
if (Array.isArray(rawUserContent)) {
  const textParts = rawUserContent.filter(p => p.type === 'text').map(p => p.text).join(' ');
  userContentForHistory = textParts || '[imagem enviada]';
} else {
  userContentForHistory = typeof rawUserContent === 'string' ? rawUserContent : (promptData.conteudo || '');
}

// Histórico com timestamps
const novoHistorico = [
  ...historico,
  { role: 'user', content: userContentForHistory },
  { role: 'assistant', content: \`[\${tsAgora}] \${content}\` },
].slice(-100);

const contexto = {
  instance: promptData.instance,
  telefone: promptData.telefone,
  remoteJid: promptData.remoteJid,
  historico: novoHistorico,
};

return chunks.map((texto, i) => ({
  json: {
    chunk: texto,
    fullText: content,
    isLast: i === chunks.length - 1,
    respondWithAudio,
    contexto,
    instance: promptData.instance,
    remoteJid: promptData.remoteJid,
    delay: 800 + i * 600,
  }
}));`;

// ── 3. Aplicar no workflow ────────────────────────────────────────────────────
const cpNode = w.nodes.find(n => n.name === 'Construir Prompt');
const pcNode = w.nodes.find(n => n.name === 'Parsear Chunks');

if (!cpNode) throw new Error('Nó Construir Prompt não encontrado');
if (!pcNode) throw new Error('Nó Parsear Chunks não encontrado');

cpNode.parameters.jsCode = novoConstruirPrompt;
pcNode.parameters.jsCode = novoParsearChunks;

console.log('✓ Construir Prompt atualizado (identidade + data/hora + timestamp nas msgs)');
console.log('✓ Parsear Chunks atualizado (timestamp no histórico Redis)');

const body = {
  name: w.name,
  nodes: w.nodes,
  connections: w.connections,
  settings: { executionOrder: 'v1', saveManualExecutions: true },
};

const res = await fetch(`${BASE}/workflows/${WF_AGENT}`, {
  method: 'PUT',
  headers: h,
  body: JSON.stringify(body),
});
const updated = await res.json();
if (!updated.id) {
  console.error('❌ Erro ao atualizar:', JSON.stringify(updated).slice(0, 300));
  process.exit(1);
}
console.log('✅ Workflow atualizado com sucesso');

// ── 4. Verificação ───────────────────────────────────────────────────────────
const wCheck = await get(`${BASE}/workflows/${WF_AGENT}`);
const cpCheck = wCheck.nodes.find(n => n.name === 'Construir Prompt');
const pcCheck = wCheck.nodes.find(n => n.name === 'Parsear Chunks');

console.log('\n=== Verificação ===');
console.log('Identidade no prompt:', cpCheck.parameters.jsCode.includes('IDENTIDADE') ? 'OK' : 'FALHOU');
console.log('Data/hora no prompt:', cpCheck.parameters.jsCode.includes('dataHora') ? 'OK' : 'FALHOU');
console.log('Timestamp nas msgs:', cpCheck.parameters.jsCode.includes('tsPrefix') ? 'OK' : 'FALHOU');
console.log('assistantName do MongoDB:', cpCheck.parameters.jsCode.includes('assistantName') ? 'OK' : 'FALHOU');
console.log('Timestamp no histórico Redis:', pcCheck.parameters.jsCode.includes('tsAgora') ? 'OK' : 'FALHOU');
console.log('Sem "Nome do cliente:":', !cpCheck.parameters.jsCode.includes('Nome do cliente:') ? 'OK' : 'FALHOU');
console.log('Sem "Instância:":', !cpCheck.parameters.jsCode.includes('Instância:') ? 'OK' : 'FALHOU');

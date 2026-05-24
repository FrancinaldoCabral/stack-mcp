import 'dotenv/config';

// Patcha o nó "Construir Prompt" no [AGENT] Executor (jleu4RPvSnYDL8Gd):
// 1. Adiciona ao system prompt que o agente PODE enviar áudio quando solicitado
// 2. Corrige tipo === 'audio': usa msg.conteudo (transcrição) em vez de pedir ao usuário que reenvie
// 3. Move detecção de respondWithAudio para cá (antes de chamar o LLM, não só em Parsear Chunks)

const headers = {
  'X-N8N-API-KEY': process.env.N8N_API_KEY,
  'Accept': 'application/json',
  'Content-Type': 'application/json',
};

const wf = await fetch('https://workflows.vendly.chat/api/v1/workflows/jleu4RPvSnYDL8Gd', { headers })
  .then(r => r.json());

const cp = wf.nodes.find(n => n.name === 'Construir Prompt');
if (!cp) { console.error('Nó "Construir Prompt" não encontrado'); process.exit(1); }

cp.parameters.jsCode = `// Fontes: Desembalar Payload, Redis GET Sessao, MongoDB GET Business, MongoDB GET Cliente, Qdrant Search
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

// Contexto do cliente
const customerCtx = hasCustomer
  ? \`\\nCliente: \${clienteDoc.name || msg.pushName || 'cliente'} | Interações: \${clienteDoc.conversation_count || 0}.\${clienteDoc.profile?.notes ? ' ' + clienteDoc.profile.notes : ''}\`
  : '';

// System prompt (negócio específico ou padrão)
const defaultPrompt = \`Você é um assistente da Vendly. Responda em português, de forma natural e amigável.
Nome do cliente: \${msg.pushName || 'cliente'}
Canal: WhatsApp
Instância: \${msg.instance}
Regras:
- Divida respostas longas em múltiplas mensagens curtas
- Use emojis com moderação
- Nunca envie blocos longos de texto
- Responda apenas ao que foi perguntado
- Quando solicitado em áudio, responda normalmente com texto (o sistema converte automaticamente para áudio via TTS)\`;

const sistemaPrompt = (customSystemPrompt || defaultPrompt) + customerCtx + intelligenceCtx;

// Conteúdo multimodal do usuário
let userContent;
if (msg.tipo === 'imagem' && msg.metadata?.url) {
  userContent = [
    { type: 'text', text: msg.conteudo || 'O cliente enviou uma imagem. Analise e responda:' },
    { type: 'image_url', image_url: { url: msg.metadata.url } },
  ];
} else if (msg.tipo === 'audio') {
  // msg.conteudo contém a transcrição feita pela Normalizar Mensagem via MCP /util/audio-base64
  userContent = (msg.conteudo && msg.conteudo.trim().length > 0)
    ? msg.conteudo
    : '[mensagem de voz recebida — transcrição indisponível]';
} else if (msg.tipo === 'documento') {
  userContent = \`[documento: \${msg.metadata?.fileName || msg.conteudo}]\`;
} else if (msg.tipo === 'video') {
  userContent = \`[vídeo enviado: \${msg.conteudo}]\`;
} else if (msg.tipo === 'localizacao') {
  userContent = \`[localização: lat=\${msg.metadata?.lat}, lng=\${msg.metadata?.lng}]\`;
} else {
  userContent = msg.conteudo;
}

// Detectar pedido de áudio na última mensagem do usuário (texto simples)
const userText = (typeof userContent === 'string' ? userContent : '').toLowerCase();
const respondWithAudio = /(?:manda?|envia?|responde?|fala)\\s+(?:em\\s+|por\\s+|um\\s+|uma?\\s+)?[aá]udio|[aá]udio\\s*(?:por favor|pfv?)?\\s*$|prefiro\\s+[aá]udio|pode\\s+(?:falar|mandar\\s+[aá]udio)|quero\\s+(?:ouvir|[aá]udio)|em\\s+[aá]udio|por\\s+[aá]udio|fala\\s+pra\\s+mim/.test(userText);

const messages = [
  { role: 'system', content: sistemaPrompt },
  ...historico.slice(-100),
  { role: 'user', content: userContent },
];

return [{ json: { ...msg, messages, historico, respondWithAudio } }];`;

const { status, body: result } = await fetch('https://workflows.vendly.chat/api/v1/workflows/jleu4RPvSnYDL8Gd', {
  method: 'PUT',
  headers,
  body: JSON.stringify({
    name: wf.name,
    nodes: wf.nodes,
    connections: wf.connections,
    settings: { executionOrder: 'v1', saveManualExecutions: true },
  }),
}).then(async r => ({ status: r.status, body: await r.json() }));

if (status !== 200) {
  console.error('ERRO', status, JSON.stringify(result).slice(0, 500));
  process.exit(1);
}

const updated = result.nodes.find(n => n.name === 'Construir Prompt');
const code = updated?.parameters?.jsCode ?? '';
console.log('✅ Construir Prompt atualizado');
console.log('  → audio capability rule   :', code.includes('converte automaticamente para áudio') ? 'OK' : 'FALHOU');
console.log('  → audio tipo transcrição  :', code.includes('transcrição feita pela Normalizar') ? 'OK' : 'FALHOU');
console.log('  → respondWithAudio detect :', code.includes('respondWithAudio') ? 'OK' : 'FALHOU');

import 'dotenv/config';

const headers = {
  'X-N8N-API-KEY': process.env.N8N_API_KEY,
  'Accept': 'application/json',
  'Content-Type': 'application/json',
};

// Novo Parsear Chunks — detecta pedido de áudio no texto do usuário,
// limpa recusas do LLM e retorna 1 item único (TTS roda 1x, não por chunk)
const parsearChunksCode = `const promptData = $('Construir Prompt').first().json;
const resp = $input.first().json;

let content = resp.choices?.[0]?.message?.content ?? resp.error?.message ?? 'Desculpe, erro interno.';
const historico = promptData.historico ?? [];

// ── Detectar pedido explícito de áudio na última mensagem do usuário ──────
const lastUserMsg = promptData.messages?.[promptData.messages.length - 1];
const userText = (
  typeof lastUserMsg?.content === 'string' ? lastUserMsg.content :
  Array.isArray(lastUserMsg?.content)
    ? lastUserMsg.content.filter(p => p.type === 'text').map(p => p.text).join(' ')
    : ''
).toLowerCase();

const pedidoAudio = /(?:manda?|envia?|responde?|fala)\\s+(?:em\\s+|por\\s+|um\\s+|uma?\\s+)?[aá]udio|[aá]udio\\s*(?:por favor|pfv?)?\\s*$|prefiro\\s+[aá]udio|pode\\s+(?:falar|mandar\\s+[aá]udio)|quero\\s+(?:ouvir|[aá]udio)|em\\s+[aá]udio|por\\s+[aá]udio|fala\\s+pra\\s+mim/.test(userText);

const respondWithAudio = (promptData.respondWithAudio ?? false) || pedidoAudio;

// ── Timestamp de agora (Brasil) ──────────────────────────────────────────
const agora = new Date();
const tsAgora = agora.toLocaleString('pt-BR', {
  timeZone: 'America/Sao_Paulo',
  hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit', year: 'numeric',
});

// ── Converter conteúdo multimodal em texto para o histórico ─────────────
const rawUserContent = promptData.messages[promptData.messages.length - 1]?.content;
let userContentForHistory;
if (Array.isArray(rawUserContent)) {
  const textParts = rawUserContent.filter(p => p.type === 'text').map(p => p.text).join(' ');
  userContentForHistory = textParts || '[imagem enviada]';
} else {
  userContentForHistory = typeof rawUserContent === 'string' ? rawUserContent : (promptData.conteudo || '');
}

// ── Histórico com timestamps ─────────────────────────────────────────────
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
  businessId: promptData.businessId ?? '',
  conversation_id: promptData.conversation_id ?? '',
  account_id: promptData.account_id ?? '1',
};

// ── Modo ÁUDIO: 1 item único → TTS roda 1x, sem loop de chunks de texto ─
if (respondWithAudio) {
  // Remover frases de recusa do LLM sobre não poder enviar áudio
  const cleanContent = content
    .split(/(?<=[.!?])\\s+/)
    .filter(s => !/(?:não\\s+(?:consigo|posso)\\s+(?:enviar|mandar|gravar|criar|gerar)\\s+[aá]udio|sou\\s+(?:um[a]?\\s+)?(?:assistente|ia|inteligência)\\s+(?:de\\s+)?texto|como\\s+(?:um[a]?\\s+)?(?:assistente|ia).*?texto)/i.test(s))
    .join(' ')
    .trim();
  const audioContent = cleanContent || content;

  return [{
    json: {
      chunk: audioContent,
      fullText: audioContent,
      isLast: true,
      respondWithAudio: true,
      contexto,
      instance: promptData.instance,
      remoteJid: promptData.remoteJid,
      delay: 800,
      conversation_id: promptData.conversation_id ?? '',
      account_id: promptData.account_id ?? '1',
    }
  }];
}

// ── Modo TEXTO: split em chunks normais ──────────────────────────────────
const chunks = content
  .split(/\\n+/)
  .map(s => s.trim())
  .filter(s => s.length > 0)
  .flatMap(s => {
    if (s.length <= 180) return [s];
    return s.match(/[^.!?]+[.!?]+/g)?.map(x => x.trim()).filter(Boolean) ?? [s];
  });

return chunks.map((texto, i) => ({
  json: {
    chunk: texto,
    fullText: content,
    isLast: i === chunks.length - 1,
    respondWithAudio: false,
    contexto,
    instance: promptData.instance,
    remoteJid: promptData.remoteJid,
    delay: 800 + i * 600,
    conversation_id: promptData.conversation_id ?? '',
    account_id: promptData.account_id ?? '1',
  }
}));`;

const wfRes = await fetch('https://workflows.vendly.chat/api/v1/workflows/jleu4RPvSnYDL8Gd', { headers });
const wf = await wfRes.json();

const node = wf.nodes.find(n => n.name === 'Parsear Chunks');
if (!node) { console.error('nó Parsear Chunks não encontrado'); process.exit(1); }

node.parameters.jsCode = parsearChunksCode;

const body = {
  name: wf.name,
  nodes: wf.nodes,
  connections: wf.connections,
  settings: { executionOrder: 'v1', saveManualExecutions: true },
};

const putRes = await fetch('https://workflows.vendly.chat/api/v1/workflows/jleu4RPvSnYDL8Gd', {
  method: 'PUT',
  headers,
  body: JSON.stringify(body),
});
const result = await putRes.json();
console.log(result.id
  ? '✅ Parsear Chunks atualizado — mande "manda um áudio" para testar'
  : JSON.stringify(result));

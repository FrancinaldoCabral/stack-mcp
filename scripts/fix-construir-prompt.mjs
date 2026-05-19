import 'dotenv/config';
import https from 'https';

function req(method, path, body) {
  return new Promise((res, rej) => {
    const u = new URL(process.env.N8N_URL + path);
    const d = body ? JSON.stringify(body) : undefined;
    const opts = {
      hostname: u.hostname,
      path: u.pathname + u.search,
      method,
      headers: {
        'X-N8N-API-KEY': process.env.N8N_API_KEY,
        Accept: 'application/json',
        'Content-Type': 'application/json',
        ...(d ? { 'Content-Length': Buffer.byteLength(d) } : {}),
      },
    };
    const r = https.request(opts, (resp) => {
      let s = '';
      resp.on('data', (x) => (s += x));
      resp.on('end', () => {
        try { res({ status: resp.statusCode, body: JSON.parse(s) }); }
        catch { res({ status: resp.statusCode, body: s }); }
      });
    });
    r.on('error', rej);
    if (d) r.write(d);
    r.end();
  });
}

const { body: wf } = await req('GET', '/api/v1/workflows/jleu4RPvSnYDL8Gd');
const cp = wf.nodes.find((n) => n.name === 'Construir Prompt');

// Novo código: wrap MongoDB refs em try/catch (nodes fora do caminho principal lançam erro quando referenciados)
const newCode = `// Fontes: Desembalar Payload, Redis GET Sessao, Qdrant Search Contexto
// MongoDB GET Business e GET Cliente são opcionais (não estão no caminho principal agora)
const msg = $('Desembalar Payload').first().json;
const sessao = $('Redis GET Sessao').first().json;

// Perfil do cliente do MongoDB (opcional — silencia erro se não executou)
let clienteDoc = {};
try { clienteDoc = $('MongoDB GET Cliente').first()?.json ?? {}; } catch {}
const hasCustomer = !!(clienteDoc._id || clienteDoc.name);

// Config do negócio do MongoDB (opcional)
let businessDoc = {};
try { businessDoc = $('MongoDB GET Business').first()?.json ?? {}; } catch {}
const customSystemPrompt = businessDoc.systemPrompt || '';

// Blocos de inteligência do Qdrant
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
- Responda apenas ao que foi perguntado\`;

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

cp.parameters.jsCode = newCode;

const { status, body: result } = await req('PUT', '/api/v1/workflows/jleu4RPvSnYDL8Gd', {
  name: wf.name,
  nodes: wf.nodes,
  connections: wf.connections,
  settings: { executionOrder: 'v1', saveManualExecutions: true },
});

if (status === 200) {
  const saved = result.nodes.find((n) => n.name === 'Construir Prompt');
  const hasTryCatch = saved?.parameters?.jsCode?.includes('try { clienteDoc');
  console.log('Status: 200 OK');
  console.log('try/catch para MongoDB:', hasTryCatch ? 'OK' : 'FALHOU');
} else {
  console.error('ERRO', status, JSON.stringify(result).slice(0, 500));
}

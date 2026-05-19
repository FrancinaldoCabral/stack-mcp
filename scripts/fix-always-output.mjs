/**
 * Fix profissional do Agent workflow (jleu4RPvSnYDL8Gd):
 *
 * Problema: MongoDB GET Business/Cliente retornam 0 items quando a coleção está
 * vazia, e N8N para a execução. A solução correta e nativa do N8N é usar a
 * propriedade `alwaysOutputData: true` no nó — quando ativa, o nó sempre
 * produz pelo menos 1 item (vazio) mesmo sem resultados.
 *
 * Ações:
 * 1. Remove nós gambiarras "Garantir Fluxo Business/Cliente" adicionados antes
 * 2. Ativa alwaysOutputData: true nos dois nós MongoDB GET
 * 3. Restaura conexões corretas (sem os nós extras)
 * 4. Mantém Redis GET Sessao key usando $('Desembalar Payload') (fix anterior correto)
 * 5. Restaura Construir Prompt para versão limpa (sem try/catch desnecessário)
 */
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

const { status: getStatus, body: wf } = await req('GET', '/api/v1/workflows/jleu4RPvSnYDL8Gd');
if (getStatus !== 200) { console.error('GET failed', getStatus); process.exit(1); }

// ─── 1. Remover nós gambiarra "Garantir Fluxo" ────────────────────────────────
const antes = wf.nodes.length;
wf.nodes = wf.nodes.filter((n) => !n.name.startsWith('Garantir Fluxo'));
console.log(`Nós removidos: ${antes - wf.nodes.length} (Garantir Fluxo Business/Cliente)`);

// ─── 2. Ativar alwaysOutputData nos MongoDB GET ───────────────────────────────
const mongoBiz = wf.nodes.find((n) => n.name === 'MongoDB GET Business');
const mongoCliente = wf.nodes.find((n) => n.name === 'MongoDB GET Cliente');
mongoBiz.alwaysOutputData = true;
mongoCliente.alwaysOutputData = true;
console.log('alwaysOutputData: true em MongoDB GET Business e MongoDB GET Cliente');

// ─── 3. Restaurar conexões corretas ──────────────────────────────────────────
// Desembalar Payload → MongoDB GET Business
wf.connections['Desembalar Payload'] = {
  main: [[{ node: 'MongoDB GET Business', type: 'main', index: 0 }]],
};
// MongoDB GET Business → MongoDB GET Cliente
wf.connections['MongoDB GET Business'] = {
  main: [[{ node: 'MongoDB GET Cliente', type: 'main', index: 0 }]],
};
// MongoDB GET Cliente → Redis GET Sessao
wf.connections['MongoDB GET Cliente'] = {
  main: [[{ node: 'Redis GET Sessao', type: 'main', index: 0 }]],
};
// Limpar conexões dos nós removidos
delete wf.connections['Garantir Fluxo Business'];
delete wf.connections['Garantir Fluxo Cliente'];
console.log('Conexões restauradas: Desembalar Payload → MongoDB GET Business → MongoDB GET Cliente → Redis GET Sessao');

// ─── 4. Redis GET Sessao: manter key usando $('Desembalar Payload') ───────────
// (já foi corrigido no fix anterior — verificar e manter)
const redisGet = wf.nodes.find((n) => n.name === 'Redis GET Sessao');
redisGet.parameters.key =
  "={{ 'sessao:' + $('Desembalar Payload').first().json.instance + ':' + $('Desembalar Payload').first().json.telefone }}";

// ─── 5. Restaurar Construir Prompt: limpo, sem try/catch desnecessário ────────
// Com alwaysOutputData, $('MongoDB GET Business').first().json existe sempre (pode ser {})
const construirPrompt = wf.nodes.find((n) => n.name === 'Construir Prompt');
construirPrompt.parameters.jsCode = `// Fontes: Desembalar Payload, Redis GET Sessao, MongoDB GET Business, MongoDB GET Cliente, Qdrant Search
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

// ─── 6. Salvar ────────────────────────────────────────────────────────────────
const { status, body: result } = await req('PUT', '/api/v1/workflows/jleu4RPvSnYDL8Gd', {
  name: wf.name,
  nodes: wf.nodes,
  connections: wf.connections,
  settings: { executionOrder: 'v1', saveManualExecutions: true },
});

if (status !== 200) {
  console.error('ERRO', status, JSON.stringify(result).slice(0, 500));
  process.exit(1);
}

// ─── 7. Verificar ─────────────────────────────────────────────────────────────
const biz = result.nodes.find((n) => n.name === 'MongoDB GET Business');
const cli = result.nodes.find((n) => n.name === 'MongoDB GET Cliente');
const rg = result.nodes.find((n) => n.name === 'Redis GET Sessao');
const cp = result.nodes.find((n) => n.name === 'Construir Prompt');
const gambiarra = result.nodes.filter((n) => n.name.startsWith('Garantir Fluxo'));

console.log('\n=== Verificação ===');
console.log('MongoDB GET Business alwaysOutputData:', biz.alwaysOutputData === true ? 'OK' : 'FALHOU');
console.log('MongoDB GET Cliente alwaysOutputData :', cli.alwaysOutputData === true ? 'OK' : 'FALHOU');
console.log('Redis GET Sessao key $() ref         :', rg.parameters.key.includes("$('Desembalar Payload')") ? 'OK' : 'FALHOU');
console.log('Construir Prompt sem try/catch        :', !cp.parameters.jsCode.includes('try { clienteDoc') ? 'OK' : 'FALHOU');
console.log('Nós gambiarra removidos               :', gambiarra.length === 0 ? 'OK' : 'AINDA EXISTEM: ' + gambiarra.map((n) => n.name).join(', '));

console.log('\n=== Caminho principal ===');
const conn = result.connections;
['Desembalar Payload', 'MongoDB GET Business', 'MongoDB GET Cliente', 'Redis GET Sessao', 'Gerar Embedding', 'Qdrant Search Contexto', 'Construir Prompt'].forEach((n) => {
  console.log(' ', n, '->', conn[n]?.main?.[0]?.[0]?.node ?? '(fim)');
});

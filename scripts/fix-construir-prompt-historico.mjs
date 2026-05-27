import 'dotenv/config';
import axios from 'axios';

const base = 'https://workflows.vendly.chat/api/v1';
const headers = { 'X-N8N-API-KEY': process.env.N8N_API_KEY };

const wf = (await axios.get(`${base}/workflows/jleu4RPvSnYDL8Gd`, { headers })).data;

const node = wf.nodes.find(n => n.name === 'Construir Prompt');

const oldBlock = `let sessao = {}; try { sessao = $('Redis GET Sessao').first()?.json ?? {}; } catch {}`;
if (!node.parameters.jsCode.includes(oldBlock)) {
  console.error('[ERRO] bloco sessao não encontrado'); process.exit(1);
}
node.parameters.jsCode = node.parameters.jsCode.replace(oldBlock, '');

const oldHist = `// Histórico de sessão
let historico = [];
try {
  const raw = sessao.value ?? null;
  if (typeof raw === 'string') historico = JSON.parse(raw);
  else if (Array.isArray(raw)) historico = raw;
} catch {}`;

const newHist = `// Histórico — vem do Mesclar Histórico (que já fundiu Redis sessão + Chatwoot)
let historico = [];
try { historico = $('Mesclar Histórico').first().json.historico ?? []; } catch {}`;

if (!node.parameters.jsCode.includes(oldHist)) {
  console.error('[ERRO] bloco historico não encontrado'); process.exit(1);
}
node.parameters.jsCode = node.parameters.jsCode.replace(oldHist, newHist);

const body = {
  name: wf.name,
  nodes: wf.nodes,
  connections: wf.connections,
  settings: { executionOrder: 'v1', saveManualExecutions: true },
};
const r = await axios.put(`${base}/workflows/jleu4RPvSnYDL8Gd`, body, { headers });
console.log('Salvo:', r.status);
console.log('Construir Prompt agora lê histórico do Mesclar (não mais direto do Redis)');

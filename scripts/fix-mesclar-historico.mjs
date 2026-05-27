import 'dotenv/config';
import axios from 'axios';

const base = 'https://workflows.vendly.chat/api/v1';
const headers = { 'X-N8N-API-KEY': process.env.N8N_API_KEY };

const wf = (await axios.get(`${base}/workflows/jleu4RPvSnYDL8Gd`, { headers })).data;

const mh = wf.nodes.find(n => n.name === 'Mesclar Histórico');
mh.parameters.jsCode = `
// Mescla histórico do Redis (sessão LLM) com histórico do Chatwoot (fonte da verdade)
// Estratégia: usar o que tiver MAIS mensagens — geralmente Chatwoot tem todo o histórico
// quando o Redis está vazio (conversa nova / cache perdido)

const inputItem = $input.first().json;
const redisHist = Array.isArray(inputItem.historico) ? inputItem.historico : [];

let cwHist = [];
try {
  cwHist = $('Preparar Histórico Chatwoot').first().json.historico ?? [];
} catch {}

// Se Chatwoot tem mais histórico que Redis, usa Chatwoot (fallback robusto)
// Senão usa Redis (que pode ter resumo comprimido)
const historico = cwHist.length > redisHist.length ? cwHist : redisHist;

return [{ json: { historico } }];
`;

const body = {
  name: wf.name,
  nodes: wf.nodes,
  connections: wf.connections,
  settings: { executionOrder: 'v1', saveManualExecutions: true },
};
const r = await axios.put(`${base}/workflows/jleu4RPvSnYDL8Gd`, body, { headers });
console.log('Salvo:', r.status);
console.log('Agora Mesclar Histórico usa Chatwoot como fallback quando Redis tem menos mensagens.');

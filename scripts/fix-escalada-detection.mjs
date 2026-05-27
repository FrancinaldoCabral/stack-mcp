import 'dotenv/config';
import axios from 'axios';
const h = { 'X-N8N-API-KEY': process.env.N8N_API_KEY, 'Content-Type': 'application/json' };
const N8N = 'https://workflows.vendly.chat/api/v1';

const wf = (await axios.get(`${N8N}/workflows/jleu4RPvSnYDL8Gd`, { headers: h })).data;
const parse = wf.nodes.find(n => n.name === 'Parsear Chunks');
let code = parse.parameters.jsCode;

const oldBlock = `// Detectar e limpar marcador de escalada para humano\nconst escalarHumano = content.includes('[ESCALAR_HUMANO]');\ncontent = content.replace(/\\[ESCALAR_HUMANO\\]/g, '').trim();`;

const newBlock = `// Detectar pedido explícito do usuário (regex) — o LLM às vezes esquece o marcador
const _lastUserRaw = (() => {
  const lu = promptData.messages?.[promptData.messages.length - 1];
  if (typeof lu?.content === 'string') return lu.content;
  if (Array.isArray(lu?.content)) return lu.content.filter(p => p.type === 'text').map(p => p.text).join(' ');
  return '';
})().toLowerCase();
const _userPediuHumano = /(?:falar|conversar|atendimento|atendente|humano|pessoa\\s+real|operador|gente\\s+de\\s+verdade)/.test(_lastUserRaw)
  && /(?:quero|preciso|posso|pode|me\\s+(?:passa|conecta|transfere|liga)|chama|chamar|gostaria|atend(?:imento|ente)|humano)/.test(_lastUserRaw);
// Detectar frase de transferência na resposta do LLM
const _llmTransferiu = /(?:transferir|conectar|encaminhar|chamar|passar)\\s+(?:voc[eê]|para)?\\s*(?:um\\s+)?atendente|atendente\\s+(?:j[aá]\\s+)?(?:vai|ir[aá])|vou\\s+te\\s+(?:transferir|conectar|passar)/i.test(content);
// Detectar e limpar marcador de escalada para humano
const escalarHumano = content.includes('[ESCALAR_HUMANO]') || (_userPediuHumano && _llmTransferiu) || _userPediuHumano;
content = content.replace(/\\[ESCALAR_HUMANO\\]/g, '').trim();`;

if (!code.includes(oldBlock)) {
  console.error('Bloco antigo não encontrado!');
  process.exit(1);
}
code = code.replace(oldBlock, newBlock);
parse.parameters.jsCode = code;

const payload = {
  name: wf.name,
  nodes: wf.nodes,
  connections: wf.connections,
  settings: { executionOrder: 'v1', saveManualExecutions: true },
};
const r = await axios.put(`${N8N}/workflows/jleu4RPvSnYDL8Gd`, payload, { headers: h });
console.log('OK status:', r.status, 'updatedAt:', r.data.updatedAt);

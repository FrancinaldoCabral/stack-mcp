import 'dotenv/config';
import axios from 'axios';

const base = 'https://workflows.vendly.chat/api/v1';
const headers = {
  'X-N8N-API-KEY': process.env.N8N_API_KEY,
  'Accept': 'application/json',
  'Content-Type': 'application/json',
};

const wf = (await axios.get(`${base}/workflows/jleu4RPvSnYDL8Gd`, { headers })).data;

// O Redis GET Sessao usa mongodb._id como parte da chave, mas o SET usa instance.
// Eles nunca coincidem → histórico sempre vazio.
// Fix: GET deve usar a mesma chave do SET (instance).
const getNode = wf.nodes.find(n => n.name === 'Redis GET Sessao');
if (!getNode) throw new Error('Nó Redis GET Sessao não encontrado');

console.log('Chave atual:', getNode.parameters.key);
getNode.parameters.key = "={{ 'sessao:' + $('Desembalar Payload').first().json.instance + ':' + $('Desembalar Payload').first().json.telefone }}";
console.log('Chave corrigida:', getNode.parameters.key);

const body = {
  name: wf.name,
  nodes: wf.nodes,
  connections: wf.connections,
  settings: { executionOrder: 'v1', saveManualExecutions: true },
};
const resp = await axios.put(`${base}/workflows/jleu4RPvSnYDL8Gd`, body, { headers });
console.log('Workflow salvo:', resp.status, resp.statusText);


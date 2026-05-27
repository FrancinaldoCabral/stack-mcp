import 'dotenv/config';
import axios from 'axios';

const base = 'https://workflows.vendly.chat/api/v1';
const headers = { 'X-N8N-API-KEY': process.env.N8N_API_KEY };

const wf = (await axios.get(`${base}/workflows/jleu4RPvSnYDL8Gd`, { headers })).data;

const setNode = wf.nodes.find(n => n.name === 'Redis SET Sessao');
console.log('Antes:', setNode.parameters.key);
setNode.parameters.key = "={{ 'sessao:' + $json.contexto.instance + ':' + $json.contexto.telefone }}";
console.log('Depois:', setNode.parameters.key);

const body = {
  name: wf.name,
  nodes: wf.nodes,
  connections: wf.connections,
  settings: { executionOrder: 'v1', saveManualExecutions: true },
};
const r = await axios.put(`${base}/workflows/jleu4RPvSnYDL8Gd`, body, { headers });
console.log('Salvo:', r.status);

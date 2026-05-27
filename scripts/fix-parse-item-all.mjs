import 'dotenv/config';
import axios from 'axios';
const h = { 'X-N8N-API-KEY': process.env.N8N_API_KEY, 'Content-Type': 'application/json' };
const N8N = 'https://workflows.vendly.chat/api/v1';
const ID = 'FacKqM3e2LsHE6NY';

const wf = (await axios.get(`${N8N}/workflows/${ID}`, { headers: h })).data;

const parse = wf.nodes.find(n => n.name === 'Parse Item');
parse.parameters.jsCode = `// Deserializa todos os itens POPados da lista Redis (1 run, N items)
return $input.all().map(item => {
  const raw = item.json || {};
  const v = raw.value ?? raw.propertyName;
  if (!v || v === 'nil' || v === 'null') return null;
  try {
    if (typeof v === 'object') return { json: v };
    return { json: JSON.parse(v) };
  } catch (e) {
    return { json: { conteudo: String(v), tipo: 'texto' } };
  }
}).filter(Boolean);`;

const body = {
  name: wf.name,
  nodes: wf.nodes,
  connections: wf.connections,
  settings: { executionOrder: 'v1', saveManualExecutions: true },
};
const r = await axios.put(`${N8N}/workflows/${ID}`, body, { headers: h });
console.log('PUT', r.status, '— Parse Item agora processa $input.all()');

import 'dotenv/config';
import axios from 'axios';
const h = { 'X-N8N-API-KEY': process.env.N8N_API_KEY };
const N8N = 'https://workflows.vendly.chat/api/v1';

const r = await axios.get(`${N8N}/executions?workflowId=jleu4RPvSnYDL8Gd&limit=20`, { headers: h });
const execs = r.data.data ?? r.data;

for (const e of execs) {
  const det = (await axios.get(`${N8N}/executions/${e.id}?includeData=true`, { headers: h })).data;
  const rd = det.data?.resultData?.runData ?? {};
  const desemb = rd['Desembalar Payload']?.[0]?.data?.main?.[0]?.[0]?.json;
  const or = rd['OpenRouter']?.[0]?.data?.main?.[0]?.[0]?.json;
  const resp = or?.choices?.[0]?.message?.content ?? '';
  const parsear = rd['Parsear Chunks']?.[0]?.data?.main?.[0] ?? [];
  const hasEsc = parsear.some(p => p.json?.escalarHumano === true);
  const escNode = rd['Escalada Humano']?.[0]?.data?.main?.[0];
  console.log(`${e.id} | conv=${desemb?.conversation_id} | tipo=${desemb?.tipo} | userMsg="${(desemb?.conteudo??'').slice(0,80)}"`);
  console.log(`     resp="${resp.slice(0, 120)}"`);
  console.log(`     hasEscalar=${hasEsc} escaladaOut=${escNode ? JSON.stringify(escNode).slice(0,200) : 'undefined'}`);
}

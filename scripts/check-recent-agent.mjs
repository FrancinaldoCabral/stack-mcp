import 'dotenv/config';
import axios from 'axios';
const h = { 'X-N8N-API-KEY': process.env.N8N_API_KEY };
const N8N = 'https://workflows.vendly.chat/api/v1';

const r = await axios.get(`${N8N}/executions?workflowId=jleu4RPvSnYDL8Gd&limit=15`, { headers: h });
for (const e of (r.data.data ?? r.data)) {
  const det = (await axios.get(`${N8N}/executions/${e.id}?includeData=true`, { headers: h })).data;
  const rd = det.data?.resultData?.runData ?? {};
  const desemb = rd['Desembalar Payload']?.[0]?.data?.main?.[0]?.[0]?.json;
  const or = rd['OpenRouter']?.[0]?.data?.main?.[0]?.[0]?.json;
  const resp = or?.choices?.[0]?.message?.content ?? '';
  const parse = rd['Parsear Chunks']?.[0]?.data?.main?.[0]?.[0]?.json;
  const esc = rd['Escalada Humano']?.[0]?.data?.main?.[0];
  const setT = rd['Redis SET Takeover Escalada']?.[0]?.data?.main?.[0];
  console.log(`${e.id} | conv=${desemb?.conversation_id} tel=${desemb?.telefone}`);
  console.log(`   userMsg="${(desemb?.conteudo??'').slice(0,80)}"`);
  console.log(`   resp="${resp.slice(0, 100)}"`);
  console.log(`   escalarHumano=${parse?.escalarHumano} | Escalada ran=${esc?.length ?? 'no'} | SET Takeover=${setT?.length ?? 'no'}`);
}

import 'dotenv/config';
import axios from 'axios';
const h = { 'X-N8N-API-KEY': process.env.N8N_API_KEY };
const N8N = 'https://workflows.vendly.chat/api/v1';

const ent = (await axios.get(`${N8N}/executions?workflowId=bEb19TdWZfFloisU&limit=40`, { headers: h })).data;
for (const e of (ent.data ?? ent).slice(0, 30)) {
  const det = (await axios.get(`${N8N}/executions/${e.id}?includeData=true`, { headers: h })).data;
  const rd = det.data?.resultData?.runData ?? {};
  const norm = rd['Normalizar Mensagem']?.[0]?.data?.main?.[0]?.[0]?.json;
  const tk = rd['Redis GET human_takeover']?.[0]?.data?.main?.[0]?.[0]?.json;
  const auto = rd['Auto-Aceitar Conversa']?.[0]?.data?.main?.[0];
  const call = rd['Chamar Debounce']?.[0]?.data?.main?.[0];
  const dedup = rd['IF Já Processado?']?.[0]?.data?.main;
  const wasDuplicate = dedup?.[0]?.length > 0;
  console.log(`${e.id} | inst=${norm?.instance ?? '?'} tel=${norm?.telefone ?? '?'} | tipo=${norm?.tipo} src=${norm?.source} | conteudo="${(norm?.conteudo??'').slice(0,40)}"`);
  console.log(`   dup=${wasDuplicate} takeover="${tk?.takeover_value ?? 'null'}" autoAceitar=${auto?.length ?? 0} chamouDebounce=${call ? 'yes' : 'no'}`);
}

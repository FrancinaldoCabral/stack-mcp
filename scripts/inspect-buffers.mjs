import 'dotenv/config';
import axios from 'axios';
const h = { 'X-N8N-API-KEY': process.env.N8N_API_KEY };
const N8N = 'https://workflows.vendly.chat/api/v1';

const bufIds = [1762, 1798, 1805, 1808, 1812, 1831, 1839, 1842];
for (const id of bufIds) {
  const r = await axios.get(`${N8N}/executions/${id}?includeData=true`, { headers: h });
  const rd = r.data.data?.resultData?.runData ?? {};
  const ll = rd['listLength Buffer']?.[0]?.data?.main?.[0]?.[0]?.json;
  const llVal = ll ? Object.values(ll).find(v => typeof v === 'number') : null;
  const ver = rd['Verificar Debounce']?.[0]?.data?.main?.[0];
  const verMatched = Array.isArray(ver) && ver.length > 0;
  const cons = rd['Consolidar e Preparar']?.[0]?.data?.main?.[0]?.[0]?.json;
  const popCount = rd['POP Buffer']?.length ?? 0;
  console.log(`Buf ${id} | started ${r.data.startedAt} | verifMatched=${verMatched} | llen=${llVal} | popRuns=${popCount} | consConteudo="${(cons?.conteudo ?? '').slice(0, 120)}"`);
}

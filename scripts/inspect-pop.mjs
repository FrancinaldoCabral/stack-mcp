import 'dotenv/config';
import axios from 'axios';
const h = { 'X-N8N-API-KEY': process.env.N8N_API_KEY };
const N8N = 'https://workflows.vendly.chat/api/v1';

const ids = [1808, 1839];
for (const id of ids) {
  const r = await axios.get(`${N8N}/executions/${id}?includeData=true`, { headers: h });
  const rd = r.data.data?.resultData?.runData ?? {};
  console.log(`\n=== Buffer ${id} ===`);
  const gen = rd['Gerar Iteracoes']?.[0]?.data?.main?.[0];
  console.log('Gerar Iteracoes itens:', gen?.length);
  const popRuns = rd['POP Buffer'] ?? [];
  console.log('POP Buffer runs:', popRuns.length);
  popRuns.forEach((run, i) => {
    const items = run?.data?.main?.[0] ?? [];
    console.log(`  run[${i}] items=${items.length}`);
    items.forEach((it, j) => {
      const v = it.json?.propertyName ?? it.json;
      console.log(`    [${j}] tipo=${v?.tipo} conteudo="${(v?.conteudo ?? '').slice(0,80)}"`);
    });
  });
  const parseRuns = rd['Parse Item'] ?? [];
  console.log('Parse Item runs:', parseRuns.length);
  parseRuns.forEach((run, i) => {
    const items = run?.data?.main?.[0] ?? [];
    items.forEach((it, j) => {
      console.log(`    parse[${i}][${j}] tipo=${it.json?.tipo} conteudo="${(it.json?.conteudo ?? '').slice(0,80)}"`);
    });
  });
  const cons = rd['Consolidar e Preparar']?.[0]?.data?.main?.[0]?.[0]?.json;
  console.log('Consolidar conteudo:', JSON.stringify(cons?.conteudo ?? '').slice(0, 400));
}

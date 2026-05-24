import 'dotenv/config';

const h = {'X-N8N-API-KEY': process.env.N8N_API_KEY, 'Accept': 'application/json'};

// Busca execuções da Entrada para ver instâncias reais
const r = await fetch('https://workflows.vendly.chat/api/v1/executions?workflowId=bEb19TdWZfFloisU&limit=50', {headers: h});
const {data} = await r.json();

// Contar por hora e status para ver padrão
const today = new Date().toISOString().slice(0, 10);
const recent = data.filter(e => e.startedAt?.startsWith(today));
console.log(`Execuções Entrada hoje: ${recent.length} de ${data.length} total`);

// Pega última execução com dados (tentar várias)
for (const ex of data.slice(0, 20)) {
  const rd = await fetch(`https://workflows.vendly.chat/api/v1/executions/${ex.id}?includeData=true`, {headers: h});
  const exec = await rd.json();
  if (exec.data?.resultData?.runData) {
    const nodes = exec.data.resultData.runData;
    const norm = nodes['Normalizar Mensagem']?.[0]?.data?.main?.[0]?.[0]?.json;
    if (norm) {
      console.log(`✅ Exec ${ex.id} [${ex.startedAt?.slice(11,19)}] status=${ex.status} inst=${norm.instance} tipo=${norm.tipo}`);
      break;
    }
  }
  console.log(`  Exec ${ex.id} [${ex.startedAt?.slice(11,19)}] status=${ex.status} - sem data`);
}

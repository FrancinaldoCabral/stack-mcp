import 'dotenv/config';
import axios from 'axios';

const h = { 'X-N8N-API-KEY': process.env.N8N_API_KEY };
const N8N = 'https://workflows.vendly.chat/api/v1';

// IDs dos workflows
const WF = {
  entrada: 'bEb19TdWZfFloisU',
  buffer: 'FacKqM3e2LsHE6NY',
  agent: 'jleu4RPvSnYDL8Gd',
};

async function lastExecs(id, n = 10) {
  const r = await axios.get(`${N8N}/executions?workflowId=${id}&limit=${n}`, { headers: h });
  return r.data.data ?? r.data;
}

async function execDetail(id) {
  const r = await axios.get(`${N8N}/executions/${id}?includeData=true`, { headers: h });
  return r.data;
}

const entradas = await lastExecs(WF.entrada, 20);
const buffers = await lastExecs(WF.buffer, 10);
const agents = await lastExecs(WF.agent, 5);

console.log('=== Últimas execuções [CORE] Entrada ===');
for (const e of entradas.slice(0, 15)) {
  console.log(`  ${e.id} | ${e.status} | ${e.startedAt}`);
}

console.log('\n=== Últimas execuções [CORE] Buffer/Debounce ===');
for (const e of buffers.slice(0, 8)) {
  console.log(`  ${e.id} | ${e.status} | ${e.startedAt}`);
}

console.log('\n=== Últimas execuções [AGENT] Executor ===');
for (const e of agents.slice(0, 5)) {
  console.log(`  ${e.id} | ${e.status} | ${e.startedAt}`);
}

// Inspeciona o buffer mais recente
const lastBuf = buffers[0];
if (lastBuf) {
  console.log(`\n=== Detalhe Buffer exec ${lastBuf.id} ===`);
  const det = await execDetail(lastBuf.id);
  const rd = det.data?.resultData?.runData ?? {};
  console.log('Nós executados:', Object.keys(rd).join(', '));
  
  // Procura nós relevantes
  for (const nodeName of Object.keys(rd)) {
    if (/llen|buffer|consolidar|verificar|debounce|gerar/i.test(nodeName)) {
      const out = rd[nodeName]?.[0]?.data?.main?.[0];
      const count = Array.isArray(out) ? out.length : 0;
      const first = out?.[0]?.json;
      console.log(`  [${nodeName}] itens=${count} sample=${JSON.stringify(first).slice(0, 200)}`);
    }
  }
}

// Inspeciona o agent mais recente para ver o que chegou consolidado
const lastAgent = agents[0];
if (lastAgent) {
  console.log(`\n=== Detalhe Agent exec ${lastAgent.id} ===`);
  const det = await execDetail(lastAgent.id);
  const rd = det.data?.resultData?.runData ?? {};
  const desemb = rd['Desembalar Payload']?.[0]?.data?.main?.[0]?.[0]?.json;
  console.log('Conteúdo recebido:', JSON.stringify(desemb?.conteudo ?? desemb).slice(0, 600));
  const cp = rd['Construir Prompt']?.[0]?.data?.main?.[0]?.[0]?.json;
  const lastMsg = cp?.messages?.[cp.messages.length - 1];
  console.log('Última msg ao LLM:', JSON.stringify(lastMsg).slice(0, 600));
}

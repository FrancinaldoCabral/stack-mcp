// analyze-execs.mjs - analisa últimas execuções e mostra o que chegou ao usuário
import 'dotenv/config';
const H = { 'X-N8N-API-KEY': process.env.N8N_API_KEY, 'Accept': 'application/json' };

// pegar Parsear Chunks e Preparar Sessao
const wf = await fetch('https://workflows.vendly.chat/api/v1/workflows/jleu4RPvSnYDL8Gd', { headers: H }).then(r => r.json());
const parsearChunks = wf.nodes.find(x => x.name === 'Parsear Chunks');
const prepSessao = wf.nodes.find(x => x.name === 'Preparar Sessao');

console.log('=== PARSEAR CHUNKS ===');
console.log(parsearChunks?.parameters?.jsCode);
console.log('\n=== PREPARAR SESSAO ===');
console.log(prepSessao?.parameters?.jsCode);

// ver historico atual da sessão do user
const Redis = (await import('ioredis')).default;
const redis = new Redis(process.env.REDIS_URL);
const sessaoKey = 'sessao:suporte-redatudo:5511999990001';
const sessao = await redis.get(sessaoKey);
const historico = sessao ? JSON.parse(sessao) : [];
console.log('\n=== HISTORICO REDIS (' + historico.length + ' mensagens) ===');
historico.slice(-10).forEach((m, i) => {
  console.log('[' + m.role + '] ' + String(m.content).slice(0, 120));
});

// ver últimas 3 execuções com detalhes
for (const id of [888, 877, 874]) {
  const exec = await fetch('https://workflows.vendly.chat/api/v1/executions/' + id + '?includeData=true', { headers: H }).then(r => r.json());
  const nodes = exec?.data?.resultData?.runData ?? {};
  const d = nodes['Desembalar Payload']?.[0]?.data?.main?.[0]?.[0]?.json;
  const or = nodes['OpenRouter']?.[0]?.data?.main?.[0]?.[0]?.json;
  const resp = or?.choices?.[0]?.message?.content;
  const parsear = nodes['Parsear Chunks']?.[0]?.data?.main?.[0];
  const evText = nodes['Evolution send text'];
  const evAudio = nodes['Evolution send audio'];
  const cp = nodes['Construir Prompt']?.[0]?.data?.main?.[0]?.[0]?.json;

  console.log('\n=== EXEC #' + id + ' tipo=' + d?.tipo + ' respondWithAudio=' + cp?.respondWithAudio + ' ===');
  console.log('LLM resp completo: ' + resp);
  console.log('Chunks parseados (' + (parsear?.length ?? 0) + '):');
  parsear?.forEach((c, i) => console.log('  [' + i + '] ' + JSON.stringify(c.json).slice(0, 150)));
}

redis.disconnect();

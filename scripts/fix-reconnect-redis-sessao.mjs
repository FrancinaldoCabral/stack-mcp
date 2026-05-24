import 'dotenv/config';

// Reconecta Redis GET Sessao ao fluxo principal
// MongoDB GET Cliente deve disparar EM PARALELO:
//   branch A: Chatwoot GET Mensagens → Preparar Histórico Chatwoot → Mesclar Histórico
//   branch B: Redis GET Sessao → Verificar Janela de Contexto → IF Precisa Resumir? → Mesclar Histórico

const headers = {
  'X-N8N-API-KEY': process.env.N8N_API_KEY,
  'Accept': 'application/json',
  'Content-Type': 'application/json',
};

const wf = await fetch('https://workflows.vendly.chat/api/v1/workflows/jleu4RPvSnYDL8Gd', { headers })
  .then(r => r.json());

// Verificar estado atual
const clienteConns = wf.connections['MongoDB GET Cliente'];
console.log('MongoDB GET Cliente → atual:', JSON.stringify(clienteConns?.main));

const incoming = Object.entries(wf.connections)
  .filter(([k, v]) => JSON.stringify(v).includes('"Redis GET Sessao"'));
console.log('Quem conecta em Redis GET Sessao (antes):', incoming.map(([k]) => k));

// Adicionar Redis GET Sessao como segunda saída de MongoDB GET Cliente (main[0])
const main0 = clienteConns?.main?.[0] ?? [];
const alreadyConnected = main0.some(c => c.node === 'Redis GET Sessao');

if (alreadyConnected) {
  console.log('Redis GET Sessao já está conectado — nenhuma alteração');
} else {
  main0.push({ node: 'Redis GET Sessao', type: 'main', index: 0 });
  wf.connections['MongoDB GET Cliente'] = { main: [main0] };
  console.log('MongoDB GET Cliente → novo:', JSON.stringify(wf.connections['MongoDB GET Cliente'].main));

  const { status, body } = await fetch('https://workflows.vendly.chat/api/v1/workflows/jleu4RPvSnYDL8Gd', {
    method: 'PUT',
    headers,
    body: JSON.stringify({
      name: wf.name,
      nodes: wf.nodes,
      connections: wf.connections,
      settings: { executionOrder: 'v1', saveManualExecutions: true },
    }),
  }).then(async r => ({ status: r.status, body: await r.json() }));

  if (status !== 200) {
    console.error('ERRO', status, JSON.stringify(body).slice(0, 300));
    process.exit(1);
  }

  // Verificar resultado
  const saved = body.connections['MongoDB GET Cliente']?.main?.[0] ?? [];
  const ok = saved.some(c => c.node === 'Redis GET Sessao');
  console.log('✅ Redis GET Sessao reconectado:', ok ? 'OK' : 'FALHOU');
  console.log('   MongoDB GET Cliente → agora:', JSON.stringify(saved.map(c => c.node)));
}

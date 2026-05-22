import 'dotenv/config';

const N8N = 'https://workflows.vendly.chat';
const KEY = process.env.N8N_API_KEY;
const h = { 'X-N8N-API-KEY': KEY, 'Accept': 'application/json', 'Content-Type': 'application/json' };

async function run() {
  const r = await fetch(`${N8N}/api/v1/workflows/jleu4RPvSnYDL8Gd`, { headers: h });
  const wf = await r.json();

  // ─── Reconstruir conexões ────────────────────────────────────────────────
  const c = wf.connections;
  const T = (node) => [{ node, type: 'main', index: 0 }];

  // 1. Desembalar Payload → SOMENTE Redis GET Agente (remover MongoDB e Chatwoot)
  c['Desembalar Payload'] = { main: [T('Redis GET Agente')] };

  // 2. Parse Agente Config → MongoDB GET Business (novo elo)
  c['Parse Agente Config'] = { main: [T('MongoDB GET Business')] };

  // 3. MongoDB GET Cliente → Chatwoot GET Mensagens (era → Redis GET Sessao)
  c['MongoDB GET Cliente'] = { main: [T('Chatwoot GET Mensagens')] };

  // 4. IF Precisa Resumir? — branch FALSE (output[1]) → Mesclar Histórico
  //    (branch TRUE output[0] já aponta para Preparar Resumo)
  if (!c['IF Precisa Resumir?']) c['IF Precisa Resumir?'] = { main: [[], []] };
  if (!c['IF Precisa Resumir?'].main[1]) c['IF Precisa Resumir?'].main[1] = [];
  c['IF Precisa Resumir?'].main[1] = T('Mesclar Histórico');

  // 5. Comprimir Histórico → Mesclar Histórico (era dead-end)
  c['Comprimir Histórico'] = { main: [T('Mesclar Histórico')] };

  // 6. Verificar Janela de Contexto: já conecta → IF Precisa Resumir? (manter)
  // 7. Redis GET Sessao: já conecta → Verificar Janela (manter como está)

  // ─── Salvar ──────────────────────────────────────────────────────────────
  const payload = {
    name: wf.name,
    nodes: wf.nodes,
    connections: c,
    settings: { executionOrder: 'v1', saveManualExecutions: true },
  };

  const upd = await fetch(`${N8N}/api/v1/workflows/jleu4RPvSnYDL8Gd`, {
    method: 'PUT', headers: h, body: JSON.stringify(payload)
  });
  console.log('PUT status:', upd.status);

  const act = await fetch(`${N8N}/api/v1/workflows/jleu4RPvSnYDL8Gd/activate`, {
    method: 'POST', headers: h
  });
  console.log('Activate status:', act.status);

  // ─── Verificar ───────────────────────────────────────────────────────────
  const chk = await fetch(`${N8N}/api/v1/workflows/jleu4RPvSnYDL8Gd`, { headers: h });
  const wf2 = await chk.json();
  console.log('\n=== Conexões após fix ===');
  Object.entries(wf2.connections ?? {}).forEach(([from, outs]) => {
    (outs.main ?? []).forEach((targets, idx) => {
      (targets ?? []).forEach(t => console.log(`  [${idx}] "${from}" → "${t.node}"`));
    });
  });
}

run().catch(e => console.error(e));

import dotenv from 'dotenv';
dotenv.config();
const N8N_KEY = process.env.N8N_API_KEY;
const EXECUTOR_ID = 'jleu4RPvSnYDL8Gd';

async function n8n(path) {
  const r = await fetch(`https://workflows.vendly.chat/api/v1${path}`, {
    headers: { 'X-N8N-API-KEY': N8N_KEY, 'Accept': 'application/json' }
  });
  return r.json();
}

// Checar exec 1322 em detalhe (áudio que funcionou)
console.log('=== EXEC 1322 — detalhes críticos ===\n');
const detail1322 = await n8n('/executions/1322?includeData=true');
const rd = detail1322.data?.resultData?.runData ?? {};

// 1. Construir Prompt — qual modelo está sendo usado?
if (rd['Construir Prompt']) {
  const items = rd['Construir Prompt'][0]?.data?.main?.[0] ?? [];
  const j = items[0]?.json ?? {};
  console.log('Construir Prompt output (campos relevantes):');
  console.log('  model:', j.model);
  console.log('  conversation_id:', j.conversation_id);
  console.log('  instance:', j.instance);
  console.log('  tipo:', j.tipo);
  console.log('  respondWithAudio:', j.respondWithAudio);
}

// 2. Nó "OpenRouter" (qual URL e modelo no body?)
const openrouterNode = rd['OpenRouter'] ?? rd['OpenRouter Com Ferramenta'];
const orKey = rd['OpenRouter'] ? 'OpenRouter' : 'OpenRouter Com Ferramenta';
if (rd[orKey]) {
  const nodeRun = rd[orKey][0];
  // Ver o que foi enviado para OpenRouter
  console.log('\n' + orKey + ':');
  const items = nodeRun.data?.main?.[0] ?? [];
  if (nodeRun.error) console.log('  ERRO:', nodeRun.error.message);
  if (items[0]) {
    const resp = items[0].json;
    console.log('  model usado na resposta:', resp.model);
    console.log('  finish_reason:', resp.choices?.[0]?.finish_reason);
    console.log('  resposta (100 chars):', String(resp.choices?.[0]?.message?.content ?? '').slice(0, 100));
  }
}

// 3. Parsear Chunks — conversation_id presente?
if (rd['Parsear Chunks']) {
  const items = rd['Parsear Chunks'][0]?.data?.main?.[0] ?? [];
  console.log('\nParsear Chunks:');
  for (const it of items) {
    console.log('  conversation_id:', it.json.conversation_id);
    console.log('  account_id:', it.json.account_id);
    console.log('  respondWithAudio:', it.json.respondWithAudio);
    console.log('  chunk (80):', String(it.json.chunk ?? '').slice(0, 80));
  }
}

// 4. Chatwoot Enviar Audio — output
if (rd['Chatwoot Enviar Audio']) {
  const d = rd['Chatwoot Enviar Audio'][0];
  if (d.error) console.log('\nChatwoot Enviar Audio ERRO:', d.error.message);
  else {
    const items = d.data?.main?.[0] ?? [];
    console.log('\nChatwoot Enviar Audio: ✓ items out:', items.length);
    // O nó retorna $input.first() — não tem output especial
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Checar exec 1318 (modelo inválido)
console.log('\n\n=== EXEC 1318 — modelo inválido ===\n');
const detail1318 = await n8n('/executions/1318?includeData=true');
const rd18 = detail1318.data?.resultData?.runData ?? {};

if (rd18['Construir Prompt']) {
  const items = rd18['Construir Prompt'][0]?.data?.main?.[0] ?? [];
  const j = items[0]?.json ?? {};
  console.log('Construir Prompt:');
  console.log('  model:', j.model);
  console.log('  conversation_id:', j.conversation_id);
}

// Tentar pegar o nó OpenRouter para ver o model_id enviado
for (const nodeName of ['OpenRouter', 'OpenRouter Com Ferramenta']) {
  if (rd18[nodeName]) {
    const nodeRun = rd18[nodeName][0];
    console.log('\n' + nodeName + ':');
    if (nodeRun.error) console.log('  ERRO:', nodeRun.error.message);
    else {
      const items = nodeRun.data?.main?.[0] ?? [];
      console.log('  model (resposta):', items[0]?.json?.model);
      console.log('  error.message:', items[0]?.json?.error?.message);
    }
  }
}

// Parse Agente Config — como o modelo é selecionado?
if (rd18['Parse Agente Config']) {
  const items = rd18['Parse Agente Config'][0]?.data?.main?.[0] ?? [];
  const j = items[0]?.json ?? {};
  console.log('\nParse Agente Config:');
  console.log('  model:', j.model);
  console.log('  agentId:', j.agentId);
  console.log('  systemPrompt (50):', String(j.systemPrompt ?? '').slice(0, 50));
}

// MongoDB GET Business — tem customModel?
if (rd18['MongoDB GET Business']) {
  const items = rd18['MongoDB GET Business'][0]?.data?.main?.[0] ?? [];
  const j = items[0]?.json ?? {};
  console.log('\nMongoDB GET Business:');
  console.log('  model:', j.model);
  console.log('  openrouterModel:', j.openrouterModel);
  console.log('  agentModel:', j.agentModel);
  console.log('  customModel:', j.customModel);
}

// Nó que monta o body do OpenRouter
for (const nodeName of ['Preparar Request OpenRouter', 'Montar Request', 'Preparar Prompt', 'Construir Prompt']) {
  if (rd18[nodeName]) {
    const items = rd18[nodeName][0]?.data?.main?.[0] ?? [];
    const j = items[0]?.json ?? {};
    if (j.model) console.log(`\n${nodeName} → model: ${j.model}`);
  }
}

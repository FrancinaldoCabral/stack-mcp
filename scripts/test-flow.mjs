/**
 * Test harness para o fluxo completo: Entrada → Debounce → Executor
 *
 * Uso:
 *   node scripts/test-flow.mjs          # simula mensagem de texto
 *   node scripts/test-flow.mjs audio    # simula mensagem de áudio
 *   node scripts/test-flow.mjs dedup    # envia mesma mensagem 3x para testar dedup
 *
 * O script:
 *  1. Envia webhook fake para o Entrada workflow (como Chatwoot faria)
 *  2. Aguarda processamento (debounce = 5s + margem)
 *  3. Busca execuções dos 3 workflows e mostra resultado nó a nó
 */
import 'dotenv/config';

const N8N_URL = process.env.N8N_URL ?? 'https://workflows.vendly.chat';
const N8N_KEY = process.env.N8N_API_KEY;
const H = { 'X-N8N-API-KEY': N8N_KEY, 'Accept': 'application/json', 'Content-Type': 'application/json' };

// Webhook do Entrada (chatwoot-bot)
const WEBHOOK_URL = `${N8N_URL}/webhook/chatwoot-bot`;

const mode = process.argv[2] ?? 'text';
// Instância: usa 'suporte-redatudo' em modo prod/audio-real, caso contrário TestInstance
const instanceOverride = process.argv[3];  // ex: node test-flow.mjs audio suporte-redatudo

// ── Payload fake Chatwoot ──────────────────────────────────────────
const MSG_ID = 88800 + Math.floor(Math.random() * 100);  // ID único por test run
const CONV_ID = 888;
const ACCOUNT_ID = 1;
const INBOX_NAME = instanceOverride ?? 'TestInstance';  // usar instanceOverride para testar pipeline completa

function makePayload(msgId = MSG_ID, tipo = 'text') {
  const base = {
    event: 'message_created',
    id: msgId,
    content: tipo === 'audio' ? '' : 'Olá, quero saber sobre os produtos',
    content_type: tipo === 'audio' ? 'audio' : 'text',
    message_type: 'incoming',
    created_at: Math.floor(Date.now() / 1000),
    conversation: {
      id: CONV_ID,
      meta: { assignee: null },
      assignee: null,
    },
    account: { id: ACCOUNT_ID },
    inbox: { id: 1, name: INBOX_NAME },
    sender: {
      name: 'Teste Harness',
      phone_number: '+5511999990001',
      identifier: '5511999990001@s.whatsapp.net',
    },
    attachments: tipo === 'audio' ? [{
      file_type: 'audio',
      // Arquivo .ogg público pequeno para testar transcrição
      data_url: 'https://upload.wikimedia.org/wikipedia/commons/c/c8/Example.ogg',
    }] : [],
  };
  return base;
}

// ── Envia webhook ────────────────────────────────────────────────────
async function sendWebhook(payload, label = '') {
  const t = new Date().toISOString().slice(11, 23);
  process.stdout.write(`[${t}] POST webhook${label ? ' (' + label + ')' : ''} msg_id=${payload.id} ... `);
  try {
    const r = await fetch(WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    console.log(`${r.status}`);
  } catch (e) {
    console.log(`ERRO: ${e.message}`);
  }
}

// ── Busca execuções recentes dos 3 workflows ─────────────────────────
async function fetchExecs(since) {
  const wfs = [
    ['bEb19TdWZfFloisU', 'Entrada'],
    ['FacKqM3e2LsHE6NY', 'Debounce'],
    ['jleu4RPvSnYDL8Gd', 'Executor'],
  ];
  const results = {};
  for (const [id, label] of wfs) {
    const r = await fetch(`${N8N_URL}/api/v1/executions?limit=20&workflowId=${id}`, { headers: H });
    const d = await r.json();
    results[label] = d.data?.filter(e => new Date(e.startedAt) >= since) ?? [];
  }
  return results;
}

// ── Inspeciona nós de uma execução ───────────────────────────────────
async function inspectExec(execId, label) {
  const r = await fetch(`${N8N_URL}/api/v1/executions/${execId}?includeData=true`, { headers: H });
  const det = await r.json();
  const rd = det.data?.resultData?.runData ?? {};
  const last = det.data?.resultData?.lastNodeExecuted;

  console.log(`\n  ── Exec ${execId} [${label}] último nó: ${last ?? '(vazio)'} ──`);

  // Nós importantes para mostrar
  const importantNodes = [
    'Normalizar Mensagem', 'Redis GET Dedup', 'IF Já Processado?',
    'Restaurar Item Dedup', 'Redis SET Dedup', 'PUSH Buffer',
    'Setar Timestamp Debounce', 'Chamar Debounce',  // Entrada
    'Verificar Debounce', 'listLength Buffer', 'Gerar Iteracoes',
    'POP Buffer', 'Parse Item', 'Consolidar e Preparar', 'Chamar Agente Executor',  // Debounce
    'Desembalar Payload', 'Redis GET Agente', 'IF Tem Agente?',
    'IF Audio Input?', 'Baixar Áudio Chatwoot', 'Prep Transcrição',
    'Construir Prompt', 'OpenRouter',  // Executor
  ];

  for (const nodeName of importantNodes) {
    const runs = rd[nodeName];
    if (!runs) continue;
    const out0 = runs[0]?.data?.main?.[0];  // output principal / branch true
    const out1 = runs[0]?.data?.main?.[1];  // branch false
    const err = runs[0]?.error;

    if (err) {
      console.log(`    ${nodeName}: ❌ ERRO: ${err.message}`);
      continue;
    }

    const items0 = out0?.length ?? 0;
    const items1 = out1?.length ?? 0;

    const sample = out0?.[0]?.json;
    const sampleStr = sample ? JSON.stringify(sample).slice(0, 200) : '(empty)';

    if (out1 !== undefined) {
      // IF node — mostra os dois branches
      console.log(`    ${nodeName}: [0]=${items0} itens  [1]=${items1} itens`);
    } else {
      console.log(`    ${nodeName}: ${items0} itens → ${sampleStr}`);
    }
  }
}

// ── Relatório final ──────────────────────────────────────────────────
async function report(since) {
  console.log('\n═══════════════ RESULTADO ═══════════════');
  const execs = await fetchExecs(since);

  let executorCount = 0;
  for (const [label, list] of Object.entries(execs)) {
    console.log(`\n${label}: ${list.length} execuções`);
    for (const e of list) {
      console.log(`  #${e.id} ${e.startedAt?.slice(11, 19)} ${e.status}`);
      if (label === 'Executor') executorCount++;
      // Detalhar apenas Entrada e Executor (mais relevantes)
      if (label !== 'Debounce') {
        await inspectExec(e.id, label);
      }
    }
  }

  console.log('\n══════════════════════════════════════════');
  if (executorCount === 0) console.log('⚠️  Executor NÃO rodou');
  else if (executorCount === 1) console.log('✅ Executor rodou 1x (esperado)');
  else console.log(`❌ Executor rodou ${executorCount}x (duplicado!)`);
}

// ── Main ─────────────────────────────────────────────────────────────
const since = new Date();
console.log(`\nModo: ${mode} | MSG_ID=${MSG_ID} | CONV_ID=${CONV_ID} | Instance=${INBOX_NAME}`);
console.log(`Webhook: ${WEBHOOK_URL}\n`);

if (mode === 'dedup') {
  // Simula Chatwoot disparando o mesmo webhook 3x
  await sendWebhook(makePayload(MSG_ID, 'text'), '1ª via');
  await new Promise(r => setTimeout(r, 200));
  await sendWebhook(makePayload(MSG_ID, 'text'), '2ª via (dup)');
  await new Promise(r => setTimeout(r, 200));
  await sendWebhook(makePayload(MSG_ID, 'text'), '3ª via (dup)');
} else if (mode === 'audio') {
  await sendWebhook(makePayload(MSG_ID, 'audio'), 'áudio');
  await new Promise(r => setTimeout(r, 300));
  // Segunda via — simula retry do Chatwoot com ID diferente (caso real)
  await sendWebhook(makePayload(MSG_ID + 1, 'audio'), 'áudio dup (ID+1)');
} else if (mode === 'gap') {
  // Simula dois eventos Chatwoot com IDs DIFERENTES mas mesmo created_at (gap de 29s)
  const ts = Math.floor(Date.now() / 1000);
  const p1 = makePayload(MSG_ID, 'audio');     p1.created_at = ts;
  const p2 = makePayload(MSG_ID + 1, 'audio'); p2.created_at = ts; // mesmo timestamp!
  await sendWebhook(p1, 'evento 1 (ID normal)');
  // Não aguarda 29s reais — a chave dedup usa created_at, não tempo do webhook
  await new Promise(r => setTimeout(r, 500));
  await sendWebhook(p2, 'evento 2 (ID+1, mesmo created_at — deve ser bloqueado)');
} else {
  await sendWebhook(makePayload(MSG_ID, 'text'), 'texto');
  await new Promise(r => setTimeout(r, 300));
  await sendWebhook(makePayload(MSG_ID, 'text'), 'texto dup (mesmo ID)');
}

// Modo prod (suporte-redatudo) precisa de mais tempo: MongoDB + Qdrant + OpenRouter + TTS
const waitMs = instanceOverride ? 30000 : 12000;
console.log(`\nAguardando ${waitMs/1000}s para debounce (5s) + processamento...`);
await new Promise(r => setTimeout(r, waitMs));

await report(since);

/**
 * Test Suite Completo — Vendly / LivraisonTotale
 *
 * Cobre: pedidos, status, acertos financeiros, áudio, imagem,
 *        escalação humana, human takeover, Chatwoot, retomada do bot.
 *
 * Instância: "Meu cel" (naldocabral, +55 21 96943-5536)
 * Bot LT    : livraison-totale (+55 65 8401-1436 → 556584011436)
 * Grupo Restaurante : 120363410205219199@g.us
 * Grupo Entregadores: 120363413878404654@g.us
 */

import 'dotenv/config';
import https from 'https';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);

const EVO_URL  = process.env.EVOLUTION_URL;
const EVO_KEY  = process.env.EVOLUTION_API_KEY;
const N8N_URL  = process.env.N8N_URL;
const N8N_KEY  = process.env.N8N_API_KEY;
const OR_KEY   = process.env.OPENROUTER_API_KEY;

const INSTANCE = 'Meu cel';            // instância que envia (naldocabral)
const BOT_NUM  = '556584011436';       // número do bot LT (livraison-totale)
const REST_GRP = '120363410205219199@g.us';
const DELV_GRP = '120363413878404654@g.us';
const MY_NUM   = '5521969435536';      // naldocabral JID raiz

const CW_URL   = process.env.CHATWOOT_URL;
const CW_KEY   = process.env.CHATWOOT_API_KEY;
const CW_ACC   = process.env.CHATWOOT_ACCOUNT_ID || '1';
const MODEL_TTS = process.env.MODEL_TTS || 'google/gemini-3.1-flash-tts-preview';
const VOICE_TTS = process.env.VOICE_TTS || 'Kore';

// ── helpers ──────────────────────────────────────────────────────────────────

function evoRequest(path, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(EVO_URL + path);
    const payload = JSON.stringify(body);
    const req = https.request({
      hostname: url.hostname, path: url.pathname,
      method: 'POST',
      headers: { apikey: EVO_KEY, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }
    }, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => resolve({ status: res.statusCode, body: d }));
    });
    req.on('error', reject);
    req.write(payload); req.end();
  });
}

function cwGet(path) {
  return new Promise((resolve, reject) => {
    const url = new URL(CW_URL + '/api/v1/accounts/' + CW_ACC + path);
    const req = https.request({
      hostname: url.hostname, path: url.pathname + url.search, method: 'GET',
      headers: { api_access_token: CW_KEY, Accept: 'application/json' }
    }, res => {
      let d = ''; res.on('data', c => d += c);
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch { resolve({ raw: d }); } });
    });
    req.on('error', reject); req.end();
  });
}

function n8nGetOnce(path) {
  return new Promise((resolve, reject) => {
    const url = new URL(N8N_URL + path);
    const req = https.request({
      hostname: url.hostname, path: url.pathname + url.search,
      method: 'GET',
      headers: { 'X-N8N-API-KEY': N8N_KEY, Accept: 'application/json' }
    }, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch(e) { reject(e); } });
    });
    req.on('error', reject);
    req.end();
  });
}

async function n8nGet(path, retries = 3) {
  for (let i = 0; i < retries; i++) {
    try {
      return await n8nGetOnce(path);
    } catch(e) {
      const transient = e.code === 'ECONNRESET' || e.code === 'ETIMEDOUT' || e.code === 'ECONNREFUSED' || e.code === 'ECONNABORTED';
      if (!transient || i === retries - 1) throw e;
      process.stdout.write(`  [n8nGet retry ${i+1}/${retries-1}: ${e.code}] `);
      await sleep(2000 * (i + 1));
    }
  }
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function sendText(number, text) {
  return evoRequest(`/message/sendText/${INSTANCE}`, { number, text, delay: 500 });
}

// Enviar áudio PTT via base64 (gerado pelo TTS ou de arquivo)
async function sendAudioBase64(number, base64mp3) {
  return evoRequest(`/message/sendWhatsAppAudio/${INSTANCE}`, {
    number,
    audio: base64mp3,   // base64 do mp3
    delay: 500,
  });
}

// Gerar áudio via TTS — usa o endpoint /util/tts da app (suporta Gemini PCM→WAV)
async function generateTtsBase64(text) {
  const r = await fetch('https://app.vendly.chat/util/tts', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${OR_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ text, model: MODEL_TTS, voice: VOICE_TTS }),
  });
  if (!r.ok) {
    const detail = await r.json().catch(() => ({}));
    throw new Error(`TTS HTTP ${r.status}: ${JSON.stringify(detail)}`);
  }
  const data = await r.json();
  if (!data.base64) throw new Error(`TTS sem base64: ${JSON.stringify(data)}`);
  return data.base64;
}

// Enviar imagem via URL pública
function sendImage(number, mediaUrl, caption = '') {
  return evoRequest(`/message/sendMedia/${INSTANCE}`, {
    number, mediatype: 'image', media: mediaUrl, caption,
  });
}

async function inspectExec(execId) {
  const exec = await n8nGet(`/api/v1/executions/${execId}?includeData=true`);
  const rd = exec.data?.resultData?.runData ?? {};
  const allKeys = Object.keys(rd);

  // Coleta todos os tool calls (1ª e 2ª rodada)
  const eqKeys = allKeys.filter(n => n.includes('Extrair Query'));
  const toolNames = eqKeys.flatMap(k =>
    (rd[k] ?? []).map(r => r?.data?.main?.[0]?.[0]?.json?.toolName).filter(Boolean)
  );
  const eqKey    = eqKeys[0];
  const toolData = rd[eqKey]?.[0]?.data?.main?.[0]?.[0]?.json;
  const toolName = toolData?.toolName ?? null;
  const toolArgs = toolData?.args ?? null;

  const evoChunks = (rd['Evolution Enviar'] ?? [])
    .map(c => c?.data?.main?.[0]?.[0]?.json?.message?.conversation)
    .filter(Boolean);
  const reply = evoChunks.join(' | ');

  const transKey  = allKeys.find(n => n.toLowerCase().includes('transcrever'));
  const transResp = rd[transKey]?.[0]?.data?.main;
  const transText = (transResp?.[0]?.[0]?.json ?? transResp?.[1]?.[0]?.json)
    ?.choices?.[0]?.message?.content ?? null;

  const escKey  = allKeys.find(n => n.includes('Escalada Humano'));
  const escData = rd[escKey]?.[0]?.data?.main?.[0]?.[0]?.json;
  const escalated = !!escData?.takeover_key;

  const pcData  = rd['Parsear Chunks']?.[0]?.data?.main?.[0];
  const escFlag = pcData?.some(i => i.json?.escalarHumano === true) ?? false;

  return { toolName, toolNames, toolArgs, reply, transText, escalated, escFlag };
}

let execBaseline = 0;

async function getLatestExecId() {
  const r = await n8nGet('/api/v1/executions?workflowId=jleu4RPvSnYDL8Gd&limit=1');
  return r.data?.[0]?.id ?? null;
}

async function waitForNewExec(sinceId, timeoutMs = 40000) {
  // O workflow jleu4RPvSnYDL8Gd tem múltiplos entry points:
  // - Auto-Open (rápido, < 1s) — quando Evolution trigga Chatwoot
  // - Agent Executor (lento, > 3s) — o fluxo real de resposta
  // Estratégia: esperar > 2 execuções completas e retornar a mais longa (agent),
  // ou a primeira que durar > 2s (agent). Auto-Open < 500ms.
  const MIN_AGENT_DURATION_MS = 2000;
  const start = Date.now();
  let foundId = null;
  while (Date.now() - start < timeoutMs) {
    await sleep(2000);
    let r;
    try {
      r = await n8nGet('/api/v1/executions?workflowId=jleu4RPvSnYDL8Gd&limit=10');
    } catch(e) {
      process.stdout.write(`  [poll err: ${e.code ?? e.message}] `);
      await sleep(3000);
      continue;
    }
    const newer = (r.data ?? []).filter(e => Number(e.id) > Number(sinceId));
    // Prefer an agent execution (duration > 2s) over quick Auto-Open ones
    const done = newer.filter(e => e.status === 'success' || e.status === 'error');
    if (done.length > 0) {
      const agentExec = done.find(e => {
        const dur = new Date(e.stoppedAt) - new Date(e.startedAt);
        return dur >= MIN_AGENT_DURATION_MS;
      });
      if (agentExec) return { id: agentExec.id, status: agentExec.status };
      // All done execs are fast (Auto-Open) — keep waiting for agent exec
      if (!foundId && newer.length > 0) { foundId = newer[0].id; process.stdout.write(`  ... exec ${newer[0].id} rodando`); }
    } else if (newer.length > 0) {
      if (!foundId) { foundId = newer[0].id; process.stdout.write(`  ... exec ${newer[0].id} rodando`); }
    }
  }
  // Fallback: return the slowest completed exec we saw
  return foundId ? { id: foundId, status: 'timeout_running' } : null;
}

// ── Test cases ────────────────────────────────────────────────────────────────

const results = [];

async function run(label, fn, opts = {}) {
  const { timeout = 40000, inspect = false } = opts;
  console.log(`\n${'─'.repeat(60)}`);
  console.log(`▶ ${label}`);
  const lastId = await getLatestExecId();
  let evtSent;
  try {
    evtSent = await fn();
    console.log(`  📤 Enviado → HTTP ${evtSent.status}  body: ${String(evtSent.body ?? '').slice(0, 80)}`);
  } catch(e) {
    console.log(`  ❌ Erro ao enviar: ${e.message}`);
    results.push({ label, ok: false, reason: 'send_error: ' + e.message });
    return null;
  }
  if (evtSent.status !== 201 && evtSent.status !== 200) {
    const reason = `HTTP ${evtSent.status}: ${String(evtSent.body ?? '').slice(0, 100)}`;
    console.log(`  ❌ Falha: ${reason}`);
    results.push({ label, ok: false, reason });
    return null;
  }
  console.log(`  ⏳ Aguardando execução N8N...`);
  const exec = await waitForNewExec(lastId, timeout);
  if (!exec) {
    console.log(`\n  ⚠️  Nenhuma execução nova em ${timeout/1000}s`);
    results.push({ label, ok: false, reason: `timeout — sem exec N8N (${timeout/1000}s)` });
    return null;
  }
  const ok = exec.status === 'success';
  process.stdout.write('\n');
  console.log(`  ${ok ? '✅' : '❌'} Execução ${exec.id} — ${exec.status}`);
  results.push({ label, ok, execId: exec.id, execStatus: exec.status });

  if (inspect && ok) {
    const ins = await inspectExec(exec.id);
    if (ins.toolName) console.log(`  🔧 Tool: ${ins.toolName} | args: ${JSON.stringify(ins.toolArgs ?? {}).slice(0,100)}`);
    if (ins.transText) console.log(`  🎤 Transcrição: "${ins.transText}"`);
    if (ins.reply) console.log(`  💬 Resposta: "${ins.reply.slice(0, 120)}"`);
    if (ins.escalated) console.log(`  🚨 ESCALAÇÃO ativada`);
    return { exec, ins };
  }
  return { exec };
}

// ─────────────────────────────────────────────────────────────────────────────

async function main() {
  console.log('╔══════════════════════════════════════════════════════════╗');
  console.log('║    VENDLY / LT — Test Suite v3 (full system coverage)   ║');
  console.log('╚══════════════════════════════════════════════════════════╝');
  console.log(`Instance : ${INSTANCE}  (naldocabral)`);
  console.log(`Bot LT   : ${BOT_NUM}`);
  console.log(`Rest Grp : ${REST_GRP}`);
  console.log(`Delv Grp : ${DELV_GRP}`);

  // ══════════════════════════════════════════════════════════════
  // Limpar HT de MY_NUM no inicio -- pode ter ficado ativo de rodadas anteriores
  try {
    const clearInit = await fetch('https://app.vendly.chat/tool/system_clear_contact', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: MY_NUM, instance: 'livraison-totale' }),
    });
    const cd = await clearInit.json().catch(() => ({}));
    console.log(`\n  \ud83e\uddf9 HT limpo no inicio: ${JSON.stringify(cd).slice(0,80)}`);
    // Também limpa sessão Redis para MY_NUM — evita contaminação de histórico entre rodadas
    const sessionClear = await fetch('https://app.vendly.chat/tool/redis_delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ keys: [`sessao:livraison-totale:${MY_NUM}@s.whatsapp.net`] }),
    });
    const sc = await sessionClear.json().catch(() => ({}));
    console.log(`  \ud83e\uddf9 Sessão individual limpa: ${JSON.stringify(sc).slice(0,80)}`);
  } catch(e) { console.log(`\n  \u26a0\ufe0f  Nao foi possivel limpar HT inicial: ${e.message}`); }
  await sleep(2000);
  // FASE 1 — Conversas Individuais
  // ══════════════════════════════════════════════════════════════
  console.log('\n══ FASE 1: Conversas Individuais ══════════════════════════');

  await run('1 - Texto individual → bot LT', () =>
    sendText(BOT_NUM, 'Oi, tudo bem? Esse é um teste automático.'), { inspect: true });
  await sleep(8000);

  await run('2 - Pergunta sobre horário → bot LT', () =>
    sendText(BOT_NUM, 'Qual é o horário de funcionamento?'), { inspect: true });
  await sleep(8000);

  // ══════════════════════════════════════════════════════════════
  // FASE 2 — Fluxo de Pedido (Grupo Restaurante)
  // ══════════════════════════════════════════════════════════════
  console.log('\n══ FASE 2: Pedido no Grupo Restaurante ════════════════════');

  // Limpar sessões dos grupos antes da FASE 2 — evita contaminação de runs anteriores
  try {
    const grpClear = await fetch('https://app.vendly.chat/tool/redis_delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ keys: [
        `sessao:livraison-totale:${REST_GRP}`,
        `sessao:livraison-totale:${DELV_GRP}`,
        `human_takeover:livraison-totale:${REST_GRP}`,
        `human_takeover:livraison-totale:${DELV_GRP}`,
      ]}),
    });
    const gc = await grpClear.json().catch(() => ({}));
    console.log(`  🧹 Sessões de grupo limpas: ${JSON.stringify(gc).slice(0,80)}`);
  } catch(e) { console.log(`  ⚠️  Não foi possível limpar sessões de grupo: ${e.message}`); }
  await sleep(500);

  await run('3 - Saudação no grupo restaurante', () =>
    sendText(REST_GRP, 'Oi Carol, tudo certo?'), { inspect: true });
  await sleep(8000);

  const r4 = await run('4 - Novo pedido com externalCode e paymentMethod', () =>
    sendText(REST_GRP,
      'Pedido novo:\nCliente: Maria Silva\nEndereço: Rua Primavera, 45 - Cosmos\n' +
      'Telefone: 21 98765-0001\nItens: 1x Frango grelhado, 1x Coca-Cola 2L\n' +
      'Valor: R$ 42,00\nPagamento: cartão na entrega\nCódigo externo: #2001'
    ), { inspect: true, timeout: 50000 });
  await sleep(15000);

  if (r4?.ins?.toolName) {
    const ok4 = ['delivery_draft_order', 'delivery_update_draft'].includes(r4.ins.toolName);
    console.log(`  ${ok4 ? '✅' : '⚠️ '} Tool: ${r4.ins.toolName}`);
    console.log(`  ${r4.ins.toolArgs?.externalCode ? '✅' : '❌'} externalCode: "${r4.ins.toolArgs?.externalCode}"`);
    console.log(`  ${r4.ins.toolArgs?.paymentMethod ? '✅' : '❌'} paymentMethod: "${r4.ins.toolArgs?.paymentMethod}"`);
    if (!ok4) { const last = results[results.length-1]; last.ok = false; last.reason = `Tool incorreta: ${r4.ins.toolName}`; }
  }

  const r5 = await run('5 - Confirmar pedido → delivery_confirm_order + código LT', () =>
    sendText(REST_GRP, 'ok, pode mandar'), { inspect: true, timeout: 55000 });
  await sleep(20000);

  if (r5?.ins) {
    const ok5 = (r5.ins.toolNames ?? [r5.ins.toolName]).includes('delivery_confirm_order');
    console.log(`  ${ok5 ? '✅' : '❌'} Tool: ${r5.ins.toolNames?.join('→') ?? r5.ins.toolName} (esperado: delivery_confirm_order em qualquer rodada)`);
    const hasLt = /LT-[A-Z0-9]/.test(r5.ins.reply ?? '');
    console.log(`  ${hasLt ? '✅' : '❌'} Código LT-XXXXX na resposta: ${r5.ins.reply?.match(/LT-[A-Z0-9\-]+/)?.[0] ?? 'NÃO encontrado'}`);
    if (!ok5) { const last = results[results.length-1]; last.ok = false; last.reason = `Tool incorreta: ${r5.ins.toolNames?.join('→') ?? r5.ins.toolName}`; }
  }

  // ══════════════════════════════════════════════════════════════
  // FASE 3 — Fluxo do Entregador
  // ══════════════════════════════════════════════════════════════
  console.log('\n══ FASE 3: Fluxo Entregador ═══════════════════════════════');

  await run('6 - Saudação no grupo entregadores', () =>
    sendText(DELV_GRP, 'oi Carol'), { inspect: true });
  await sleep(8000);

  await run('7 - Entregador aceita pedido', () =>
    sendText(DELV_GRP, 'eu faço esse pedido, to pertinho daí'), { inspect: true, timeout: 50000 });
  await sleep(10000);

  await run('8 - ETA do entregador', () =>
    sendText(DELV_GRP, 'chego em uns 5 minutinhos'), { inspect: true });
  await sleep(8000);

  await run('9 - Status: cheguei no restaurante', () =>
    sendText(DELV_GRP, 'cheguei no restaurante'), { inspect: true });
  await sleep(8000);

  await run('10 - Status: peguei o pedido, a caminho', () =>
    sendText(DELV_GRP, 'peguei o pedido, to indo pro cliente'), { inspect: true });
  await sleep(8000);

  await run('11 - Status: entregue', () =>
    sendText(DELV_GRP, 'entregue, tudo certo'), { inspect: true, timeout: 50000 });
  await sleep(10000);

  const r12 = await run('12 - Acerto financeiro: entregador reporta valores', () =>
    sendText(DELV_GRP,
      'fiz o acerto com o restaurante. Recebi R$ 42 do cliente, repassei R$ 36 pro restaurante, minha taxa foi R$ 6'
    ), { inspect: true, timeout: 55000 });
  await sleep(15000);

  if (r12?.ins?.toolName) {
    const ok12 = (r12.ins.toolNames ?? [r12.ins.toolName]).includes('delivery_log_settlement');
    console.log(`  ${ok12 ? '✅' : '❌'} Tool: ${r12.ins.toolNames?.join('→') ?? r12.ins.toolName} (esperado: delivery_log_settlement em qualquer rodada)`);
    if (!ok12) { const last = results[results.length-1]; last.ok = false; last.reason = `Tool incorreta: ${r12.ins.toolNames?.join('→') ?? r12.ins.toolName}`; }
  }

  // ══════════════════════════════════════════════════════════════
  // FASE 4 — Áudio PTT
  // ══════════════════════════════════════════════════════════════
  console.log('\n══ FASE 4: Áudio PTT (Transcrição) ═══════════════════════');

  let audioInd;
  process.stdout.write('\n  🎤 Gerando TTS individual...');
  try {
    audioInd = await generateTtsBase64('Olá! Quero saber qual é o prazo de entrega para o bairro de Cosmos.');
    console.log(` ✅ ${Math.round(audioInd.length * 0.75 / 1024)}KB`);
  } catch(e) { console.log(` ❌ ${e.message}`); }

  if (audioInd) {
    const r13 = await run('13 - PTT individual → transcrição + resposta', () =>
      sendAudioBase64(BOT_NUM, audioInd), { inspect: true, timeout: 55000 });
    await sleep(25000);
    if (r13?.ins?.transText) console.log(`  ✅ Transcrição: "${r13.ins.transText}"`);
    else if (r13?.exec) console.log('  ⚠️  Transcrição não encontrada nos dados');
  }

  let audioGrp;
  process.stdout.write('\n  🎤 Gerando TTS grupo restaurante...');
  try {
    audioGrp = await generateTtsBase64('Carol, pedido novo. Endereço Rua Acajutiba número 15 Cosmos. Cliente Fernanda. Valor quarenta reais. Pagamento dinheiro. Código 2002.');
    console.log(` ✅ ${Math.round(audioGrp.length * 0.75 / 1024)}KB`);
  } catch(e) { console.log(` ❌ ${e.message}`); }

  if (audioGrp) {
    const r13b = await run('13b - PTT grupo restaurante → transcrição + ação', () =>
      sendAudioBase64(REST_GRP, audioGrp), { inspect: true, timeout: 55000 });
    await sleep(25000);
    if (r13b?.ins?.transText) console.log(`  ✅ Transcrição: "${r13b.ins.transText.slice(0,80)}"`);
    if (r13b?.ins?.toolName)  console.log(`  🔧 Tool chamada: ${r13b.ins.toolName}`);
  }

  // ══════════════════════════════════════════════════════════════
  // FASE 5 — Imagem Multimodal
  // ══════════════════════════════════════════════════════════════
  console.log('\n══ FASE 5: Imagem Multimodal ══════════════════════════════');

  // Limpar HT criado pelo test 13 (escalação de áudio) antes do teste de imagem
  try {
    const clrImg = await fetch('https://app.vendly.chat/tool/system_clear_contact', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: MY_NUM, instance: 'livraison-totale' }),
    });
    const ci = await clrImg.json().catch(() => ({}));
    console.log(`  🧹 HT limpo pré-imagem: ${JSON.stringify(ci).slice(0,80)}`);
  } catch(e) { console.log(`  ⚠️  Não foi possível limpar HT pré-imagem: ${e.message}`); }
  await sleep(1000);

  // picsum.photos é CDN global sem bot protection — mais confiável que Wikipedia
  const r14 = await run('14 - Imagem → bot descreve (multimodal)', () =>
    sendImage(BOT_NUM, 'https://picsum.photos/id/237/300/200', 'O que você vê nessa imagem?'),
    { inspect: true, timeout: 40000 });
  await sleep(15000);
  if (r14?.ins?.reply) console.log(`  💬 Descrição: "${r14.ins.reply.slice(0, 120)}"`);

  // ══════════════════════════════════════════════════════════════
  // FASE 6 — Escalação Humana e Human Takeover
  // ══════════════════════════════════════════════════════════════
  console.log('\n══ FASE 6: Escalação Humana e Takeover ════════════════════');

  // Limpar sessão antes (HT pode estar ativo de testes anteriores)
  try {
    const clear = await fetch('https://app.vendly.chat/tool/system_clear_contact', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: MY_NUM, instance: 'livraison-totale' }),
    });
    const cd = await clear.json().catch(() => ({}));
    console.log(`\n  🧹 Sessão limpa pré-escalação: ${JSON.stringify(cd).slice(0,60)}`);
  } catch(e) { console.log(`\n  ⚠️  Não foi possível limpar sessão: ${e.message}`); }
  await sleep(1000);

  const r15 = await run('15 - Pedir atendente humano → escalação + Chatwoot', () =>
    sendText(BOT_NUM, 'preciso falar com um atendente humano urgente'),
    { inspect: true, timeout: 40000 });
  await sleep(10000);

  if (r15?.ins) {
    console.log(`  ${r15.ins.escFlag ? '✅' : '❌'} escalarHumano: ${r15.ins.escFlag}`);
    console.log(`  ${r15.ins.escalated ? '✅' : '❌'} Escalada Humano nó rodou: ${r15.ins.escalated}`);
    if (!r15.ins.escFlag || !r15.ins.escalated) {
      const last = results[results.length-1];
      last.ok = false;
      last.reason = !r15.ins.escFlag ? 'escalarHumano não setado' : 'Escalada Humano não rodou';
    }
    // Verificar Chatwoot labels
    try {
      const contacts = await cwGet(`/contacts/search?q=naldocabral&page=1`);
      const cId = contacts.payload?.[0]?.id;
      if (cId) {
        const convs = await cwGet(`/contacts/${cId}/conversations`);
        const conv = (convs.payload ?? []).sort((a,b) => b.id - a.id)[0];
        if (conv) {
          const labels = conv.labels ?? [];
          const hasHumano = labels.some(l => /humano|esc/i.test(String(l)));
          console.log(`  ${hasHumano ? '✅' : '⚠️ '} Chatwoot conv ${conv.id} labels: [${labels.join(', ')}]`);
        }
      }
    } catch(e) { console.log('  ⚠️  Chatwoot check:', e.message); }
  }

  // ── Teste 16: Mensagem durante HT ativo → bot silencia ─────────
  console.log(`\n${'─'.repeat(60)}`);
  console.log(`▶ 16 - Mensagem durante HT ativo → AGENT NÃO deve rodar`);
  const execBeforeHT = await getLatestExecId();
  const sentHT = await sendText(BOT_NUM, 'oi, alguma novidade?').catch(() => null);
  if (sentHT?.status === 201) {
    console.log(`  📤 Mensagem enviada com HT ativo`);
    console.log(`  ⏳ Aguardando 22s — esperando silêncio do bot...`);
    await sleep(22000);
    const execAfterHT = await getLatestExecId();
    const silent = Number(execAfterHT) === Number(execBeforeHT);
    console.log(`  ${silent ? '✅' : '❌'} ${silent ? 'Bot silenciou (HT ativo)' : `Nova exec ${execAfterHT} rodou — HT deveria bloquear`}`);
    results.push({ label: '16 - Mensagem com HT ativo → bot silencia', ok: silent,
      reason: silent ? null : `exec ${execAfterHT} rodou indevidamente` });
  } else {
    results.push({ label: '16 - Mensagem com HT ativo → bot silencia', ok: false, reason: 'envio falhou' });
  }

  // ── Teste 17: Limpar HT + bot retoma ───────────────────────────
  console.log(`\n${'─'.repeat(60)}`);
  console.log(`▶ 17 - Limpar HT via MCP → bot retoma`);
  try {
    const clr = await fetch('https://app.vendly.chat/tool/system_clear_contact', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: MY_NUM, instance: 'livraison-totale' }),
    });
    const cd = await clr.json().catch(() => ({}));
    console.log(`  🧹 HT limpo: ${JSON.stringify(cd).slice(0,80)}`);
  } catch(e) { console.log(`  ⚠️  Erro ao limpar HT: ${e.message}`); }
  await sleep(1000);

  const r17 = await run('17 - Pós-HT → bot responde normalmente', () =>
    sendText(BOT_NUM, 'tudo bem, já posso ser atendido pelo bot?'),
    { inspect: true, timeout: 40000 });
  await sleep(8000);
  if (r17?.ins?.reply) console.log(`  ✅ Bot respondeu: "${r17.ins.reply.slice(0, 100)}"`);

  // ══════════════════════════════════════════════════════════════
  // FASE 7 — Verificação Chatwoot
  // ══════════════════════════════════════════════════════════════
  console.log('\n══ FASE 7: Verificação Chatwoot ═══════════════════════════');
  console.log(`\n${'─'.repeat(60)}`);
  console.log(`▶ 18 - Chatwoot: conversas, mensagens e labels`);
  try {
    const contacts = await cwGet(`/contacts/search?q=naldocabral&page=1`);
    const contact = contacts.payload?.[0];
    if (contact) {
      console.log(`  ✅ Contato: ${contact.name} (id ${contact.id})`);
      const convList = await cwGet(`/contacts/${contact.id}/conversations`);
      const convs = (convList.payload ?? []).sort((a, b) => b.id - a.id);
      console.log(`  📂 ${convs.length} conversa(s)`);
      convs.slice(0, 3).forEach(c => {
        console.log(`    Conv ${c.id}: status=${c.status} | labels=[${(c.labels??[]).join(', ')}]`);
      });
      results.push({ label: '18 - Chatwoot: conversa existe e tem histórico', ok: convs.length > 0 });
    } else {
      console.log('  ❌ Contato naldocabral não encontrado no Chatwoot');
      results.push({ label: '18 - Chatwoot: conversa existe e tem histórico', ok: false, reason: 'contato não encontrado' });
    }
  } catch(e) {
    console.log('  ❌ Erro Chatwoot:', e.message);
    results.push({ label: '18 - Chatwoot: conversa existe e tem histórico', ok: false, reason: e.message });
  }

  // ══════════════════════════════════════════════════════════════
  // RELATÓRIO FINAL
  // ══════════════════════════════════════════════════════════════
  console.log('\n╔══════════════════════════════════════════════════════════╗');
  console.log('║                   RELATÓRIO FINAL                       ║');
  console.log('╚══════════════════════════════════════════════════════════╝');
  let pass = 0, fail = 0;
  for (const r of results) {
    const icon = r.ok ? '✅' : '❌';
    const detail = r.ok ? (r.execId ? `exec ${r.execId}` : 'ok') : (r.reason ?? r.execStatus ?? 'falhou');
    console.log(`${icon}  ${r.label.padEnd(52)} ${detail}`);
    r.ok ? pass++ : fail++;
  }
  console.log(`\n  Total: ${results.length}  ✅ ${pass}  ❌ ${fail}`);

  if (fail > 0) {
    console.log('\n  Falhas para inspecionar:');
    results.filter(r => !r.ok && r.execId).forEach(r => console.log(`    exec ${r.execId} → ${r.label}`));
  }
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });

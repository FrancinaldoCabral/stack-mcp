/**
 * fix-audio-chatwoot.mjs
 *
 * Corrige: áudios do agente não aparecem no Chatwoot.
 *
 * Causa: texto vai via Chatwoot API → Evolution → WA (aparece no Chatwoot ✓)
 *        áudio vai via Evolution API direto → WA (bypassa Chatwoot ✗)
 *
 * Fix: após Evolution send audio, também envia o texto do áudio para o Chatwoot,
 *      igual ao fluxo de texto. Assim agentes veem o conteúdo da resposta.
 */

import dotenv from 'dotenv';
dotenv.config();

const N8N_BASE = process.env.N8N_URL;
const N8N_H = {
  'X-N8N-API-KEY': process.env.N8N_API_KEY,
  'Content-Type': 'application/json',
  'Accept': 'application/json',
};

const EXECUTOR_ID = 'jleu4RPvSnYDL8Gd';
const CW_TOKEN = process.env.CHATWOOT_API_KEY;
const CW_URL = process.env.CHATWOOT_URL || 'https://chatwoot.vendly.chat';
const CW_ACCOUNT = process.env.CHATWOOT_ACCOUNT_ID || '1';

async function fixAudioChatwoot() {
  console.log('=== Fix áudio no Chatwoot ===');

  const res = await fetch(`${N8N_BASE}/api/v1/workflows/${EXECUTOR_ID}`, { headers: N8N_H });
  const wf = await res.json();

  if (wf.nodes.find(n => n.name === 'Chatwoot Enviar Audio')) {
    console.log('  Chatwoot Enviar Audio já existe — pulando');
    return;
  }

  // ── 1. Adicionar nó Chatwoot Enviar Audio ─────────────────────────────
  wf.nodes.push({
    id: 'cw-enviar-audio',
    name: 'Chatwoot Enviar Audio',
    type: 'n8n-nodes-base.code',
    typeVersion: 2,
    position: [1980, 120],
    parameters: {
      jsCode: `
// Enviar o texto do áudio para o Chatwoot
// (o áudio já foi enviado para WA via Evolution API)
// Isso garante que agentes vejam o conteúdo da resposta do bot no Chatwoot
const chunks = $('Parsear Chunks').all();
const fullText = chunks.map(c => c.json.chunk).filter(Boolean).join('\\n');
const convId = String(chunks[0]?.json?.conversation_id ?? '');
const accId = String(chunks[0]?.json?.account_id ?? '${CW_ACCOUNT}');

if (!convId || !fullText) return [$input.first()];

try {
  await fetch('${CW_URL}/api/v1/accounts/' + accId + '/conversations/' + convId + '/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'api_access_token': '${CW_TOKEN}' },
    body: JSON.stringify({ content: fullText, message_type: 'outgoing', private: false }),
  });
} catch (e) {}

return [$input.first()];
`,
    },
  });
  console.log('  Nó Chatwoot Enviar Audio adicionado');

  // ── 2. Conectar Evolution send audio → TAMBÉM para Chatwoot Enviar Audio ─
  // Atual: Evolution send audio → [["Preparar Sessao audio"]]
  // Novo:  Evolution send audio → [["Preparar Sessao audio", "Chatwoot Enviar Audio"]]
  const evoAudioConns = wf.connections['Evolution send audio'];
  if (evoAudioConns?.main?.[0]) {
    // Adicionar Chatwoot Enviar Audio em paralelo com Preparar Sessao audio
    evoAudioConns.main[0].push({ node: 'Chatwoot Enviar Audio', type: 'main', index: 0 });
    console.log('  Conexão: Evolution send audio → Chatwoot Enviar Audio (paralelo)');
  }

  // ── 3. PUT atualizado ──────────────────────────────────────────────────
  const putRes = await fetch(`${N8N_BASE}/api/v1/workflows/${EXECUTOR_ID}`, {
    method: 'PUT',
    headers: N8N_H,
    body: JSON.stringify({
      name: wf.name,
      nodes: wf.nodes,
      connections: wf.connections,
      settings: {
        executionOrder: wf.settings?.executionOrder ?? 'v1',
        saveManualExecutions: wf.settings?.saveManualExecutions ?? true,
      },
    }),
  });

  if (putRes.status !== 200) {
    const err = await putRes.text();
    throw new Error(`PUT falhou ${putRes.status}: ${err.slice(0, 400)}`);
  }

  const updated = await putRes.json();
  console.log(`  ✓ [AGENT] Executor atualizado. Nós: ${updated.nodes?.length}`);
}

fixAudioChatwoot().catch(e => { console.error('Erro:', e.message); process.exit(1); });

/**
 * Teste rápido: TTS → PTT → verificar transcrição no N8N
 */
import 'dotenv/config';
import https from 'https';

const EVO_URL = process.env.EVOLUTION_URL;
const EVO_KEY = process.env.EVOLUTION_API_KEY;
const N8N_URL = process.env.N8N_URL;
const N8N_KEY = process.env.N8N_API_KEY;
const OR_KEY  = process.env.OPENROUTER_API_KEY;
const MODEL_TTS = process.env.MODEL_TTS || 'openai/gpt-4o-mini-tts-2025-12-15';
const VOICE_TTS = process.env.VOICE_TTS || 'alloy';
const INSTANCE  = 'Meu cel';
const BOT_NUM   = '556584011436';

function n8nGet(path) {
  return new Promise((resolve, reject) => {
    const url = new URL(N8N_URL + path);
    const req = https.request({ hostname: url.hostname, path: url.pathname + url.search,
      method: 'GET', headers: { 'X-N8N-API-KEY': N8N_KEY, 'Accept': 'application/json' }
    }, res => {
      let d = ''; res.on('data', c => d += c);
      res.on('end', () => resolve(JSON.parse(d)));
    }); req.on('error', reject); req.end();
  });
}
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function main() {
  // 1. Gera áudio TTS
  console.log('1. Gerando TTS com model:', MODEL_TTS);
  const r1 = await fetch('https://openrouter.ai/api/v1/audio/speech', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${OR_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: MODEL_TTS, input: 'Olá! Qual o tempo de entrega para o bairro de Cosmos?', voice: VOICE_TTS, response_format: 'mp3' }),
  });
  if (!r1.ok) { console.error('TTS erro', r1.status, await r1.text()); process.exit(1); }
  const audioB64 = Buffer.from(await r1.arrayBuffer()).toString('base64');
  console.log(`   ✅ TTS OK — ${Math.round(audioB64.length * 0.75 / 1024)}KB`);

  // 2. Registrar timestamp antes de enviar
  const before = Date.now();

  // 3. Envia como PTT
  console.log('2. Enviando PTT para', BOT_NUM, '...');
  const r2 = await fetch(EVO_URL + '/message/sendWhatsAppAudio/' + encodeURIComponent(INSTANCE), {
    method: 'POST',
    headers: { 'apikey': EVO_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ number: BOT_NUM, audio: audioB64, delay: 500 }),
  });
  const res2 = await r2.json();
  if (r2.status !== 201) { console.error('Evolution erro', r2.status, JSON.stringify(res2)); process.exit(1); }
  console.log(`   ✅ PTT enviado — id: ${res2.key?.id}`);

  // 4. Aguardar N8N processar (debounce 5s + download + transcrição + LLM ~30s total)
  console.log('3. Aguardando N8N processar (40s)...');
  await sleep(40000);

  // 5. Buscar exec mais recente após o envio
  const execs = await n8nGet('/api/v1/executions?workflowId=jleu4RPvSnYDL8Gd&limit=5');
  const exec = execs.data?.find(e => new Date(e.startedAt).getTime() > before);
  if (!exec) { console.log('❌ Nenhuma execução nova encontrada após envio. Execs recentes:', execs.data?.map(e => e.id+'/'+e.status).join(', ')); process.exit(1); }
  console.log(`   Exec: ${exec.id} | ${exec.status}`);

  // 6. Inspecionar nó Transcrever Áudio
  const execDetail = await n8nGet(`/api/v1/executions/${exec.id}?includeData=true`);
  const runData = execDetail.data?.resultData?.runData;
  if (!runData) { console.log('❌ sem runData'); process.exit(1); }

  const tKey = Object.keys(runData).find(n => n.toLowerCase().includes('transcrever') || n.toLowerCase().includes('transcri'));
  const cpKey = Object.keys(runData).find(n => n.includes('Construir Prompt'));
  const orKey = Object.keys(runData).find(n => n.includes('OpenRouter') && !n.includes('TTS'));
  const sendKey = Object.keys(runData).find(n => n.includes('send audio') || n.includes('Chatwoot Enviar Audio'));

  console.log('\n── Resultado da transcrição ──────────────────────────');
  if (tKey) {
    const run = runData[tKey]?.[0];
    // Tentar branch 0 e 1 (branch 0 = sucesso, branch 1 = erro do IF)
    const j0 = run?.data?.main?.[0]?.[0]?.json;
    const j1 = run?.data?.main?.[1]?.[0]?.json;
    const j = j0 ?? j1;
    const transcription = j?.choices?.[0]?.message?.content || j?.error?.message || JSON.stringify(j).slice(0, 200);
    console.log('Transcrever Áudio:', transcription);
  } else {
    console.log('❌ Nó Transcrever Áudio não encontrado nos nós executados');
    console.log('   Nós disponíveis:', Object.keys(runData).filter(n => n.toLowerCase().includes('audio') || n.toLowerCase().includes('transcri')));
  }

  if (cpKey) {
    const j = runData[cpKey]?.[0]?.data?.main?.[0]?.[0]?.json;
    console.log('Mensagem no prompt:', String(j?.mensagem ?? j?.text ?? '').slice(0, 200));
  }

  if (orKey) {
    const j = runData[orKey]?.[0]?.data?.main?.[0]?.[0]?.json;
    const reply = j?.choices?.[0]?.message?.content || '';
    console.log('Resposta do bot:', String(reply).slice(0, 300));
  }

  if (sendKey) {
    const j = runData[sendKey]?.[0]?.data?.main?.[0]?.[0]?.json;
    console.log('Audio resposta enviado:', j?.key?.id || j?.id || 'sim');
  }

  console.log('\n' + (exec.status === 'success' ? '✅ SUCESSO — transcrição e resposta funcionando' : '❌ FALHA — status: ' + exec.status));
}

main().catch(e => { console.error('ERRO:', e.message); process.exit(1); });

/**
 * fix-audio-transcricao.mjs
 * 
 * Reestrutura a pipeline de transcrição de áudio no [AGENT] Executor:
 * 
 * ANTES (quebrado):
 *   IF Audio? → Baixar Áudio (HTTP, binary) → Prep Transcrição (Code, OpenRouter cred)
 *   Problema: Code node não consegue ler binary via getBinaryDataBuffer, nem usar httpRequestWithAuthentication
 * 
 * DEPOIS (correto):
 *   IF Audio? → Prep Transcrição (Code, sem cred) → Transcrever Áudio (HTTP Request, OpenRouter cred)
 *   Prep: baixa áudio via httpRequest(url, encoding:null) → Buffer.from(str,'binary').toString('base64')
 *   Transcrever: chama OpenRouter com JSON body {model, messages:[{content:[text,image_url(base64)]}]}
 * 
 * Também atualiza Construir Prompt para ler transcrição de $('Transcrever Áudio')
 */

import 'dotenv/config';

const H = { 'X-N8N-API-KEY': process.env.N8N_API_KEY, 'Accept': 'application/json', 'Content-Type': 'application/json' };
const WF_ID = 'jleu4RPvSnYDL8Gd';

// ── 1. Código do Prep Transcrição (Code node, SEM credencial)
// Baixa áudio via httpRequest, converte para base64, sem chamar OpenRouter
const PREP_CODE = `const msg = $('Desembalar Payload').first().json;
const audioUrl = msg.metadata?.url ?? '';
if (!audioUrl) return [{ json: { ...msg, audioBase64: null, audioMimeType: 'audio/ogg', audioOk: false } }];

let audioBase64 = null;
let audioMimeType = 'audio/ogg';

try {
  const body = await this.helpers.httpRequest({
    method: 'GET',
    url: audioUrl,
    encoding: null,
    ignoreHttpStatusErrors: true,
  });
  // body pode ser Buffer ou string dependendo da versão do N8N
  let buf;
  if (Buffer.isBuffer(body)) {
    buf = body;
  } else {
    buf = Buffer.from(body, 'binary');
  }
  if (buf.length > 0) {
    audioBase64 = buf.toString('base64');
    const sig = buf.slice(0, 4).toString('ascii');
    if (sig.startsWith('OggS')) audioMimeType = 'audio/ogg';
    else if (sig.includes('ftyp') || buf.slice(0, 12).toString('ascii').includes('M4A ')) audioMimeType = 'audio/mp4';
    else audioMimeType = 'audio/ogg';
  }
} catch (e) {}

return [{ json: { ...msg, audioBase64, audioMimeType, audioOk: !!audioBase64 } }];`;

// ── 2. Novo nó HTTP Request: Transcrever Áudio (OpenRouter)
const TRANSCREVER_NODE = {
  id: 'transcrever-audio',
  name: 'Transcrever Áudio',
  type: 'n8n-nodes-base.httpRequest',
  typeVersion: 4.2,
  position: [0, 0],  // será atualizado
  parameters: {
    method: 'POST',
    url: 'https://openrouter.ai/api/v1/chat/completions',
    authentication: 'genericCredentialType',
    genericAuthType: 'httpHeaderAuth',
    sendBody: true,
    specifyBody: 'json',
    jsonBody: '={{ JSON.stringify({ model: \'google/gemini-2.0-flash-lite-001\', messages: [{ role: \'user\', content: [{ type: \'text\', text: \'Transcreva este áudio para texto em português. Retorne SOMENTE o texto transcrito, sem comentários adicionais.\' }, { type: \'image_url\', image_url: { url: \'data:\' + $json.audioMimeType + \';base64,\' + $json.audioBase64 } }] }] }) }}',
    options: {
      response: {
        response: {
          neverError: true,
        },
      },
    },
  },
  credentials: {
    httpHeaderAuth: { id: 'H0XlPAbxjEUzplW4', name: 'OpenRouter' },
  },
};

// ── 3. Atualização do Construir Prompt: lê transcrição de $('Transcrever Áudio')
// O código COMPLETO atualizado do Construir Prompt será lido e modificado cirurgicamente
const OLD_CONSTRUIR_AUDIO = `} else if (msg.tipo === 'audio') {
  // Transcrição feita por Prep Transcrição via MCP /util/transcribe
  let transcricao = '';
  let transcricaoDisponivel = false;
  try {
    const prepJson = $('Prep Transcrição').first().json;
    transcricao = (prepJson?.conteudo ?? '').trim();
    transcricaoDisponivel = prepJson?.transcricaoDisponivel ?? false;
  } catch {}
  userContent = (transcricaoDisponivel && transcricao && transcricao !== '[mensagem de voz]')
    ? transcricao
    : '(O usuário enviou um áudio. Responda de forma amigável, diga que recebeu e pergunte em que pode ajudar.)';
}`;

const NEW_CONSTRUIR_AUDIO = `} else if (msg.tipo === 'audio') {
  let transcricao = '';
  let transcricaoDisponivel = false;
  try {
    // audioOk indica se o download foi bem-sucedido em Prep Transcrição
    const audioOk = $('Prep Transcrição').first().json?.audioOk ?? false;
    if (audioOk) {
      // Lê a transcrição do nó HTTP Request Transcrever Áudio
      const tJson = $('Transcrever Áudio').first().json;
      transcricao = (tJson?.choices?.[0]?.message?.content ?? '').trim();
      transcricaoDisponivel = !!transcricao;
    }
  } catch {}
  userContent = (transcricaoDisponivel && transcricao && transcricao !== '[mensagem de voz]')
    ? transcricao
    : '[usuário enviou áudio — conteúdo de voz não disponível]';
}`;

// ──────────────────────────────────────────────────────────────────────────────
async function run() {
  console.log('Buscando workflow [AGENT] Executor...');
  const wf = await fetch(`https://workflows.vendly.chat/api/v1/workflows/${WF_ID}`, { headers: H }).then(r => r.json());
  if (!wf.id) throw new Error('Workflow não encontrado: ' + JSON.stringify(wf).slice(0, 200));

  const nodes = wf.nodes;
  const conns = wf.connections;

  // ── Step 1: Atualizar Prep Transcrição
  const prepNode = nodes.find(n => n.name === 'Prep Transcrição');
  if (!prepNode) throw new Error('Nó "Prep Transcrição" não encontrado');
  prepNode.parameters.jsCode = PREP_CODE;
  // Remover credencial (não precisa mais)
  delete prepNode.credentials;
  console.log('✓ Prep Transcrição atualizado');

  // ── Step 2: Posicionar Transcrever Áudio ao lado de Prep Transcrição
  const prepPos = prepNode.position ?? [0, 0];
  TRANSCREVER_NODE.position = [prepPos[0] + 200, prepPos[1]];

  // Verificar se já existe
  const existingIdx = nodes.findIndex(n => n.id === 'transcrever-audio');
  if (existingIdx >= 0) {
    nodes[existingIdx] = TRANSCREVER_NODE;
    console.log('✓ Transcrever Áudio substituído (já existia)');
  } else {
    nodes.push(TRANSCREVER_NODE);
    console.log('✓ Transcrever Áudio adicionado');
  }

  // ── Step 3: Atualizar conexões
  // 3a. IF Audio Input? → Prep Transcrição (remover Baixar Áudio Chatwoot da cadeia)
  const ifAudioConns = conns['IF Audio Input?'];
  if (ifAudioConns?.main?.[0]) {
    // Branch 0 = audio path
    // Substituir "Baixar Áudio Chatwoot" por "Prep Transcrição" se ainda apontar para o baixar
    ifAudioConns.main[0] = ifAudioConns.main[0].map(t =>
      t.node === 'Baixar Áudio Chatwoot' ? { node: 'Prep Transcrição', type: 'main', index: 0 } : t
    );
    // Garantir que Prep Transcrição está na branch 0
    if (!ifAudioConns.main[0].some(t => t.node === 'Prep Transcrição')) {
      ifAudioConns.main[0].push({ node: 'Prep Transcrição', type: 'main', index: 0 });
    }
  }
  console.log('✓ IF Audio Input? → Prep Transcrição conectado');

  // 3b. Prep Transcrição → Transcrever Áudio
  conns['Prep Transcrição'] = {
    main: [[{ node: 'Transcrever Áudio', type: 'main', index: 0 }]],
  };
  console.log('✓ Prep Transcrição → Transcrever Áudio conectado');

  // 3c. Transcrever Áudio → Construir Prompt (onde Prep Transcrição → Construir Prompt estava)
  // Verificar conexões atuais de Prep Transcrição para achar Construir Prompt
  // Na versão anterior: Prep Transcrição → Construir Prompt
  // Agora: Transcrever Áudio → Construir Prompt
  // A conexão Prep Transcrição → Transcrever Áudio já foi definida acima
  // Precisamos de Transcrever Áudio → Construir Prompt
  conns['Transcrever Áudio'] = {
    main: [[{ node: 'Construir Prompt', type: 'main', index: 0 }]],
  };
  console.log('✓ Transcrever Áudio → Construir Prompt conectado');

  // ── Step 4: Atualizar Construir Prompt
  const cpNode = nodes.find(n => n.name === 'Construir Prompt');
  if (!cpNode) throw new Error('Nó "Construir Prompt" não encontrado');

  const currentCode = cpNode.parameters.jsCode ?? '';
  if (!currentCode.includes("$('Prep Transcrição')")) {
    console.log('⚠️  Construir Prompt não contém referência a Prep Transcrição — pulando atualização');
  } else if (!currentCode.includes(OLD_CONSTRUIR_AUDIO)) {
    console.log('⚠️  Trecho de audio em Construir Prompt não bate — mostrando trecho atual:');
    const audioIdx = currentCode.indexOf("} else if (msg.tipo === 'audio')");
    console.log(currentCode.slice(audioIdx, audioIdx + 400));
    console.log('Tentando substituição parcial...');
    // Tenta encontrar e substituir com regex
    const updated = currentCode.replace(
      /} else if \(msg\.tipo === 'audio'\) \{[\s\S]*?transcricaoDisponivel && transcricao[^}]*\n\s*\}/,
      NEW_CONSTRUIR_AUDIO
    );
    if (updated !== currentCode) {
      cpNode.parameters.jsCode = updated;
      console.log('✓ Construir Prompt atualizado via regex');
    } else {
      console.log('❌ Não foi possível atualizar Construir Prompt automaticamente — atualizar manualmente');
    }
  } else {
    cpNode.parameters.jsCode = currentCode.replace(OLD_CONSTRUIR_AUDIO, NEW_CONSTRUIR_AUDIO);
    console.log('✓ Construir Prompt atualizado');
  }

  // ── Step 5: PUT workflow
  const body = {
    name: wf.name,
    nodes: wf.nodes,
    connections: wf.connections,
    settings: {
      executionOrder: wf.settings?.executionOrder ?? 'v1',
      saveManualExecutions: wf.settings?.saveManualExecutions ?? true,
    },
  };

  console.log('\nAtualizando workflow...');
  const res = await fetch(`https://workflows.vendly.chat/api/v1/workflows/${WF_ID}`, {
    method: 'PUT',
    headers: H,
    body: JSON.stringify(body),
  }).then(r => r.json());

  if (!res.id) {
    console.error('❌ Erro PUT:', JSON.stringify(res).slice(0, 400));
    process.exit(1);
  }

  console.log('✅ Workflow atualizado! updatedAt:', res.updatedAt);

  // ── Step 6: Verificar resultado
  const updPrep = res.nodes.find(n => n.name === 'Prep Transcrição');
  const updTranscrever = res.nodes.find(n => n.name === 'Transcrever Áudio');
  const updConns = res.connections;

  console.log('\n── Verificações ──');
  console.log('Prep Transcrição cred:', JSON.stringify(updPrep?.credentials ?? null));
  console.log('Prep tem httpRequest:', updPrep?.parameters?.jsCode?.includes('httpRequest') ? 'SIM ✅' : 'NÃO ❌');
  console.log('Transcrever Áudio criado:', !!updTranscrever ? 'SIM ✅' : 'NÃO ❌');
  console.log('Transcrever Áudio cred:', JSON.stringify(updTranscrever?.credentials ?? null));
  console.log('IF Audio → Prep Transcrição:', updConns['IF Audio Input?']?.main?.[0]?.some(t => t.node === 'Prep Transcrição') ? 'SIM ✅' : 'NÃO ❌');
  console.log('Prep → Transcrever Áudio:', updConns['Prep Transcrição']?.main?.[0]?.[0]?.node === 'Transcrever Áudio' ? 'SIM ✅' : 'NÃO ❌');
  console.log('Transcrever → Construir Prompt:', updConns['Transcrever Áudio']?.main?.[0]?.[0]?.node === 'Construir Prompt' ? 'SIM ✅' : 'NÃO ❌');
  
  const cpCode = res.nodes.find(n => n.name === 'Construir Prompt')?.parameters?.jsCode ?? '';
  console.log("Construir Prompt lê Transcrever Áudio:", cpCode.includes("$('Transcrever Áudio')") ? 'SIM ✅' : 'NÃO ❌');
  console.log("Construir Prompt fallback atualizado:", cpCode.includes('conteúdo de voz não disponível') ? 'SIM ✅' : 'NÃO ❌');
}

run().catch(e => { console.error(e); process.exit(1); });

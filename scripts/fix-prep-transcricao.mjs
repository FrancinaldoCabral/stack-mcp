/**
 * Refatora "Prep Transcrição" no [AGENT] Executor para usar:
 * 1. Novo nó "Baixar Áudio Chatwoot" (HTTP Request com credencial Chatwoot) — baixa binário
 * 2. "Prep Transcrição" modificado (Code com credencial OpenRouter) — transcribe direto no N8N
 *
 * Elimina a dependência do MCP (/util/transcribe) que falhava por falta de OPENROUTER_API_KEY.
 */

import 'dotenv/config';

const N8N_URL    = process.env.N8N_URL;
const N8N_KEY    = process.env.N8N_API_KEY;
const WF_ID      = 'jleu4RPvSnYDL8Gd';
const HEADERS    = { 'X-N8N-API-KEY': N8N_KEY, 'Accept': 'application/json', 'Content-Type': 'application/json' };

// IDs das credenciais já existentes no N8N
const CRED_OPENROUTER = { id: 'H0XlPAbxjEUzplW4', name: 'OpenRouter' };
const CRED_CHATWOOT   = { id: 'ah2jhDk7ADl68x9G', name: 'Chatwoot Vendly' };

// Novo código do nó "Prep Transcrição" (Code node com cred OpenRouter)
const PREP_CODE = `
const msg = $('Desembalar Payload').first().json;
const audioUrl = msg.metadata?.url ?? '';
if (!audioUrl) return [{ json: { ...msg, conteudo: '', transcricaoDisponivel: false } }];

// Lê o áudio binário baixado pelo nó anterior "Baixar Áudio Chatwoot"
let base64 = null;
let size = 0;
let mimeType = 'audio/ogg';
try {
  const binProp = $input.first().binary?.data;
  if (binProp?.data) {
    base64 = binProp.data;
    size   = binProp.fileSize ?? binProp.data.length ?? 0;
    mimeType = binProp.mimeType ?? 'audio/ogg';
  }
} catch (e) {}

if (!base64) {
  return [{ json: { ...msg, conteudo: '', transcricaoDisponivel: false, base64: null, size: 0 } }];
}

// Transcreve diretamente via OpenRouter Gemini (credencial configurada no nó)
let transcription = '';
try {
  const model = 'google/gemini-2.0-flash-lite-001';
  const result = await this.helpers.httpRequestWithAuthentication(
    'httpHeaderAuth',
    {
      method: 'POST',
      url: 'https://openrouter.ai/api/v1/chat/completions',
      json: true,
      body: {
        model,
        messages: [{
          role: 'user',
          content: [
            {
              type: 'text',
              text: 'Transcreva este áudio para texto em português. Retorne SOMENTE o texto transcrito, sem comentários adicionais.'
            },
            {
              type: 'image_url',
              image_url: { url: \`data:\${mimeType};base64,\${base64}\` }
            },
          ],
        }],
      },
    }
  );
  transcription = result.choices?.[0]?.message?.content?.trim() ?? '';
} catch (e) {
  // falha silenciosa — fallback usado em Construir Prompt via transcricaoDisponivel=false
}

return [{ json: { ...msg, conteudo: transcription || '', transcricaoDisponivel: !!transcription, base64, size } }];
`.trim();

async function run() {
  // 1. Buscar workflow atual
  const r = await fetch(`${N8N_URL}/api/v1/workflows/${WF_ID}`, { headers: HEADERS });
  if (!r.ok) throw new Error(`GET workflow failed: ${r.status}`);
  const wf = await r.json();

  const nodes = wf.nodes;
  const conns = wf.connections;

  // 2. Localizar nó "IF Audio Input?" para obter posição
  const ifAudioNode = nodes.find(n => n.id === 'if-audio-input');
  if (!ifAudioNode) throw new Error('Nó "IF Audio Input?" não encontrado');

  // 3. Localizar nó "Prep Transcrição" para atualizar
  const prepIdx = nodes.findIndex(n => n.id === 'prep-transcricao');
  if (prepIdx === -1) throw new Error('Nó "Prep Transcrição" não encontrado');

  // 4. Verificar se "Baixar Áudio Chatwoot" já existe (idempotência)
  const alreadyExists = nodes.find(n => n.id === 'baixar-audio-cw');
  if (alreadyExists) {
    console.log('Nó "Baixar Áudio Chatwoot" já existe — atualizando apenas Prep Transcrição');
  }

  // 5. Definir posições
  // IF Audio Input? está em [432, 656]; Prep Transcrição estava em [784, 480]
  // Novo layout: Baixar em [608, 480], Prep em [944, 480]
  const baixarPos  = [608, 480];
  const prepNewPos = [944, 480];

  // 6. Novo nó "Baixar Áudio Chatwoot"
  const baixarNode = {
    id: 'baixar-audio-cw',
    name: 'Baixar Áudio Chatwoot',
    type: 'n8n-nodes-base.httpRequest',
    typeVersion: 4.2,
    position: baixarPos,
    parameters: {
      method: 'GET',
      url: "={{ $('Desembalar Payload').first().json.metadata?.url }}",
      authentication: 'genericCredentialType',
      genericAuthType: 'httpHeaderAuth',
      options: {
        response: {
          response: {
            neverError: true,
            responseFormat: 'file',
          },
        },
      },
    },
    credentials: {
      httpHeaderAuth: CRED_CHATWOOT,
    },
  };

  // 7. Atualizar nó "Prep Transcrição"
  nodes[prepIdx] = {
    ...nodes[prepIdx],
    position: prepNewPos,
    parameters: {
      ...nodes[prepIdx].parameters,
      jsCode: PREP_CODE,
    },
    credentials: {
      httpHeaderAuth: CRED_OPENROUTER,
    },
  };

  // 8. Adicionar "Baixar Áudio Chatwoot" (ou substituir se já existe)
  const existingIdx = nodes.findIndex(n => n.id === 'baixar-audio-cw');
  if (existingIdx === -1) {
    nodes.push(baixarNode);
  } else {
    nodes[existingIdx] = baixarNode;
  }

  // 9. Atualizar conexões
  // Remover: IF Audio Input? → Prep Transcrição (main[0])
  // Adicionar: IF Audio Input? → Baixar Áudio Chatwoot (main[0])
  // Adicionar: Baixar Áudio Chatwoot → Prep Transcrição (main[0])

  const ifAudioConns = conns['IF Audio Input?'];
  if (ifAudioConns?.main?.[0]) {
    // Substitui "Prep Transcrição" por "Baixar Áudio Chatwoot" na saída 0 do IF
    ifAudioConns.main[0] = ifAudioConns.main[0].map(t =>
      t.node === 'Prep Transcrição' ? { node: 'Baixar Áudio Chatwoot', type: 'main', index: 0 } : t
    );
    // Se não tinha, adiciona
    if (!ifAudioConns.main[0].some(t => t.node === 'Baixar Áudio Chatwoot')) {
      ifAudioConns.main[0].push({ node: 'Baixar Áudio Chatwoot', type: 'main', index: 0 });
    }
  }

  // Conectar Baixar Áudio Chatwoot → Prep Transcrição
  conns['Baixar Áudio Chatwoot'] = {
    main: [[{ node: 'Prep Transcrição', type: 'main', index: 0 }]],
  };

  // 10. Salvar workflow via PUT
  const body = {
    name: wf.name,
    nodes: wf.nodes,
    connections: wf.connections,
    settings: { executionOrder: 'v1', saveManualExecutions: true },
  };

  const rPut = await fetch(`${N8N_URL}/api/v1/workflows/${WF_ID}`, {
    method: 'PUT',
    headers: HEADERS,
    body: JSON.stringify(body),
  });

  const result = await rPut.json();

  if (!rPut.ok) {
    console.error('PUT falhou:', rPut.status, JSON.stringify(result).slice(0, 300));
    process.exit(1);
  }

  console.log('✅ Workflow atualizado com sucesso!');

  // 11. Verificar conexões resultantes
  const updConns = result.connections;
  console.log('\nConexões do IF Audio Input?:', JSON.stringify(updConns['IF Audio Input?']?.main));
  console.log('Conexões do Baixar Áudio Chatwoot:', JSON.stringify(updConns['Baixar Áudio Chatwoot']?.main));

  // 12. Verificar credencial do Prep Transcrição
  const updPrep = result.nodes.find(n => n.id === 'prep-transcricao');
  console.log('Credenciais Prep Transcrição:', JSON.stringify(updPrep?.credentials));
}

run().catch(e => { console.error(e); process.exit(1); });

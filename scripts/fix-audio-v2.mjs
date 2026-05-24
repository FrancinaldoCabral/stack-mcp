import 'dotenv/config';

/**
 * Nova abordagem para transcrição:
 * 1. Baixar Áudio: HTTP Request nativo, GET URL → $binary.data (N8N armazena como base64 internamente)
 * 2. Transcrever Áudio: HTTP Request, POST OpenRouter usando $('Baixar Áudio').item.binary.data.data
 * 3. Sem Code node no caminho de download
 */

const H = { 'X-N8N-API-KEY': process.env.N8N_API_KEY, 'Accept': 'application/json', 'Content-Type': 'application/json' };
const WF_ID = 'jleu4RPvSnYDL8Gd';

console.log('Buscando workflow...');
const wf = await fetch(`https://workflows.vendly.chat/api/v1/workflows/${WF_ID}`, { headers: H }).then(r => r.json());
if (!wf.id) throw new Error('Workflow não encontrado: ' + JSON.stringify(wf).slice(0, 100));

const nodes = wf.nodes;
const conns = wf.connections;

// ── 1. Prep Transcrição: APENAS passa msg + audioUrl (não baixa mais)
const PREP_CODE = `const msg = $('Desembalar Payload').first().json;
const audioUrl = msg.metadata?.url ?? '';
return [{ json: { ...msg, audioUrl, audioOk: !!audioUrl } }];`;

const prepNode = nodes.find(n => n.name === 'Prep Transcrição');
if (!prepNode) throw new Error('Prep Transcrição não encontrado');
prepNode.parameters.jsCode = PREP_CODE;
delete prepNode.credentials;
console.log('✓ Prep Transcrição simplificado (só passa audioUrl)');

// ── 2. Nó Baixar Áudio: HTTP Request nativo que baixa como binário
const BAIXAR_NODE = {
  id: 'baixar-audio-bin',
  name: 'Baixar Áudio',
  type: 'n8n-nodes-base.httpRequest',
  typeVersion: 4.2,
  position: [prepNode.position[0] + 200, prepNode.position[1]],
  parameters: {
    method: 'GET',
    url: '={{ $json.audioUrl }}',
    responseFormat: 'file',
    dataPropertyName: 'data',
    options: {
      response: {
        response: {
          neverError: true,
        },
      },
    },
  },
};

const existingBaixar = nodes.findIndex(n => n.id === 'baixar-audio-bin');
if (existingBaixar >= 0) {
  nodes[existingBaixar] = BAIXAR_NODE;
} else {
  nodes.push(BAIXAR_NODE);
}
console.log('✓ Baixar Áudio nó criado');

// ── 3. Atualizar Transcrever Áudio para usar $binary do Baixar Áudio
const transcNode = nodes.find(n => n.name === 'Transcrever Áudio');
if (!transcNode) throw new Error('Transcrever Áudio não encontrado');

// Usar $binary.data.data (já é base64!) e $binary.data.mimeType
transcNode.parameters.jsonBody = `={{ JSON.stringify({
  model: 'google/gemini-2.0-flash-lite-001',
  messages: [{
    role: 'user',
    content: [
      { type: 'text', text: 'Transcreva este áudio para texto em português. Retorne SOMENTE o texto transcrito, sem comentários adicionais.' },
      { type: 'image_url', image_url: { url: 'data:' + ($binary?.data?.mimeType ?? 'audio/ogg') + ';base64,' + $binary.data.data } }
    ]
  }]
}) }}`;
console.log('✓ Transcrever Áudio atualizado para usar $binary');

// ── 4. Conexões
// Prep Transcrição → Baixar Áudio
conns['Prep Transcrição'] = {
  main: [[{ node: 'Baixar Áudio', type: 'main', index: 0 }]],
};
// Baixar Áudio → Transcrever Áudio
conns['Baixar Áudio'] = {
  main: [[{ node: 'Transcrever Áudio', type: 'main', index: 0 }]],
};
// Transcrever Áudio → Construir Prompt já existe
console.log('✓ Conexões atualizadas');

// ── 5. Construir Prompt: atualizar para ler de Transcrever Áudio
const cpNode = nodes.find(n => n.name === 'Construir Prompt');
if (!cpNode) throw new Error('Construir Prompt não encontrado');

const OLD_AUDIO = `} else if (msg.tipo === 'audio') {
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

const NEW_AUDIO = `} else if (msg.tipo === 'audio') {
  let transcricao = '';
  let transcricaoDisponivel = false;
  try {
    const audioOk = $('Prep Transcrição').first().json?.audioOk ?? false;
    if (audioOk) {
      const tJson = $('Transcrever Áudio').first().json;
      transcricao = (tJson?.choices?.[0]?.message?.content ?? '').trim();
      transcricaoDisponivel = !!transcricao;
    }
  } catch {}
  userContent = (transcricaoDisponivel && transcricao && transcricao !== '[mensagem de voz]')
    ? transcricao
    : '[usuário enviou áudio — conteúdo de voz não disponível]';
}`;

if (!cpNode.parameters.jsCode.includes(OLD_AUDIO.trim().slice(20, 60))) {
  console.log('⚠️  Construir Prompt audio block já está no formato novo (ou diferente). Não modificando.');
} else {
  cpNode.parameters.jsCode = cpNode.parameters.jsCode.replace(OLD_AUDIO, NEW_AUDIO);
}

// ── 6. Salvar
console.log('\nAtualizando workflow...');
const payload = {
  name: wf.name,
  nodes: wf.nodes,
  connections: conns,
  settings: { executionOrder: 'v1', saveManualExecutions: true },
};
const result = await fetch(`https://workflows.vendly.chat/api/v1/workflows/${WF_ID}`, {
  method: 'PUT',
  headers: H,
  body: JSON.stringify(payload),
}).then(r => r.json());

if (!result.updatedAt) {
  console.error('❌ Erro ao atualizar:', JSON.stringify(result).slice(0, 200));
  process.exit(1);
}
console.log('✅ Workflow atualizado! updatedAt:', result.updatedAt);

// ── Verificações
const wf2 = await fetch(`https://workflows.vendly.chat/api/v1/workflows/${WF_ID}`, { headers: H }).then(r => r.json());
const n2 = wf2.nodes;
const c2 = wf2.connections;

const baixarExists = n2.some(n => n.name === 'Baixar Áudio' && n.id === 'baixar-audio-bin');
const transcExists = n2.some(n => n.name === 'Transcrever Áudio');
const prepToBaixar = c2['Prep Transcrição']?.main?.[0]?.some(t => t.node === 'Baixar Áudio');
const baixarToTransc = c2['Baixar Áudio']?.main?.[0]?.some(t => t.node === 'Transcrever Áudio');
const transcToCp = c2['Transcrever Áudio']?.main?.[0]?.some(t => t.node === 'Construir Prompt');
const transcUsesBinary = n2.find(n => n.name === 'Transcrever Áudio')?.parameters?.jsonBody?.includes('$binary');

console.log('\n── Verificações ──');
console.log('Baixar Áudio criado:', baixarExists ? 'SIM ✅' : 'NÃO ❌');
console.log('Transcrever Áudio existe:', transcExists ? 'SIM ✅' : 'NÃO ❌');
console.log('Prep → Baixar Áudio:', prepToBaixar ? 'SIM ✅' : 'NÃO ❌');
console.log('Baixar → Transcrever:', baixarToTransc ? 'SIM ✅' : 'NÃO ❌');
console.log('Transcrever → Construir Prompt:', transcToCp ? 'SIM ✅' : 'NÃO ❌');
console.log('Transcrever usa $binary:', transcUsesBinary ? 'SIM ✅' : 'NÃO ❌');

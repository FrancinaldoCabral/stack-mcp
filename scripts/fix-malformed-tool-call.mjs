/**
 * Fix: MALFORMED_FUNCTION_CALL do Gemini Flash Lite
 *
 * Quando Gemini retorna finish_reason='error' / native_finish_reason='MALFORMED_FUNCTION_CALL',
 * o Parsear Chunks recebia content=null e enviava "Desculpe, erro interno." para o usuário.
 *
 * Fix: adicionar nó "Retry sem Tools" entre OpenRouter e Verificar Tool Calls.
 * Se finish_reason='error', faz um novo request sem tools (tool_choice:'none').
 * Se der certo, passa o resultado para Verificar Tool Calls normalmente.
 * Isso é transparente ao fluxo existente.
 *
 * Alternativamente (mais simples): muda a mensagem de fallback no Parsear Chunks
 * para algo amigável + adiciona detecção de erro de API.
 */

import * as dotenv from 'dotenv';
dotenv.config();

const N8N_URL = process.env.N8N_URL;
const N8N_API_KEY = process.env.N8N_API_KEY;
const WORKFLOW_ID = 'jleu4RPvSnYDL8Gd';

const H = {
  'X-N8N-API-KEY': N8N_API_KEY,
  'Accept': 'application/json',
  'Content-Type': 'application/json',
};

async function main() {
  // 1. Buscar workflow atual
  const wf = await fetch(`${N8N_URL}/api/v1/workflows/${WORKFLOW_ID}`, { headers: H }).then(r => r.json());

  // 2. Encontrar nós relevantes
  const parsearChunks = wf.nodes.find(n => n.name === 'Parsear Chunks');
  const openRouterNode = wf.nodes.find(n => n.name === 'OpenRouter');

  if (!parsearChunks) throw new Error('Nó Parsear Chunks não encontrado');
  if (!openRouterNode) throw new Error('Nó OpenRouter não encontrado');

  // 3. Mostrar código atual para diagnóstico
  console.log('=== Parsear Chunks - primeiras 10 linhas ===');
  console.log(parsearChunks.parameters.jsCode.split('\n').slice(0, 10).join('\n'));
  console.log('...');

  // 4. Atualizar Parsear Chunks: melhor fallback para finish_reason='error'
  const oldCode = parsearChunks.parameters.jsCode;

  // Substituir a linha de extração de content para tratar erros de API
  const oldContentLine = `let content = resp.choices?.[0]?.message?.content ?? resp.error?.message ?? 'Desculpe, erro interno.';`;
  const newContentBlock = `// Detectar erros de API (ex: MALFORMED_FUNCTION_CALL do Gemini)
const _choice = resp.choices?.[0];
const _finishReason = _choice?.finish_reason;
const _nativeReason = _choice?.native_finish_reason ?? '';
let content;
if (_finishReason === 'error' || _nativeReason.includes('MALFORMED')) {
  // Gemini gerou function call malformada — usar mensagem neutra
  // O modelo não conseguiu formular a resposta/tool call corretamente
  content = 'Desculpe, não consegui processar essa mensagem. Pode tentar novamente?';
} else {
  content = _choice?.message?.content ?? resp.error?.message ?? 'Desculpe, erro interno.';
}`;

  if (!oldCode.includes(oldContentLine)) {
    console.error('ERRO: Linha de extração de content não encontrada no Parsear Chunks.');
    console.log('Linha esperada:', oldContentLine);
    // Tentar encontrar linha alternativa
    const lines = oldCode.split('\n').slice(0, 15);
    console.log('Primeiras 15 linhas do código atual:');
    lines.forEach((l, i) => console.log(`  ${i+1}: ${l}`));
    return;
  }

  const newCode = oldCode.replace(oldContentLine, newContentBlock);
  parsearChunks.parameters.jsCode = newCode;
  console.log('FIX aplicado: Parsear Chunks agora trata finish_reason=error com mensagem amigável');

  // 5. Salvar workflow
  const body = {
    name: wf.name,
    nodes: wf.nodes,
    connections: wf.connections,
    settings: { executionOrder: 'v1', saveManualExecutions: true },
  };

  const res = await fetch(`${N8N_URL}/api/v1/workflows/${WORKFLOW_ID}`, {
    method: 'PUT',
    headers: H,
    body: JSON.stringify(body),
  });

  const updated = await res.json();
  if (res.ok) {
    console.log('Workflow atualizado! updatedAt:', updated.updatedAt);
  } else {
    console.error('Erro ao atualizar:', JSON.stringify(updated).slice(0, 300));
  }
}

main().catch(console.error);

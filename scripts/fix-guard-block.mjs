/**
 * fix-guard-block.mjs
 * Remove o bloco __leftoverRe do Parsear Chunks que substituía respostas legítimas
 * do LLM por "Falta um detalhe" quando a resposta continha [Endereço...] no texto.
 * Mantém o guard do LT-XXXX e a substituição de endereço do restaurante.
 */
import 'dotenv/config';

const N8N_URL = process.env.N8N_URL || 'https://workflows.vendly.chat';
const N8N_API_KEY = process.env.N8N_API_KEY;
const WF_ID = 'jleu4RPvSnYDL8Gd';

if (!N8N_API_KEY) { console.error('N8N_API_KEY not set'); process.exit(1); }

const headers = {
  'X-N8N-API-KEY': N8N_API_KEY,
  'Content-Type': 'application/json',
  'Accept': 'application/json, text/event-stream',
};

async function main() {
  const r = await fetch(`${N8N_URL}/api/v1/workflows/${WF_ID}`, { headers });
  if (!r.ok) throw new Error(`GET failed: ${r.status} ${await r.text()}`);
  const wf = await r.json();

  const pc = wf.nodes.find(n => n.name === 'Parsear Chunks');
  if (!pc) throw new Error('Parsear Chunks não encontrado');

  let code = pc.parameters.jsCode;

  // Verificar que o bloco destrutivo está presente
  if (!code.includes('__leftoverRe')) {
    console.log('⚠️  __leftoverRe não encontrado - talvez já removido?');
  }

  // Remover o bloco __leftoverRe inteiro (o que substitui conteúdo por "Falta um detalhe")
  // Bloco vai de "// Demais placeholders sobrando" até o fechamento do if
  code = code.replace(
    /\s*\/\/ Demais placeholders sobrando[\s\S]*?if\s*\(__leftoverRe\.test\(content\)\)\s*\{[\s\S]*?\}\n?/,
    '\n'
  );

  // Verificar remoção
  if (code.includes('__leftoverRe')) {
    throw new Error('Falha ao remover __leftoverRe - regex não bateu');
  }
  console.log('✅ Bloco __leftoverRe removido');
  console.log('Guard LT-XXXX ainda presente:', code.includes('LT-[A-Z0-9]'));
  console.log('Guard endereço restaurante ainda presente:', code.includes('__restAddr'));

  pc.parameters.jsCode = code;

  const payload = {
    name: wf.name,
    nodes: wf.nodes,
    connections: wf.connections,
    settings: { executionOrder: 'v1', saveManualExecutions: true },
  };

  const upd = await fetch(`${N8N_URL}/api/v1/workflows/${WF_ID}`, {
    method: 'PUT',
    headers,
    body: JSON.stringify(payload),
  });

  if (!upd.ok) throw new Error(`PUT failed: ${upd.status} ${await upd.text()}`);
  const result = await upd.json();
  console.log(`\n✅ Workflow ${result.id} atualizado — guard destrutivo removido de Parsear Chunks`);
}

main().catch(e => { console.error('ERRO:', e.message); process.exit(1); });

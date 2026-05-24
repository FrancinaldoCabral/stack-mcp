// fix-parsear-chunks.mjs
// Corrige Parsear Chunks:
// 1. Remove timestamp do historico salvo (era o que ensinava o modelo a gerar timestamps)
// 2. Remove filtro frágil de "frases de recusa" (já corrigido no prompt)
// 3. Strip timestamps de chunks de texto antes de enviar
import 'dotenv/config';

const H = { 'X-N8N-API-KEY': process.env.N8N_API_KEY, 'Accept': 'application/json', 'Content-Type': 'application/json' };
const WF_ID = 'jleu4RPvSnYDL8Gd';

const wf = await fetch(`https://workflows.vendly.chat/api/v1/workflows/${WF_ID}`, { headers: H }).then(r => r.json());
const node = wf.nodes.find(x => x.name === 'Parsear Chunks');
if (!node) { console.error('Nó não encontrado'); process.exit(1); }

// Lê código atual
const oldCode = node.parameters.jsCode;

// --- FIX 1: remover timestamp do conteúdo salvo no histórico ---
// Troca: { role: 'assistant', content: `[${tsAgora}] ${content.replace(...).trim()}` }
// Por:   { role: 'assistant', content: content.replace(...).trim() }
const OLD1 = "  { role: 'assistant', content: `[${tsAgora}] ${content.replace(/^\\s*\\[\\d{2}\\/\\d{2}\\/\\d{4},?\\s*\\d{2}:\\d{2}\\]\\s*/g, '').trim()}` },";
const NEW1 = "  { role: 'assistant', content: content.replace(/^\\s*\\[\\d{2}\\/\\d{2}\\/\\d{4},?\\s*\\d{2}:\\d{2}\\]\\s*/g, '').trim() },";

// --- FIX 2: simplificar modo audio - remover filtro de frases ---
// Troca o bloco de cleanContent (filter de frases) por apenas contentNoTimestamp
const OLD2 = `  // Remover frases de recusa do LLM sobre não poder enviar áudio
  const cleanContent = contentNoTimestamp
    .split(/(?<=[.!?!])\\s+/)
    .filter(s => !/(?:não\\s+(?:consigo|posso|é\\s+possível)\\s+(?:enviar|mandar|gravar|criar|gerar|processar|reproduzir)\\s+[aá]udio|não\\s+process[ao]\\s+[aá]udio|sou\\s+(?:um[a]?\\s+)?(?:assistente|ia|inteligência)\\s+(?:de\\s+)?texto|como\\s+(?:um[a]?\\s+)?(?:assistente|ia).*?texto|não\\s+tenho\\s+(?:capacidade|habilidade|como).*?[aá]udio)/i.test(s))
    .join(' ')
    .trim();
  const audioContent = cleanContent || contentNoTimestamp || content;`;
const NEW2 = `  const audioContent = contentNoTimestamp || content;`;

// --- FIX 3: strip timestamp de chunks de texto ---
// Adiciona .map(strip) após o split em modo texto
const OLD3 = `const chunks = content
  .split(/\\n+/)
  .map(s => s.trim())
  .filter(s => s.length > 0)`;
const NEW3 = `const chunks = content
  .replace(/^\\s*\\[\\d{2}\\/\\d{2}\\/\\d{4},?\\s*\\d{2}:\\d{2}\\]\\s*/, '')
  .split(/\\n+/)
  .map(s => s.trim())
  .filter(s => s.length > 0)`;

let code = oldCode;

// Aplicar fix 1 (usando indexOf pois os escapes são complexos)
const histLine = "  { role: 'assistant', content: `[${tsAgora}] ${content.replace";
const histLineIdx = code.indexOf(histLine);
if (histLineIdx === -1) { console.error('FIX1: linha não encontrada'); process.exit(1); }
const histLineEnd = code.indexOf('` },', histLineIdx) + 4;
const oldHistLine = code.slice(histLineIdx, histLineEnd);
const newHistLine = "  { role: 'assistant', content: content.replace(/^\\s*\\[\\d{2}\\/\\d{2}\\/\\d{4},?\\s*\\d{2}:\\d{2}\\]\\s*/g, '').trim() },";
code = code.slice(0, histLineIdx) + newHistLine + code.slice(histLineEnd);
console.log('FIX1 aplicado: timestamp removido do historico');

// Aplicar fix 2 (remover bloco do filtro)
const filterStart = code.indexOf('  // Remover frases de recusa');
const filterEnd = code.indexOf('\n  const audioContent =', filterStart) + 1;
if (filterStart === -1 || filterEnd === 0) { console.error('FIX2: bloco não encontrado'); }
else {
  const endOfLine = code.indexOf('\n', filterEnd + code.slice(filterEnd).indexOf(';'));
  code = code.slice(0, filterStart) + '  const audioContent = contentNoTimestamp || content;' + code.slice(endOfLine + 1);
  console.log('FIX2 aplicado: filtro frágil de frases removido');
}

// Aplicar fix 3 (strip timestamp em modo texto)
const chunksIdx = code.indexOf("const chunks = content\n  .split(/\\n+/)");
if (chunksIdx === -1) { console.error('FIX3: const chunks não encontrado'); }
else {
  code = code.slice(0, chunksIdx) +
    "const chunks = content\n  .replace(/^\\s*\\[\\d{2}\\/\\d{2}\\/\\d{4},?\\s*\\d{2}:\\d{2}\\]\\s*/, '')\n  .split(/\\n+/)" +
    code.slice(chunksIdx + "const chunks = content\n  .split(/\\n+/)".length);
  console.log('FIX3 aplicado: strip timestamp em chunks de texto');
}

// Verificar mudança
if (code === oldCode) { console.error('NENHUMA mudança aplicada'); process.exit(1); }

node.parameters.jsCode = code;
const body = { name: wf.name, nodes: wf.nodes, connections: wf.connections, settings: { executionOrder: 'v1', saveManualExecutions: true } };
const res = await fetch(`https://workflows.vendly.chat/api/v1/workflows/${WF_ID}`, { method: 'PUT', headers: H, body: JSON.stringify(body) }).then(r => r.json());

if (res.updatedAt) {
  console.log('\nWorkflow atualizado! updatedAt:', res.updatedAt);
} else {
  console.error('Erro:', JSON.stringify(res).slice(0, 200));
}

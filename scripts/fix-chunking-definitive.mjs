/**
 * fix-chunking-definitive.mjs
 *
 * Substitui a lógica de chunking em "Parsear Chunks" por uma versão definitiva:
 *
 * ANTES (problemático):
 *   - Split em \n\n+
 *   - Para chunks > 180 chars: regex [^.!?]+[.!?]+ que corta em "etc." e deixa ")" solto
 *
 * DEPOIS (definitivo):
 *   - Split APENAS em \n\n+ (parágrafos explícitos)
 *   - SEM corte por tamanho — WhatsApp suporta mensagens longas normalmente
 *   - Chunks órfãos (< 6 chars ou só pontuação) fundidos ao chunk anterior
 */
import 'dotenv/config';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
const __dir = dirname(fileURLToPath(import.meta.url));

const N8N = process.env.N8N_URL || 'https://workflows.vendly.chat';
const KEY = process.env.N8N_API_KEY;
const WF_ID = 'jleu4RPvSnYDL8Gd';
if (!KEY) { console.error('N8N_API_KEY ausente'); process.exit(1); }
const h = { 'X-N8N-API-KEY': KEY, 'Accept': 'application/json', 'Content-Type': 'application/json' };

const wf = await (await fetch(`${N8N}/api/v1/workflows/${WF_ID}`, { headers: h })).json();
const pcNode = wf.nodes.find(n => n.name === 'Parsear Chunks');
if (!pcNode) throw new Error('"Parsear Chunks" não encontrado');

let code = pcNode.parameters.jsCode;

// ── Encontrar o bloco de chunking usando âncoras robustas ─────────────────────
// O bloco pode começar com 'const chunks = content' (original) OU com o comentário
// 'Chunking definitivo' (versão anterior parcialmente aplicada)
const START_OPTS = ['const chunks = content', '// Chunking definitivo', 'const _rawContent = content'];
let si = -1;
for (const opt of START_OPTS) { si = code.indexOf(opt); if (si !== -1) break; }
const END_ANCHOR = '\n\nreturn chunks.map';
const ei = code.indexOf(END_ANCHOR, si > 0 ? si : 0);
if (si === -1 || ei === -1) throw new Error(`Âncoras não encontradas. si=${si} ei=${ei}`);

console.log(`Substituindo bloco [${si}..${ei}] (${ei - si} chars)`);

// Lê o código correto de um arquivo separado (evita problemas de escaping)
const NEW_CHUNK_CODE = readFileSync(join(__dir, '_chunk_code.js'), 'utf8').trim();

code = code.slice(0, si) + NEW_CHUNK_CODE + code.slice(ei + 1);

// Verifica que o bloco de chunking foi inserido corretamente
const verifyIdx = code.indexOf('_isOrphan');
if (verifyIdx === -1) { console.error('✗ Bloco novo não encontrado no código'); process.exit(1); }
console.log('✓ Bloco de chunking atualizado');

// ── Teste local da lógica de chunking ────────────────────────────────────────
console.log('\n=== Teste local ===');
const testCases = [
  {
    label: 'Caso problemático original',
    input: 'Anotado, já organizo aqui 👀\n\nSó me confirma uma coisa: você tem o código dessa comanda ou o número do pedido da plataforma (iFood, etc.)? E sobre o endereço, o sistema não localizou exatamente o número 615 na Estrada de Paciência, você consegue conferir se está certinho ou se tem algum ponto de referência?',
    expected: 2,
  },
  {
    label: 'Pedido longo (não deve fragmentar)',
    input: 'Confere antes de eu mandar pros entregadores?\n🙋 Cliente: João Silva\n☎️ 21-99999-9999\n🏠 Rua X, 123\n💰 €15,00\n🛵 Taxa: €3,50\nMando?',
    expected: 1,
  },
  {
    label: 'Parêntese orphan',
    input: 'Pergunta importante\n\n)?',
    expected: 1, // deve fundir
  },
];

for (const tc of testCases) {
  const rawContent = tc.input.replace(/^\s*\[\d{2}\/\d{2}\/\d{4},?\s*\d{2}:\d{2}\]\s*/, '');
  const paragraphs = rawContent.split(/\n{2,}/).map(s => s.trim()).filter(s => s.length > 0);
  const chunks = [];
  for (const p of paragraphs) {
    const isOrphan = p.length < 6 || /^[\)\]?.!,;:\s]+$/.test(p);
    if (isOrphan && chunks.length > 0) {
      const startsWithPunct = /^[\)\]?.!,;:]/.test(p);
      chunks[chunks.length - 1] += (startsWithPunct ? '' : ' ') + p;
    } else {
      chunks.push(p);
    }
  }
  const ok = chunks.length === tc.expected;
  console.log(`${ok ? '✓' : '✗'} ${tc.label}: ${chunks.length} chunk(s) (esperado ${tc.expected})`);
  if (!ok || chunks.length <= 3) {
    chunks.forEach((c, i) => console.log(`    [${i + 1}] "${c.slice(0, 80)}${c.length > 80 ? '...' : ''}"`));
  }
}

// ── Salvar ────────────────────────────────────────────────────────────────────
pcNode.parameters.jsCode = code;

const allowed = ['saveExecutionProgress', 'saveManualExecutions', 'saveDataErrorExecution', 'saveDataSuccessExecution', 'executionTimeout', 'errorWorkflow', 'timezone', 'executionOrder'];
const settings = {};
for (const k of allowed) if (wf.settings?.[k] !== undefined) settings[k] = wf.settings[k];
if (!settings.executionOrder) settings.executionOrder = 'v1';

const put = await fetch(`${N8N}/api/v1/workflows/${WF_ID}`, {
  method: 'PUT', headers: h,
  body: JSON.stringify({ name: wf.name, nodes: wf.nodes, connections: wf.connections, settings }),
});
const pj = await put.json();
if (!put.ok) { console.error('PUT falhou:', JSON.stringify(pj).slice(0, 300)); process.exit(1); }
console.log('\n✅ Workflow salvo id=' + pj.id);
console.log('   Chunking definitivo aplicado — sem corte por tamanho, sem regex de sentença');

/**
 * fix-persona-via-mcp.mjs
 *
 * Corrige personas.restaurant.systemPrompt via MCP em produção
 * (MongoDB não acessível diretamente — host interno Coolify)
 *
 * Mudanças:
 *  A) Remove linha "🏠 Retirada: [endereço do restaurante...]"
 *  B) Adiciona regra anti-placeholder
 */

import 'dotenv/config';
import axios from 'axios';

const MCP_URL = 'https://app.vendly.chat/mcp';
const DB = 'vendly';
const COL = 'businesses';

const headers = {
  'Content-Type': 'application/json',
  'Accept': 'application/json, text/event-stream',
};

let _msgId = 1;

async function mcpCall(method, params) {
  const body = {
    jsonrpc: '2.0',
    id: _msgId++,
    method,
    params,
  };
  const { data } = await axios.post(MCP_URL, body, { headers });
  // MCP responde em SSE: "event: message\ndata: {...}\n\n"
  // ou plain JSON dependendo do cliente
  let parsed;
  if (typeof data === 'string') {
    const match = data.match(/^data:\s*(\{.*\})/m);
    if (!match) throw new Error('Resposta SSE inválida: ' + data.slice(0, 200));
    parsed = JSON.parse(match[1]);
  } else {
    parsed = data;
  }
  if (parsed.error) throw new Error(JSON.stringify(parsed.error));
  return parsed.result;
}

async function mcpInit() {
  await mcpCall('initialize', {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'fix-persona-script', version: '1.0' },
  });
}

async function mongoFind(filter, projection) {
  const result = await mcpCall('tools/call', {
    name: 'mongo_find',
    arguments: { database: DB, collection: COL, filter, projection, limit: 1 },
  });
  const text = result?.content?.[0]?.text ?? '[]';
  return JSON.parse(text);
}

async function mongoUpdate(filter, update) {
  const result = await mcpCall('tools/call', {
    name: 'mongo_update',
    arguments: { database: DB, collection: COL, filter, update, many: false },
  });
  return result?.content?.[0]?.text ?? '';
}

(async () => {
  console.log('[1] Inicializando MCP...');
  await mcpInit();

  console.log('[2] Buscando documento com personas.restaurant...');
  // personas é um array; buscar docs que têm pelo menos um elemento com key='restaurant'
  const docs = await mongoFind({ 'personas.key': 'restaurant' }, { '_id': 1, 'name': 1, 'personas': 1 });

  if (!docs.length) {
    console.error('❌ Nenhum documento encontrado com personas.restaurant');
    process.exit(1);
  }

  const doc = docs[0];
  console.log(`   Encontrado: ${doc._id} (${doc.name ?? doc._id})`);

  // personas é array — achar elemento com key='restaurant'
  const personasArr = Array.isArray(doc.personas) ? doc.personas : Object.values(doc.personas);
  const restaurantIdx = personasArr.findIndex(p => p.key === 'restaurant');
  if (restaurantIdx === -1) {
    console.error('❌ Persona restaurant não encontrada no array');
    process.exit(1);
  }
  const currentPrompt = personasArr[restaurantIdx].systemPrompt;
  if (!currentPrompt) {
    console.error('❌ personas.restaurant.systemPrompt está vazio');
    process.exit(1);
  }

  console.log(`   Tamanho atual: ${currentPrompt.length} chars`);

  // ── Mudança A: remover linha de Retirada com placeholder ──
  let newPrompt = currentPrompt;

  // Tenta regex precisa primeiro
  const retiradadaRe = /\n?[ \t]*🏠\s*Retirada:\s*\[endereço do restaurante[^\n]*\]\n?/g;
  if (retiradadaRe.test(newPrompt)) {
    newPrompt = newPrompt.replace(retiradadaRe, '\n');
    console.log('   ✓  Linha "🏠 Retirada: [endereço do restaurante...]" removida');
  } else {
    // Tenta regex mais ampla
    const altRe = /\n?[ \t]*🏠\s*Retirada:[^\n]*\n?/g;
    const altMatch = newPrompt.match(altRe);
    if (altMatch) {
      console.log(`   Linha encontrada: ${altMatch[0].trim()}`);
      newPrompt = newPrompt.replace(altRe, '\n');
      console.log('   ✓  Linha removida');
    } else {
      console.log('   ⚠️  Linha "🏠 Retirada:" não encontrada — pode já ter sido removida');
    }
  }

  // ── Mudança B: adicionar regra anti-placeholder ──
  const antiPlaceholder = `\n\n⚠️ REGRA OBRIGATÓRIA: NUNCA escreva texto entre colchetes \`[...]\` como placeholder nas mensagens ao restaurante ou ao cliente. Se um dado estiver faltando, PERGUNTE ao usuário ou OMITA a linha. Placeholders visíveis são proibidos.`;

  if (!newPrompt.includes('NUNCA escreva texto entre colchetes')) {
    newPrompt = newPrompt.trimEnd() + antiPlaceholder;
    console.log('   ✓  Regra anti-placeholder adicionada');
  } else {
    console.log('   ℹ️  Regra anti-placeholder já existe');
  }

  if (newPrompt === currentPrompt) {
    console.log('\nℹ️  Nenhuma mudança necessária — persona já está correta');
    process.exit(0);
  }

  console.log('\n[3] Atualizando MongoDB...');
  const fieldPath = `personas.${restaurantIdx}.systemPrompt`;
  console.log(`   Campo: ${fieldPath}`);
  const updateResult = await mongoUpdate(
    { name: doc.name },
    { $set: { [fieldPath]: newPrompt } }
  );
  console.log('   Resultado:', updateResult);
  console.log(`   ✅ personas.restaurant.systemPrompt atualizado (${newPrompt.length} chars)`);

  console.log('\n─────────────────────────────────');
  console.log('✅ Concluído:');
  console.log('   • Linha "🏠 Retirada: [endereço...]" removida do template');
  console.log('   • Regra anti-placeholder adicionada à persona restaurant');
})().catch(err => {
  console.error('❌ Erro:', err.response?.data ?? err.message);
  process.exit(1);
});

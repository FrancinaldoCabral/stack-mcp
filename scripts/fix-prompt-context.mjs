/**
 * fix-prompt-context.mjs
 *
 * 1. Aumenta janela de histórico: historico.slice(-8) → slice(-40) em Construir Prompt
 * 2. Corrige persona restaurant:
 *    - Remove linha "🏠 Retirada: [endereço do restaurante...]" do template de confirmação
 *    - Adiciona regra anti-placeholder
 */

import 'dotenv/config';
import axios from 'axios';
import { MongoClient } from 'mongodb';

const N8N_URL = process.env.N8N_URL;
const N8N_API_KEY = process.env.N8N_API_KEY;
const MONGODB_URI = process.env.MONGODB_URI;
const WF_ID = 'jleu4RPvSnYDL8Gd';

if (!N8N_URL || !N8N_API_KEY || !MONGODB_URI) {
  console.error('❌ Faltando N8N_URL, N8N_API_KEY ou MONGODB_URI no .env');
  process.exit(1);
}

const headers = {
  'X-N8N-API-KEY': N8N_API_KEY,
  'Content-Type': 'application/json',
  'Accept': 'application/json',
};

// ─────────────────────────────────────────────
// PASSO 1: N8N — historico.slice(-8) → slice(-40)
// ─────────────────────────────────────────────
async function fixN8nContextWindow() {
  console.log('\n[1] Buscando workflow N8N...');
  const { data: wf } = await axios.get(`${N8N_URL}/api/v1/workflows/${WF_ID}`, { headers });

  const node = wf.nodes.find(n => n.name === 'Construir Prompt');
  if (!node) throw new Error('Node "Construir Prompt" não encontrado');

  const jsCode = node.parameters?.jsCode;
  if (!jsCode) throw new Error('Node "Construir Prompt" não tem jsCode');

  if (!jsCode.includes('historico.slice(-8)')) {
    console.log('   ⚠️  "historico.slice(-8)" não encontrado — talvez já corrigido?');
    console.log('   Procurando "historico.slice(" no código...');
    const match = jsCode.match(/historico\.slice\(-\d+\)/);
    if (match) console.log(`   Encontrado: ${match[0]}`);
    else console.log('   Não encontrado nenhum historico.slice()');
    return false;
  }

  const newCode = jsCode.replace('historico.slice(-8)', 'historico.slice(-40)');
  node.parameters.jsCode = newCode;

  console.log('   Aplicando historico.slice(-8) → slice(-40)...');

  const body = {
    name: wf.name,
    nodes: wf.nodes,
    connections: wf.connections,
    settings: {
      executionOrder: wf.settings?.executionOrder ?? 'v1',
      saveManualExecutions: wf.settings?.saveManualExecutions ?? true,
    },
  };

  await axios.put(`${N8N_URL}/api/v1/workflows/${WF_ID}`, body, { headers });
  console.log('   ✅ Workflow atualizado — historico.slice(-40)');
  return true;
}

// ─────────────────────────────────────────────
// PASSO 2: MongoDB — corrigir persona restaurant
// ─────────────────────────────────────────────
async function fixPersonaRestaurant() {
  console.log('\n[2] Conectando ao MongoDB...');
  const client = new MongoClient(MONGODB_URI);
  await client.connect();

  const db = client.db();
  const col = db.collection('businesses');

  // Busca qualquer doc que tenha a persona restaurant
  const doc = await col.findOne({ 'personas.restaurant': { $exists: true } });
  if (!doc) {
    console.log('   ⚠️  Nenhum documento com personas.restaurant encontrado');
    await client.close();
    return false;
  }

  console.log(`   Doc encontrado: ${doc._id} (${doc.name ?? doc._id})`);

  const currentPrompt = doc.personas?.restaurant?.systemPrompt;
  if (!currentPrompt) {
    console.log('   ⚠️  personas.restaurant.systemPrompt vazio');
    await client.close();
    return false;
  }

  console.log(`   Tamanho atual do systemPrompt: ${currentPrompt.length} chars`);

  // ── Mudança A: remover linha de Retirada com placeholder ──
  // A linha pode ter variações de espaço/emoji; usamos regex
  const retiradadaRe = /\n?[ \t]*🏠\s*Retirada:\s*\[endereço do restaurante[^\n]*\]\n?/g;
  let newPrompt = currentPrompt.replace(retiradadaRe, '\n');

  if (newPrompt === currentPrompt) {
    // Tenta match mais amplo
    const altRe = /\n?[ \t]*🏠\s*Retirada:[^\n]*\n?/g;
    const altMatch = currentPrompt.match(altRe);
    if (altMatch) {
      console.log(`   Linha encontrada (alt): ${altMatch[0].trim()}`);
      newPrompt = currentPrompt.replace(altRe, '\n');
    } else {
      console.log('   ⚠️  Linha "🏠 Retirada:" não encontrada no prompt — talvez já removida?');
    }
  } else {
    console.log('   ✓  Linha "🏠 Retirada: [endereço...]" removida');
  }

  // ── Mudança B: adicionar regra anti-placeholder ──
  const antiPlaceholder = `\n\n⚠️ REGRA OBRIGATÓRIA: NUNCA escreva texto entre colchetes \`[...]\` como placeholder nas mensagens ao restaurante ou ao cliente. Se um dado estiver faltando, PERGUNTE ao usuário ou OMITA a linha. Placeholders visíveis são proibidos.`;

  // Só adicionar se ainda não existir
  if (!newPrompt.includes('NUNCA escreva texto entre colchetes')) {
    // Inserir antes do último parágrafo ou no final
    newPrompt = newPrompt.trimEnd() + antiPlaceholder;
    console.log('   ✓  Regra anti-placeholder adicionada');
  } else {
    console.log('   ⚠️  Regra anti-placeholder já existe — pulando');
  }

  if (newPrompt === currentPrompt) {
    console.log('   ℹ️  Nenhuma mudança necessária na persona');
    await client.close();
    return false;
  }

  await col.updateOne(
    { _id: doc._id },
    { $set: { 'personas.restaurant.systemPrompt': newPrompt } }
  );

  console.log('   ✅ personas.restaurant.systemPrompt atualizado');
  console.log(`   Novo tamanho: ${newPrompt.length} chars`);
  await client.close();
  return true;
}

// ─────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────
(async () => {
  try {
    const r1 = await fixN8nContextWindow();
    const r2 = await fixPersonaRestaurant();

    console.log('\n─────────────────────────────────');
    if (r1 || r2) {
      console.log('✅ Concluído:');
      if (r1) console.log('   • historico.slice(-40) aplicado em Construir Prompt');
      if (r2) console.log('   • Persona restaurant corrigida no MongoDB');
    } else {
      console.log('ℹ️  Nenhuma mudança foi necessária (ambos já estavam corretos)');
    }
  } catch (err) {
    console.error('❌ Erro:', err.response?.data ?? err.message);
    process.exit(1);
  }
})();

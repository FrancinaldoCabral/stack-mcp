/**
 * fix-and-reset.mjs
 * Corrige o Executor N8N (URL Chatwoot, nós duplicados) e limpa dados para teste do zero.
 */
import 'dotenv/config';
import axios from 'axios';
import Redis from 'ioredis';
import { MongoClient } from 'mongodb';

const N8N_URL = process.env.N8N_URL;
const N8N_KEY = process.env.N8N_API_KEY;
const CW_URL  = process.env.CHATWOOT_URL ?? 'https://chatwoot.vendly.chat';
const EXEC_ID = 'jleu4RPvSnYDL8Gd';

const n8n = axios.create({
  baseURL: `${N8N_URL}/api/v1`,
  headers: { 'X-N8N-API-KEY': N8N_KEY, 'Content-Type': 'application/json', 'Accept': 'application/json' },
});

const ok   = (m) => console.log('✅ ', m);
const info = (m) => console.log('ℹ️  ', m);
const warn = (m) => console.log('⚠️  ', m);
const err  = (m) => console.error('❌ ', m);

// ──────────────────────────────────────────────────
// 1. Corrigir Executor: URL + duplicatas + conexões
// ──────────────────────────────────────────────────
async function fixExecutor() {
  info('Buscando workflow Executor...');
  const { data: wf } = await n8n.get(`/workflows/${EXEC_ID}`);
  let nodes = wf.nodes;
  const connections = JSON.parse(JSON.stringify(wf.connections));

  // -- Remover nós duplicados (manter apenas primeira ocorrência de cada id) --
  const seen = new Set();
  const dupIds = new Set();
  for (const n of nodes) {
    if (seen.has(n.id)) dupIds.add(n.id);
    seen.add(n.id);
  }
  if (dupIds.size > 0) {
    warn(`Removendo nós duplicados: ${[...dupIds].join(', ')}`);
    const kept = new Set();
    nodes = nodes.filter(n => {
      if (dupIds.has(n.id)) {
        if (kept.has(n.id)) return false; // remove duplicata
        kept.add(n.id);
        return true; // mantém primeira
      }
      return true;
    });
  }

  // -- Corrigir URL do Chatwoot GET Mensagens --
  const cwNode = nodes.find(n => n.id === 'chatwoot-get-msgs');
  if (cwNode) {
    const correctUrl = `={{ '${CW_URL}/api/v1/accounts/' + $('Desembalar Payload').first().json.account_id + '/conversations/' + $('Desembalar Payload').first().json.conversation_id + '/messages' }}`;
    if (cwNode.parameters.url !== correctUrl) {
      cwNode.parameters.url = correctUrl;
      ok('URL do Chatwoot GET Mensagens corrigida');
    } else {
      info('URL do Chatwoot GET Mensagens já está correta');
    }
  }

  // -- Corrigir conexões duplicadas de Desembalar Payload → Chatwoot GET Mensagens --
  const dpConns = connections['Desembalar Payload']?.main?.[0];
  if (dpConns) {
    // Remover entradas duplicadas (mesmo node name)
    const seen2 = new Map();
    const deduped = [];
    for (const c of dpConns) {
      if (!seen2.has(c.node)) {
        seen2.set(c.node, true);
        deduped.push(c);
      }
    }
    if (deduped.length < dpConns.length) {
      connections['Desembalar Payload'].main[0] = deduped;
      warn(`Removidas ${dpConns.length - deduped.length} conexões duplicadas de Desembalar Payload`);
    }
  }

  // -- Garantir conexão Preparar Histórico Chatwoot → Mesclar Histórico --
  if (!connections['Preparar Histórico Chatwoot']) {
    connections['Preparar Histórico Chatwoot'] = { main: [[{ node: 'Mesclar Histórico', type: 'main', index: 0 }]] };
    warn('Adicionada conexão Preparar Histórico Chatwoot → Mesclar Histórico');
  }

  // -- Garantir conexão Aguardar Digitacao → Chatwoot Enviar (em vez de Evolution Send) --
  const adConn = connections['Aguardar Digitacao']?.main?.[0];
  if (adConn) {
    const hasEvol = adConn.some(c => c.node === 'Evolution Send');
    const hasCw   = adConn.some(c => c.node === 'Chatwoot Enviar');
    if (hasEvol && !hasCw) {
      // substituir Evolution Send por Chatwoot Enviar
      connections['Aguardar Digitacao'].main[0] = [{ node: 'Chatwoot Enviar', type: 'main', index: 0 }];
      warn('Corrigida conexão Aguardar Digitacao → Chatwoot Enviar');
    }
  }

  // -- Garantir conexão Chatwoot Enviar → Loop Chunks --
  if (!connections['Chatwoot Enviar'] || !connections['Chatwoot Enviar'].main?.[0]?.length) {
    connections['Chatwoot Enviar'] = { main: [[{ node: 'Loop Chunks', type: 'main', index: 0 }]] };
    warn('Adicionada conexão Chatwoot Enviar → Loop Chunks');
  }

  // -- Salvar workflow corrigido --
  const body = {
    name: wf.name,
    nodes,
    connections,
    settings: { executionOrder: 'v1', saveManualExecutions: true },
  };
  await n8n.put(`/workflows/${EXEC_ID}`, body);
  ok('Executor corrigido e salvo');

  // -- Reativar --
  try {
    await n8n.post(`/workflows/${EXEC_ID}/activate`);
    ok('Executor reativado');
  } catch (e) {
    warn(`Reativar: ${e.response?.data?.message ?? e.message}`);
  }
}

// ──────────────────────────────────────────────────
// 2. Limpar Redis (buffers, debounce, sessões)
// ──────────────────────────────────────────────────
async function cleanRedis() {
  info('Conectando ao Redis...');
  const redis = new Redis({
    host: process.env.REDIS_HOST,
    port: parseInt(process.env.REDIS_PORT ?? '6379'),
    password: process.env.REDIS_PASSWORD,
    lazyConnect: true,
  });
  await redis.connect();

  const patterns = ['buffer:*', 'debounce_ts:*', 'sessao:*'];
  let total = 0;
  for (const pat of patterns) {
    const keys = await redis.keys(pat);
    if (keys.length) {
      await redis.del(...keys);
      total += keys.length;
      info(`  Deletadas ${keys.length} chaves: ${pat}`);
    }
  }
  ok(`Redis limpo — ${total} chaves removidas`);

  // -- Ver/exibir chaves agente:* existentes --
  const agentKeys = await redis.keys('agente:*');
  if (agentKeys.length) {
    info(`Chaves agente existentes: ${agentKeys.join(', ')}`);
    for (const k of agentKeys) {
      const v = await redis.get(k);
      console.log(`   ${k} →`, v?.slice(0, 120));
    }
  } else {
    warn('Nenhuma chave agente:* encontrada no Redis');
  }

  await redis.quit();
  return agentKeys;
}

// ──────────────────────────────────────────────────
// 3. Limpar MongoDB (customers, conversations logs)
// ──────────────────────────────────────────────────
async function cleanMongo() {
  info('Conectando ao MongoDB...');
  // Substituir hostname interno Coolify pelo IP direto, remover directConnection do URI
  const rawUri = process.env.MONGODB_URI ?? '';
  const mongoUri = rawUri
    .replace(/@[^@:/]+:/, '@157.173.111.65:')
    .replace(/directConnection=[^&]*/g, '').replace(/\?&/g, '?').replace(/\?$/, '')
    .replace(/&directConnection=[^&]*/i, '');
  const client = new MongoClient(mongoUri);
  await client.connect();
  const db = client.db('vendly');

  // Limpar coleções de runtime (manter businesses e agents)
  const custDel = await db.collection('customers').deleteMany({});
  const convDel = await db.collection('conversations').deleteMany({});
  ok(`MongoDB limpo — customers: ${custDel.deletedCount}, conversations: ${convDel.deletedCount}`);

  // Checar businesses + agents
  const bizs = await db.collection('businesses').find({}).project({
    name: 1, instances: 1, instanceInboxes: 1, instanceAgents: 1, agents: 1,
  }).toArray();

  info(`Businesses no banco: ${bizs.length}`);
  bizs.forEach(b => {
    const agents = (b.agents ?? []).map(a => `${a.name}(${a._id})`).join(', ');
    const assigned = JSON.stringify(b.instanceAgents ?? {});
    console.log(`   [${b._id}] ${b.name} | instances: ${(b.instances ?? []).join(',')} | agents: ${agents || 'nenhum'} | assigned: ${assigned}`);
  });

  await client.close();
  return bizs;
}

// ──────────────────────────────────────────────────
// 4. Seed Redis agente para instância de teste
// ──────────────────────────────────────────────────
async function seedAgentKey(bizs) {
  info('Verificando/criando chave agente no Redis...');
  const redis = new Redis({
    host: process.env.REDIS_HOST,
    port: parseInt(process.env.REDIS_PORT ?? '6379'),
    password: process.env.REDIS_PASSWORD,
    lazyConnect: true,
  });
  await redis.connect();

  // Coleta todos os instanceAgents de todos os businesses
  let written = 0;
  for (const biz of bizs) {
    const instanceAgents = biz.instanceAgents ?? {};
    const agents = biz.agents ?? [];
    for (const [instName, agentId] of Object.entries(instanceAgents)) {
      const agent = agents.find(a => String(a._id) === String(agentId));
      if (!agent) continue;

      const key = `agente:${instName}`;
      const existing = await redis.get(key);
      if (existing) {
        info(`  Chave ${key} já existe`);
      } else {
        const val = JSON.stringify({
          assistantName: agent.assistantName ?? agent.name,
          systemPrompt: agent.systemPrompt ?? '',
          model: agent.model ?? 'google/gemini-2.5-flash-lite',
          businessId: String(biz._id),
        });
        await redis.set(key, val);
        ok(`  Chave ${key} criada`);
        written++;
      }
    }
  }

  if (written === 0 && bizs.length === 0) {
    // Sem business: criar seed para teste manual
    warn('Nenhum business configurado. Criando agente de teste para inbox "suporte-redatudo"...');
    const testKey = 'agente:suporte-redatudo';
    const testVal = JSON.stringify({
      assistantName: 'Vendly AI',
      systemPrompt: 'Você é Vendly AI, atendente virtual da Vendly. Responda de forma simpática e eficiente.',
      model: 'google/gemini-2.5-flash-lite',
      businessId: 'test',
    });
    await redis.set(testKey, testVal);
    ok(`Agente de teste criado: ${testKey}`);
  } else if (written === 0 && bizs.length > 0) {
    warn('Businesses existem mas nenhum agente está atribuído a uma instância (instanceAgents vazio).');
    warn('Atribua um agente a uma instância no dashboard para ativar o bot.');
  }

  await redis.quit();
}

// ──────────────────────────────────────────────────
// Main
// ──────────────────────────────────────────────────
async function main() {
  console.log('\n🔧 Fix & Reset — Vendly Chatwoot-First\n');

  try {
    await fixExecutor();
  } catch (e) {
    err(`fixExecutor: ${e.response?.data?.message ?? e.message}`);
  }

  const agentKeys = await cleanRedis();
  const bizs = await cleanMongo();

  if (!agentKeys.length) {
    await seedAgentKey(bizs);
  }

  console.log('\n────────────────────────────────────────────────────────────');
  console.log('✨ Pronto para teste!\n');
  console.log('📋 Checklist:');
  console.log('   1. Certifique-se que a instância Evolution tem Chatwoot habilitado:');
  console.log('      GET https://evolution.vendly.chat/chatwoot/find/{instancia}');
  console.log('   2. Envie uma mensagem WhatsApp para o número conectado');
  console.log('   3. Verifique N8N: execução em /webhook/chatwoot-bot?');
  console.log('   4. Verifique Chatwoot: conversa criada + resposta outgoing?');
  console.log('   5. Verifique WhatsApp: usuário recebeu resposta?');
  console.log('────────────────────────────────────────────────────────────\n');
}

main().catch(e => { err(e.message); process.exit(1); });

import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { MongoClient, type Db } from 'mongodb';
import { config } from '../config.js';
import { createClient, safeRequest, toText } from '../utils/http.js';
import { randomUUID } from 'crypto';

// ── MongoDB helpers ──────────────────────────────────────────────────────────
let _mongoClient: MongoClient | null = null;
async function getMongo(): Promise<Db> {
  if (!_mongoClient) {
    _mongoClient = new MongoClient(config.mongodb.uri, { connectTimeoutMS: 10_000, serverSelectionTimeoutMS: 10_000 });
    await _mongoClient.connect();
  }
  return _mongoClient.db('vendly');
}

// ── Qdrant helper ────────────────────────────────────────────────────────────
const COLLECTION = 'vendly_intelligence';
function qdrant() {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (config.qdrant.apiKey) headers['api-key'] = config.qdrant.apiKey;
  return createClient(config.qdrant.url, headers);
}

// ── OpenRouter embedding ─────────────────────────────────────────────────────
async function embed(text: string): Promise<number[]> {
  const res = await fetch('https://openrouter.ai/api/v1/embeddings', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${config.openrouter.apiKey}`,
    },
    body: JSON.stringify({ model: config.openrouter.embeddingModel, input: text.slice(0, 8000) }),
  });
  if (!res.ok) throw new Error(`Embedding API error: ${res.status} ${await res.text()}`);
  const data = await res.json() as { data: Array<{ embedding: number[] }> };
  return data.data[0].embedding;
}

// ── Tool definitions ─────────────────────────────────────────────────────────
export const intelligenceTools: Tool[] = [
  // ── Blocos de inteligência ─────────────────────────────────────────────────
  {
    name: 'intelligence_add',
    description: 'Adiciona um bloco de inteligência textual ao Qdrant. Pode ser produto, FAQ, política, insight de cliente, resumo de conversa, ou qualquer contexto relevante. O bloco é automaticamente vetorizado e indexado para busca semântica.',
    inputSchema: {
      type: 'object',
      required: ['content'],
      properties: {
        content: { type: 'string', description: 'Texto livre do bloco de inteligência' },
        type: { type: 'string', description: 'Tipo do bloco: produto, faq, politica, insight, resumo, cliente, etc.' },
        instance: { type: 'string', description: 'Instância WhatsApp (negócio) a que pertence. Use "global" para todos os negócios.' },
        phone: { type: 'string', description: 'Telefone do cliente (se for inteligência específica de um cliente)' },
      },
    },
  },
  {
    name: 'intelligence_search',
    description: 'Busca semântica nos blocos de inteligência do Qdrant. Retorna os N mais relevantes para o texto de consulta.',
    inputSchema: {
      type: 'object',
      required: ['query'],
      properties: {
        query: { type: 'string', description: 'Texto de busca' },
        instance: { type: 'string', description: 'Filtrar por instância (negócio). Omita para buscar em todos.' },
        phone: { type: 'string', description: 'Filtrar por telefone de cliente' },
        type: { type: 'string', description: 'Filtrar por tipo de bloco' },
        limit: { type: 'number', description: 'Número máximo de resultados (padrão 5)' },
        score_threshold: { type: 'number', description: 'Score mínimo de similaridade 0-1 (padrão 0.3)' },
      },
    },
  },
  {
    name: 'intelligence_list',
    description: 'Lista blocos de inteligência com filtros opcionais (sem busca vetorial — scroll direto no Qdrant).',
    inputSchema: {
      type: 'object',
      properties: {
        instance: { type: 'string', description: 'Filtrar por instância' },
        phone: { type: 'string', description: 'Filtrar por telefone' },
        type: { type: 'string', description: 'Filtrar por tipo' },
        limit: { type: 'number', description: 'Máximo de resultados (padrão 20)' },
      },
    },
  },
  {
    name: 'intelligence_delete',
    description: 'Remove um bloco de inteligência do Qdrant pelo ID.',
    inputSchema: {
      type: 'object',
      required: ['id'],
      properties: {
        id: { type: 'string', description: 'UUID do bloco a remover' },
      },
    },
  },
  {
    name: 'intelligence_update',
    description: 'Atualiza o conteúdo de um bloco existente (recalcula o vetor automaticamente).',
    inputSchema: {
      type: 'object',
      required: ['id', 'content'],
      properties: {
        id: { type: 'string', description: 'UUID do bloco' },
        content: { type: 'string', description: 'Novo conteúdo do bloco' },
        type: { type: 'string', description: 'Atualizar tipo (opcional)' },
      },
    },
  },
  // ── Clientes ───────────────────────────────────────────────────────────────
  {
    name: 'customer_get',
    description: 'Busca o perfil de um cliente no MongoDB por instância + telefone.',
    inputSchema: {
      type: 'object',
      required: ['instance', 'phone'],
      properties: {
        instance: { type: 'string' },
        phone: { type: 'string', description: 'Número de telefone do cliente' },
      },
    },
  },
  {
    name: 'customer_list',
    description: 'Lista clientes de uma instância com filtros opcionais.',
    inputSchema: {
      type: 'object',
      required: ['instance'],
      properties: {
        instance: { type: 'string' },
        tag: { type: 'string', description: 'Filtrar por tag' },
        limit: { type: 'number', description: 'Máximo de resultados (padrão 20)' },
        skip: { type: 'number', description: 'Pular N documentos' },
      },
    },
  },
  {
    name: 'customer_update_profile',
    description: 'Atualiza o perfil de um cliente (notas, preferências, tags, etc.).',
    inputSchema: {
      type: 'object',
      required: ['instance', 'phone'],
      properties: {
        instance: { type: 'string' },
        phone: { type: 'string' },
        name: { type: 'string', description: 'Nome atualizado' },
        notes: { type: 'string', description: 'Notas sobre o cliente' },
        tags: { type: 'array', items: { type: 'string' }, description: 'Tags do cliente' },
        preferences: { type: 'object', description: 'Preferências livres (chave-valor)' },
      },
    },
  },
  {
    name: 'customer_conversations',
    description: 'Lista conversas de um cliente no MongoDB.',
    inputSchema: {
      type: 'object',
      required: ['instance', 'phone'],
      properties: {
        instance: { type: 'string' },
        phone: { type: 'string' },
        limit: { type: 'number', description: 'Máximo de conversas (padrão 5)' },
      },
    },
  },
  // ── Negócios ───────────────────────────────────────────────────────────────
  {
    name: 'business_get',
    description: 'Busca a configuração de um negócio pelo nome da instância WhatsApp.',
    inputSchema: {
      type: 'object',
      required: ['instance'],
      properties: {
        instance: { type: 'string', description: 'Nome da instância Evolution API' },
      },
    },
  },
  {
    name: 'business_upsert',
    description: 'Cria ou atualiza a configuração de um negócio. Define o systemPrompt personalizado que o agente usará para essa instância.',
    inputSchema: {
      type: 'object',
      required: ['instance'],
      properties: {
        instance: { type: 'string' },
        name: { type: 'string', description: 'Nome do negócio' },
        type: { type: 'string', description: 'Tipo: delivery, ecommerce, lead_gen, high_ticket, low_ticket, suporte, outro' },
        systemPrompt: { type: 'string', description: 'Prompt do sistema personalizado para este negócio. Substitui o prompt padrão.' },
        settings: { type: 'object', description: 'Configurações adicionais (formato livre)' },
        active: { type: 'boolean', description: 'Ativo/inativo' },
      },
    },
  },
  {
    name: 'business_list',
    description: 'Lista todos os negócios cadastrados.',
    inputSchema: {
      type: 'object',
      properties: {
        active_only: { type: 'boolean', description: 'Apenas negócios ativos (padrão false)' },
      },
    },
  },
];

// ── Handlers ─────────────────────────────────────────────────────────────────
type Args = Record<string, unknown>;

export async function handleIntelligenceTool(name: string, args: Args): Promise<string> {
  const q = qdrant();

  switch (name) {
    // ── Inteligência ──────────────────────────────────────────────────────────
    case 'intelligence_add': {
      const content = String(args.content);
      const vector = await embed(content);
      const id = randomUUID();
      const payload = {
        content,
        type: args.type ?? 'geral',
        instance: args.instance ?? 'global',
        phone: args.phone ?? null,
        source: 'manual',
        created_at: Math.floor(Date.now() / 1000),
      };
      const res = await safeRequest(() =>
        q.put(`/collections/${COLLECTION}/points`, { points: [{ id, vector, payload }] }).then(r => r.data)
      );
      return toText('data' in res ? { data: { id, ...res.data } } : res);
    }

    case 'intelligence_search': {
      const vector = await embed(String(args.query));
      const filter: Record<string, unknown> = {};
      const conditions: unknown[] = [];
      if (args.instance) conditions.push({ key: 'instance', match: { value: args.instance } });
      if (args.phone) conditions.push({ key: 'phone', match: { value: args.phone } });
      if (args.type) conditions.push({ key: 'type', match: { value: args.type } });
      if (conditions.length > 0) filter.must = conditions;
      const payload: Record<string, unknown> = {
        vector,
        limit: args.limit ?? 5,
        with_payload: true,
        score_threshold: args.score_threshold ?? 0.3,
      };
      if (conditions.length > 0) payload.filter = filter;
      const res = await safeRequest(() =>
        q.post(`/collections/${COLLECTION}/points/search`, payload).then(r => r.data)
      );
      return toText(res);
    }

    case 'intelligence_list': {
      const filter: Record<string, unknown> = {};
      const conditions: unknown[] = [];
      if (args.instance) conditions.push({ key: 'instance', match: { value: args.instance } });
      if (args.phone) conditions.push({ key: 'phone', match: { value: args.phone } });
      if (args.type) conditions.push({ key: 'type', match: { value: args.type } });
      const body: Record<string, unknown> = {
        limit: args.limit ?? 20,
        with_payload: true,
        with_vector: false,
      };
      if (conditions.length > 0) body.filter = { must: conditions };
      const res = await safeRequest(() =>
        q.post(`/collections/${COLLECTION}/points/scroll`, body).then(r => r.data)
      );
      return toText(res);
    }

    case 'intelligence_delete': {
      const res = await safeRequest(() =>
        q.post(`/collections/${COLLECTION}/points/delete`, { points: [args.id] }).then(r => r.data)
      );
      return toText(res);
    }

    case 'intelligence_update': {
      const content = String(args.content);
      const vector = await embed(content);
      // Get existing point to preserve payload
      const existing = await safeRequest(() =>
        q.post(`/collections/${COLLECTION}/points`, { ids: [args.id], with_payload: true }).then(r => r.data)
      );
      const oldPayload = (existing as { result?: Array<{ payload?: Record<string, unknown> }> })?.result?.[0]?.payload ?? {};
      const newPayload = {
        ...oldPayload,
        content,
        ...(args.type ? { type: args.type } : {}),
        updated_at: Math.floor(Date.now() / 1000),
      };
      const res = await safeRequest(() =>
        q.put(`/collections/${COLLECTION}/points`, { points: [{ id: args.id, vector, payload: newPayload }] }).then(r => r.data)
      );
      return toText(res);
    }

    // ── Clientes ──────────────────────────────────────────────────────────────
    case 'customer_get': {
      const db = await getMongo();
      const doc = await db.collection('customers').findOne({ instance: args.instance, phone: args.phone });
      return JSON.stringify(doc ?? { error: 'Cliente não encontrado' }, null, 2);
    }

    case 'customer_list': {
      const db = await getMongo();
      const filter: Record<string, unknown> = { instance: args.instance };
      if (args.tag) filter.tags = args.tag;
      const docs = await db.collection('customers')
        .find(filter)
        .sort({ last_seen: -1 })
        .limit(Number(args.limit ?? 20))
        .skip(Number(args.skip ?? 0))
        .toArray();
      return JSON.stringify(docs, null, 2);
    }

    case 'customer_update_profile': {
      const db = await getMongo();
      const setFields: Record<string, unknown> = { updated_at: new Date() };
      if (args.name) setFields.name = args.name;
      if (args.tags) setFields.tags = args.tags;
      if (args.preferences) setFields['profile.preferences'] = args.preferences;
      if (args.notes) setFields['profile.notes'] = args.notes;
      const res = await db.collection('customers').updateOne(
        { instance: args.instance, phone: args.phone },
        { $set: setFields, $setOnInsert: { first_seen: new Date(), conversation_count: 0 } },
        { upsert: true }
      );
      return JSON.stringify(res, null, 2);
    }

    case 'customer_conversations': {
      const db = await getMongo();
      const docs = await db.collection('conversations')
        .find({ instance: args.instance, phone: args.phone })
        .sort({ started_at: -1 })
        .limit(Number(args.limit ?? 5))
        .toArray();
      return JSON.stringify(docs, null, 2);
    }

    // ── Negócios ──────────────────────────────────────────────────────────────
    case 'business_get': {
      const db = await getMongo();
      const doc = await db.collection('businesses').findOne({ instance: args.instance });
      return JSON.stringify(doc ?? { error: 'Negócio não encontrado' }, null, 2);
    }

    case 'business_upsert': {
      const db = await getMongo();
      const setFields: Record<string, unknown> = { updated_at: new Date() };
      if (args.name) setFields.name = args.name;
      if (args.type) setFields.type = args.type;
      if (args.systemPrompt !== undefined) setFields.systemPrompt = args.systemPrompt;
      if (args.settings) setFields.settings = args.settings;
      if (args.active !== undefined) setFields.active = args.active;
      const res = await db.collection('businesses').updateOne(
        { instance: args.instance },
        { $set: setFields, $setOnInsert: { instance: args.instance, created_at: new Date() } },
        { upsert: true }
      );
      return JSON.stringify(res, null, 2);
    }

    case 'business_list': {
      const db = await getMongo();
      const filter: Record<string, unknown> = {};
      if (args.active_only) filter.active = true;
      const docs = await db.collection('businesses')
        .find(filter)
        .sort({ name: 1 })
        .toArray();
      return JSON.stringify(docs, null, 2);
    }

    default:
      return `❌ Ferramenta não encontrada: ${name}`;
  }
}

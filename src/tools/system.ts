/**
 * system.ts — Ferramentas de manutenção do sistema
 * Limpeza de conversas: por contato ou tudo de uma vez.
 * Opera sobre Chatwoot (mensagens), Redis (sessao/buffer/debounce/takeover) e MongoDB.
 */
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { config } from '../config.js';
import { createClient, safeRequest } from '../utils/http.js';
import { getRedis } from './redis.js';
import { getDb } from './mongodb.js';

type Args = Record<string, unknown>;

function chatwootHttp() {
  return createClient(config.chatwoot.url, {
    api_access_token: config.chatwoot.apiKey,
    'Content-Type': 'application/json',
  });
}

const accountId = () => config.chatwoot.accountId;

// ── Helpers ─────────────────────────────────────────────────────────────────

/** Deleta todas as mensagens de uma conversa Chatwoot. */
async function deleteAllMessages(http: ReturnType<typeof chatwootHttp>, convId: number): Promise<number> {
  let deleted = 0;
  let beforeId: number | null = null;

  while (true) {
    const url = beforeId
      ? `/api/v1/accounts/${accountId()}/conversations/${convId}/messages?before_id=${beforeId}`
      : `/api/v1/accounts/${accountId()}/conversations/${convId}/messages`;

    const res = await safeRequest(() => http.get(url).then(r => r.data));
    const payload = (res as { payload?: unknown[] })?.payload ?? [];
    if (!Array.isArray(payload) || payload.length === 0) break;

    const ids = payload.map((m: unknown) => (m as { id: number }).id);

    for (const id of ids) {
      await safeRequest(() =>
        http.delete(`/api/v1/accounts/${accountId()}/conversations/${convId}/messages/${id}`).then(r => r.data)
      );
      deleted++;
    }

    if (payload.length < 25) break;
    beforeId = Math.min(...ids);
  }

  return deleted;
}

/** Lista todos os IDs de conversas Chatwoot (com paginação). */
async function listAllChatwootConversationIds(http: ReturnType<typeof chatwootHttp>): Promise<number[]> {
  const ids: number[] = [];
  let page = 1;

  while (true) {
    const res = await safeRequest(() =>
      http.get(`/api/v1/accounts/${accountId()}/conversations`, { params: { page } }).then(r => r.data)
    );
    const data = (res as { data?: { payload?: unknown[] } })?.data?.payload ?? (res as { payload?: unknown[] })?.payload ?? [];
    if (!Array.isArray(data) || data.length === 0) break;
    ids.push(...data.map((c: unknown) => (c as { id: number }).id));
    if (data.length < 25) break;
    page++;
  }

  return ids;
}

/** Tenta deletar uma conversa do Chatwoot. Retorna true se sucesso. */
async function deleteConversation(http: ReturnType<typeof chatwootHttp>, convId: number): Promise<boolean> {
  try {
    await safeRequest(() =>
      http.delete(`/api/v1/accounts/${accountId()}/conversations/${convId}`).then(r => r.data)
    );
    return true;
  } catch {
    return false;
  }
}

/** Lista todos os IDs de contatos do Chatwoot (com paginação). */
async function listAllChatwootContactIds(http: ReturnType<typeof chatwootHttp>): Promise<number[]> {
  const ids = new Set<number>();
  let page = 1;

  while (true) {
    const res = await safeRequest(() =>
      http.get(`/api/v1/accounts/${accountId()}/contacts`, { params: { page } }).then(r => r.data)
    );
    const data = (res as { payload?: unknown[] })?.payload ?? [];
    if (!Array.isArray(data) || data.length === 0) break;
    data.forEach((c: unknown) => ids.add((c as { id: number }).id));
    if (data.length < 15) break;
    page++;
    if (page > 500) break; // sanity
  }

  return [...ids];
}

/** Deleta um contato do Chatwoot (cascateia conversas associadas). */
async function deleteContact(http: ReturnType<typeof chatwootHttp>, contactId: number): Promise<boolean> {
  try {
    await safeRequest(() =>
      http.delete(`/api/v1/accounts/${accountId()}/contacts/${contactId}`).then(r => r.data)
    );
    return true;
  } catch {
    return false;
  }
}

/** Deleta chaves Redis por prefixos do sistema de conversas. */
async function deleteRedisKeysByPattern(pattern: string): Promise<number> {
  const redis = getRedis();
  let cursor = '0';
  let deleted = 0;

  do {
    const [nextCursor, keys] = await redis.scan(cursor, 'MATCH', pattern, 'COUNT', 200);
    cursor = nextCursor;
    if (keys.length > 0) {
      await redis.del(...keys);
      deleted += keys.length;
    }
  } while (cursor !== '0');

  return deleted;
}

/** Deleta pontos do Qdrant por filtro (ou todos, se filter=null). Nunca lança. */
async function deleteQdrantPoints(collection: string, filter: Record<string, unknown> | null): Promise<{ deleted: number; error?: string }> {
  try {
    if (!config.qdrant.url) return { deleted: 0, error: 'QDRANT_URL não configurado' };
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (config.qdrant.apiKey) headers['api-key'] = config.qdrant.apiKey;
    const base = config.qdrant.url.replace(/\/$/, '');

    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 8000);

    // Verifica se a coleção existe
    const infoRes = await fetch(`${base}/collections/${collection}`, { headers, signal: ctrl.signal });
    if (!infoRes.ok) {
      clearTimeout(t);
      return { deleted: 0, error: `coleção ${collection} inacessível (status ${infoRes.status})` };
    }

    // Conta pontos antes
    let before = 0;
    try {
      const countRes = await fetch(`${base}/collections/${collection}/points/count`, {
        method: 'POST', headers, signal: ctrl.signal,
        body: JSON.stringify({ exact: true, ...(filter ? { filter } : {}) }),
      });
      if (countRes.ok) {
        const j = await countRes.json() as { result?: { count?: number } };
        before = j.result?.count ?? 0;
      }
    } catch { /* ignore */ }

    if (before === 0) { clearTimeout(t); return { deleted: 0 }; }

    // Delete: se filter nulo, usa filter "match all" via must_not vazio (idiom Qdrant)
    const body = filter
      ? { filter }
      : { filter: { must_not: [{ key: '___never___', match: { value: '___never___' } }] } };

    const delRes = await fetch(`${base}/collections/${collection}/points/delete`, {
      method: 'POST', headers, signal: ctrl.signal, body: JSON.stringify(body),
    });
    clearTimeout(t);
    if (!delRes.ok) {
      const txt = await delRes.text().catch(() => '');
      return { deleted: 0, error: `delete falhou: ${delRes.status} ${txt.slice(0, 120)}` };
    }
    return { deleted: before };
  } catch (e) {
    return { deleted: 0, error: `qdrant indisponível: ${(e as Error)?.message ?? String(e)}` };
  }
}

// ── Definições de ferramentas ────────────────────────────────────────────────

export const systemTools: Tool[] = [
  {
    name: 'system_clear_contact',
    description:
      'Limpa TODOS os dados de um contato: mensagens do Chatwoot, chaves Redis (sessão, buffer, debounce, human_takeover) e documentos MongoDB. ' +
      'Passe o telefone no formato internacional (ex: 5511999999999).',
    inputSchema: {
      type: 'object',
      required: ['phone'],
      properties: {
        phone: {
          type: 'string',
          description: 'Número do contato no formato internacional (ex: 5511999999999)',
        },
        instance: {
          type: 'string',
          description: 'Filtrar chaves Redis por instância Evolution específica (opcional)',
        },
      },
    },
  },
  {
    name: 'system_clear_all_conversations',
    description:
      'APAGA TUDO: mensagens + conversas + contatos do Chatwoot, chaves Redis (sessao/buffer/debounce/human_takeover), ' +
      'collections MongoDB conversations/customers/delivery_orders/delivery_settlements, e memória vetorial (Qdrant vendly_intelligence). ' +
      'Preserva cadastros (businesses, agentes, personas, restaurantes de delivery, knowledge base curada). Operação irreversível.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
];

// ── Handlers ─────────────────────────────────────────────────────────────────

export async function handleSystemTool(name: string, args: Args): Promise<string> {
  switch (name) {
    case 'system_clear_contact': {
      const phone = String(args.phone ?? '').replace(/\D/g, '');
      if (!phone) return '❌ Parâmetro "phone" obrigatório.';

      const results: string[] = [];

      // 1. Chatwoot
      try {
        const http = chatwootHttp();
        const searchRes = await safeRequest(() =>
          http.get(`/api/v1/accounts/${accountId()}/contacts/search`, { params: { q: phone, include_contacts: true } }).then(r => r.data)
        );
        const contacts: unknown[] = (searchRes as { payload?: unknown[] })?.payload ?? [];
        let chatwootDeletedMsgs = 0;
        let chatwootDeletedConvs = 0;
        let chatwootDeletedContacts = 0;
        for (const contact of contacts) {
          const contactId = (contact as { id: number }).id;
          const convsRes = await safeRequest(() =>
            http.get(`/api/v1/accounts/${accountId()}/contacts/${contactId}/conversations`).then(r => r.data)
          ).catch(() => ({}));
          const convs: unknown[] = (convsRes as { payload?: unknown[] })?.payload ?? [];
          for (const conv of convs) {
            const convId = (conv as { id: number }).id;
            chatwootDeletedMsgs += await deleteAllMessages(http, convId).catch(() => 0);
            if (await deleteConversation(http, convId)) chatwootDeletedConvs++;
          }
          if (await deleteContact(http, contactId)) chatwootDeletedContacts++;
        }
        results.push(`✅ Chatwoot: ${chatwootDeletedMsgs} mensagens, ${chatwootDeletedConvs} conversas, ${chatwootDeletedContacts} contatos deletados`);
      } catch (e) {
        results.push(`⚠️ Chatwoot: falhou (${(e as Error)?.message ?? String(e)})`);
      }

      // 2. Redis
      try {
        const instanceFilter = args.instance ? String(args.instance) : '*';
        const jidSuffix1 = `${phone}@s.whatsapp.net`;
        const jidSuffix2 = `${phone}@g.us`;
        let redisDeleted = 0;
        for (const prefix of ['sessao', 'human_takeover', 'debounce_ts', 'buffer']) {
          redisDeleted += await deleteRedisKeysByPattern(`${prefix}:${instanceFilter}:${jidSuffix1}`).catch(() => 0);
          redisDeleted += await deleteRedisKeysByPattern(`${prefix}:${instanceFilter}:${jidSuffix2}`).catch(() => 0);
        }
        results.push(`✅ Redis: ${redisDeleted} chaves deletadas`);
      } catch (e) {
        results.push(`⚠️ Redis: falhou (${(e as Error)?.message ?? String(e)})`);
      }

      // 3. MongoDB
      try {
        const db = await getDb();
        const mongoResult = await db.collection('conversations').deleteMany({ phone }).catch(() => ({ deletedCount: 0 }));
        const ordResult = await db.collection('delivery_orders').deleteMany({ clientPhone: phone }).catch(() => ({ deletedCount: 0 }));
        const settResult = await db.collection('delivery_settlements').deleteMany({ clientPhone: phone }).catch(() => ({ deletedCount: 0 }));
        results.push(
          `✅ MongoDB: ${mongoResult.deletedCount} conversas, ${ordResult.deletedCount} pedidos, ${settResult.deletedCount} acertos deletados`
        );
      } catch (e) {
        results.push(`⚠️ MongoDB: falhou (${(e as Error)?.message ?? String(e)})`);
      }

      // 4. Qdrant
      const qFilter = { must: [{ key: 'phone', match: { value: phone } }] };
      const qdrantRes = await deleteQdrantPoints('vendly_intelligence', qFilter);
      if (qdrantRes.error) {
        results.push(`⚠️ Qdrant: ${qdrantRes.error}`);
      } else {
        results.push(`✅ Qdrant: ${qdrantRes.deleted} blocos de memória do atendente apagados`);
      }

      return results.join('\n');
    }

    case 'system_clear_all_conversations': {
      const summary: string[] = [];

      // 1. Chatwoot — apagar mensagens + conversas + contatos
      try {
        const http = chatwootHttp();
        const convIds = await listAllChatwootConversationIds(http);
        let totalMsgs = 0;
        let convsDeleted = 0;
        for (const convId of convIds) {
          totalMsgs += await deleteAllMessages(http, convId).catch(() => 0);
          if (await deleteConversation(http, convId)) convsDeleted++;
        }
        const contactIds = await listAllChatwootContactIds(http);
        let contactsDeleted = 0;
        for (const contactId of contactIds) {
          if (await deleteContact(http, contactId)) contactsDeleted++;
        }
        summary.push(`✅ Chatwoot: ${totalMsgs} mensagens, ${convsDeleted}/${convIds.length} conversas, ${contactsDeleted}/${contactIds.length} contatos deletados`);
      } catch (e) {
        summary.push(`⚠️ Chatwoot: falhou (${(e as Error)?.message ?? String(e)})`);
      }

      // 2. Redis — apagar todas as chaves de conversas
      try {
        let redisDeleted = 0;
        for (const prefix of ['sessao', 'human_takeover', 'debounce_ts', 'buffer']) {
          redisDeleted += await deleteRedisKeysByPattern(`${prefix}:*`).catch(() => 0);
        }
        summary.push(`✅ Redis: ${redisDeleted} chaves deletadas`);
      } catch (e) {
        summary.push(`⚠️ Redis: falhou (${(e as Error)?.message ?? String(e)})`);
      }

      // 3. MongoDB — limpar histórico de conversa + pedidos + acertos (preserva businesses, agentes, restaurantes, knowledge)
      try {
        const db = await getDb();
        const convDel = await db.collection('conversations').deleteMany({}).catch(() => ({ deletedCount: 0 }));
        const custDel = await db.collection('customers').deleteMany({}).catch(() => ({ deletedCount: 0 }));
        const ordDel  = await db.collection('delivery_orders').deleteMany({}).catch(() => ({ deletedCount: 0 }));
        const settDel = await db.collection('delivery_settlements').deleteMany({}).catch(() => ({ deletedCount: 0 }));
        summary.push(
          `✅ MongoDB: ${convDel.deletedCount} conversas, ${custDel.deletedCount} customers, ` +
          `${ordDel.deletedCount} pedidos, ${settDel.deletedCount} acertos deletados ` +
          `(businesses/agentes/restaurantes/knowledge preservados)`
        );
      } catch (e) {
        summary.push(`⚠️ MongoDB: falhou (${(e as Error)?.message ?? String(e)})`);
      }

      // 4. Qdrant — memória vetorial do atendente (vendly_intelligence)
      const qdrantRes = await deleteQdrantPoints('vendly_intelligence', null);
      if (qdrantRes.error) {
        summary.push(`⚠️ Qdrant: ${qdrantRes.error}`);
      } else {
        summary.push(`✅ Qdrant: ${qdrantRes.deleted} blocos de memória do atendente apagados`);
      }

      return summary.join('\n');
    }

    default:
      return `❌ Ferramenta não encontrada: ${name}`;
  }
}

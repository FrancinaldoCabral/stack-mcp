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
      'APAGA TUDO: todas as mensagens de todas as conversas no Chatwoot, todas as chaves Redis de sessão/buffer/debounce/human_takeover, e todos os documentos da collection conversations no MongoDB. ' +
      'Operação irreversível.',
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

      const http = chatwootHttp();
      const results: string[] = [];

      // 1. Buscar contato no Chatwoot pelo telefone
      const searchRes = await safeRequest(() =>
        http.get(`/api/v1/accounts/${accountId()}/contacts/search`, { params: { q: phone, include_contacts: true } }).then(r => r.data)
      );
      const contacts: unknown[] = (searchRes as { payload?: unknown[] })?.payload ?? [];
      let chatwootDeletedMsgs = 0;

      for (const contact of contacts) {
        const contactId = (contact as { id: number }).id;
        // Listar conversas do contato
        const convsRes = await safeRequest(() =>
          http.get(`/api/v1/accounts/${accountId()}/contacts/${contactId}/conversations`).then(r => r.data)
        );
        const convs: unknown[] = (convsRes as { payload?: unknown[] })?.payload ?? [];
        for (const conv of convs) {
          const convId = (conv as { id: number }).id;
          chatwootDeletedMsgs += await deleteAllMessages(http, convId);
        }
      }

      results.push(`✅ Chatwoot: ${chatwootDeletedMsgs} mensagens deletadas`);

      // 2. Limpar Redis — chaves com padrão *:phone* (ambos formatos de JID)
      const instanceFilter = args.instance ? String(args.instance) : '*';
      const jidSuffix1 = `${phone}@s.whatsapp.net`;
      const jidSuffix2 = `${phone}@g.us`;
      let redisDeleted = 0;

      for (const prefix of ['sessao', 'human_takeover', 'debounce_ts', 'buffer']) {
        redisDeleted += await deleteRedisKeysByPattern(`${prefix}:${instanceFilter}:${jidSuffix1}`);
        redisDeleted += await deleteRedisKeysByPattern(`${prefix}:${instanceFilter}:${jidSuffix2}`);
      }

      results.push(`✅ Redis: ${redisDeleted} chaves deletadas`);

      // 3. MongoDB — conversas do telefone
      const db = await getDb();
      const mongoResult = await db.collection('conversations').deleteMany({ phone });
      results.push(`✅ MongoDB: ${mongoResult.deletedCount} documentos deletados`);

      return results.join('\n');
    }

    case 'system_clear_all_conversations': {
      const http = chatwootHttp();
      const summary: string[] = [];

      // 1. Chatwoot — apagar mensagens de todas as conversas
      const convIds = await listAllChatwootConversationIds(http);
      let totalMsgs = 0;
      for (const convId of convIds) {
        totalMsgs += await deleteAllMessages(http, convId);
      }
      summary.push(`✅ Chatwoot: ${totalMsgs} mensagens deletadas em ${convIds.length} conversas`);

      // 2. Redis — apagar todas as chaves de conversas
      let redisDeleted = 0;
      for (const prefix of ['sessao', 'human_takeover', 'debounce_ts', 'buffer']) {
        redisDeleted += await deleteRedisKeysByPattern(`${prefix}:*`);
      }
      summary.push(`✅ Redis: ${redisDeleted} chaves deletadas`);

      // 3. MongoDB — limpar collection conversations
      const db = await getDb();
      const mongoResult = await db.collection('conversations').deleteMany({});
      summary.push(`✅ MongoDB: ${mongoResult.deletedCount} documentos deletados`);

      return summary.join('\n');
    }

    default:
      return `❌ Ferramenta não encontrada: ${name}`;
  }
}

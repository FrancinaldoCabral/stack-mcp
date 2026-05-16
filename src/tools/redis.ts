import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { Redis } from 'ioredis';
import { config } from '../config.js';

let _redis: InstanceType<typeof Redis> | null = null;

function getRedis(): InstanceType<typeof Redis> {
  if (_redis) return _redis;
  _redis = new Redis(config.redis.url, {
    lazyConnect: true,
    connectTimeout: 10_000,
    maxRetriesPerRequest: 2,
  });
  return _redis;
}

export const redisTools: Tool[] = [
  {
    name: 'redis_get',
    description: 'Obtém o valor de uma chave Redis.',
    inputSchema: {
      type: 'object',
      required: ['key'],
      properties: { key: { type: 'string' } },
    },
  },
  {
    name: 'redis_set',
    description: 'Define o valor de uma chave Redis com TTL opcional.',
    inputSchema: {
      type: 'object',
      required: ['key', 'value'],
      properties: {
        key: { type: 'string' },
        value: { type: 'string', description: 'Valor (objetos serão serializados em JSON)' },
        ttl: { type: 'number', description: 'TTL em segundos (opcional)' },
      },
    },
  },
  {
    name: 'redis_delete',
    description: 'Remove uma ou mais chaves do Redis.',
    inputSchema: {
      type: 'object',
      required: ['keys'],
      properties: {
        keys: {
          description: 'Chave ou lista de chaves',
          oneOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }],
        },
      },
    },
  },
  {
    name: 'redis_list_keys',
    description: 'Lista chaves que correspondem a um padrão (use * como wildcard).',
    inputSchema: {
      type: 'object',
      required: ['pattern'],
      properties: {
        pattern: { type: 'string', description: 'Padrão de busca (ex: "session:*", "cache:*")' },
        count: { type: 'number', description: 'Número aproximado de chaves por scan (padrão 100)' },
      },
    },
  },
  {
    name: 'redis_hget',
    description: 'Obtém um ou todos os campos de um hash Redis.',
    inputSchema: {
      type: 'object',
      required: ['key'],
      properties: {
        key: { type: 'string' },
        field: { type: 'string', description: 'Campo específico (omitir para retornar todos os campos)' },
      },
    },
  },
  {
    name: 'redis_hset',
    description: 'Define campos em um hash Redis.',
    inputSchema: {
      type: 'object',
      required: ['key', 'fields'],
      properties: {
        key: { type: 'string' },
        fields: { type: 'object', description: 'Objeto com campo:valor' },
      },
    },
  },
  {
    name: 'redis_lpush',
    description: 'Insere valores no início de uma lista Redis.',
    inputSchema: {
      type: 'object',
      required: ['key', 'values'],
      properties: {
        key: { type: 'string' },
        values: { type: 'array', items: { type: 'string' }, description: 'Valores a inserir' },
      },
    },
  },
  {
    name: 'redis_lrange',
    description: 'Obtém elementos de uma lista Redis por índice.',
    inputSchema: {
      type: 'object',
      required: ['key'],
      properties: {
        key: { type: 'string' },
        start: { type: 'number', description: 'Índice inicial (padrão 0)' },
        stop: { type: 'number', description: 'Índice final (padrão -1 = todos)' },
      },
    },
  },
  {
    name: 'redis_ttl',
    description: 'Verifica o TTL restante de uma chave Redis.',
    inputSchema: {
      type: 'object',
      required: ['key'],
      properties: { key: { type: 'string' } },
    },
  },
  {
    name: 'redis_info',
    description: 'Retorna informações sobre o servidor Redis (memória, clientes, estatísticas).',
    inputSchema: {
      type: 'object',
      properties: {
        section: {
          type: 'string',
          enum: ['server', 'clients', 'memory', 'stats', 'keyspace', 'all'],
          description: 'Seção específica (padrão: all)',
        },
      },
    },
  },
  {
    name: 'redis_expire',
    description: 'Define ou atualiza o TTL de uma chave existente.',
    inputSchema: {
      type: 'object',
      required: ['key', 'seconds'],
      properties: {
        key: { type: 'string' },
        seconds: { type: 'number', description: 'TTL em segundos' },
      },
    },
  },
];

type Args = Record<string, unknown>;

async function safeExec<T>(fn: (r: InstanceType<typeof Redis>) => Promise<T>): Promise<string> {
  try {
    const r = getRedis();
    const result = await fn(r);
    return JSON.stringify(result, null, 2);
  } catch (err) {
    return `❌ Erro Redis: ${String(err)}`;
  }
}

export async function handleRedisTool(name: string, args: Args): Promise<string> {
  switch (name) {
    case 'redis_get': {
      return safeExec(async r => {
        const val = await r.get(args.key as string);
        if (!val) return null;
        try { return JSON.parse(val); } catch { return val; }
      });
    }
    case 'redis_set': {
      return safeExec(async r => {
        const value = typeof args.value === 'string' ? args.value : JSON.stringify(args.value);
        if (args.ttl) {
          return r.set(args.key as string, value, 'EX', args.ttl as number);
        }
        return r.set(args.key as string, value);
      });
    }
    case 'redis_delete': {
      return safeExec(async r => {
        const keys = Array.isArray(args.keys) ? args.keys as string[] : [args.keys as string];
        const count = await r.del(...keys);
        return { deleted: count };
      });
    }
    case 'redis_list_keys': {
      return safeExec(async r => {
        const keys: string[] = [];
        const stream = r.scanStream({ match: args.pattern as string, count: (args.count as number) ?? 100 });
        for await (const batch of stream) keys.push(...(batch as string[]));
        return { keys, total: keys.length };
      });
    }
    case 'redis_hget': {
      return safeExec(async r => {
        if (args.field) return r.hget(args.key as string, args.field as string);
        return r.hgetall(args.key as string);
      });
    }
    case 'redis_hset': {
      return safeExec(async r => {
        const fields = args.fields as Record<string, string>;
        const flat: string[] = [];
        for (const [k, v] of Object.entries(fields)) flat.push(k, String(v));
        const count = await r.hset(args.key as string, ...flat);
        return { updated: count };
      });
    }
    case 'redis_lpush': {
      return safeExec(async r => {
        const values = args.values as string[];
        const len = await r.lpush(args.key as string, ...values);
        return { length: len };
      });
    }
    case 'redis_lrange': {
      return safeExec(async r =>
        r.lrange(args.key as string, (args.start as number) ?? 0, (args.stop as number) ?? -1)
      );
    }
    case 'redis_ttl': {
      return safeExec(async r => {
        const ttl = await r.ttl(args.key as string);
        return { key: args.key, ttl_seconds: ttl, expires: ttl > 0 ? new Date(Date.now() + ttl * 1000).toISOString() : null };
      });
    }
    case 'redis_info': {
      return safeExec(async r => {
        const section = (args.section as string) ?? 'all';
        return section === 'all' ? r.info() : r.info(section);
      });
    }
    case 'redis_expire': {
      return safeExec(async r => {
        const result = await r.expire(args.key as string, args.seconds as number);
        return { success: result === 1 };
      });
    }
    default:
      return `❌ Ferramenta desconhecida: ${name}`;
  }
}

export async function closeRedis(): Promise<void> {
  if (_redis) {
    _redis.quit();
    _redis = null;
  }
}

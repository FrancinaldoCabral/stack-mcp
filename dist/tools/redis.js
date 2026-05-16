import { Redis } from 'ioredis';
import { config } from '../config.js';
let _redis = null;
function getRedis() {
    if (_redis)
        return _redis;
    _redis = new Redis(config.redis.url, {
        lazyConnect: true,
        connectTimeout: 10_000,
        maxRetriesPerRequest: 2,
    });
    return _redis;
}
export const redisTools = [
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
async function safeExec(fn) {
    try {
        const r = getRedis();
        const result = await fn(r);
        return JSON.stringify(result, null, 2);
    }
    catch (err) {
        return `❌ Erro Redis: ${String(err)}`;
    }
}
export async function handleRedisTool(name, args) {
    switch (name) {
        case 'redis_get': {
            return safeExec(async (r) => {
                const val = await r.get(args.key);
                if (!val)
                    return null;
                try {
                    return JSON.parse(val);
                }
                catch {
                    return val;
                }
            });
        }
        case 'redis_set': {
            return safeExec(async (r) => {
                const value = typeof args.value === 'string' ? args.value : JSON.stringify(args.value);
                if (args.ttl) {
                    return r.set(args.key, value, 'EX', args.ttl);
                }
                return r.set(args.key, value);
            });
        }
        case 'redis_delete': {
            return safeExec(async (r) => {
                const keys = Array.isArray(args.keys) ? args.keys : [args.keys];
                const count = await r.del(...keys);
                return { deleted: count };
            });
        }
        case 'redis_list_keys': {
            return safeExec(async (r) => {
                const keys = [];
                const stream = r.scanStream({ match: args.pattern, count: args.count ?? 100 });
                for await (const batch of stream)
                    keys.push(...batch);
                return { keys, total: keys.length };
            });
        }
        case 'redis_hget': {
            return safeExec(async (r) => {
                if (args.field)
                    return r.hget(args.key, args.field);
                return r.hgetall(args.key);
            });
        }
        case 'redis_hset': {
            return safeExec(async (r) => {
                const fields = args.fields;
                const flat = [];
                for (const [k, v] of Object.entries(fields))
                    flat.push(k, String(v));
                const count = await r.hset(args.key, ...flat);
                return { updated: count };
            });
        }
        case 'redis_lpush': {
            return safeExec(async (r) => {
                const values = args.values;
                const len = await r.lpush(args.key, ...values);
                return { length: len };
            });
        }
        case 'redis_lrange': {
            return safeExec(async (r) => r.lrange(args.key, args.start ?? 0, args.stop ?? -1));
        }
        case 'redis_ttl': {
            return safeExec(async (r) => {
                const ttl = await r.ttl(args.key);
                return { key: args.key, ttl_seconds: ttl, expires: ttl > 0 ? new Date(Date.now() + ttl * 1000).toISOString() : null };
            });
        }
        case 'redis_info': {
            return safeExec(async (r) => {
                const section = args.section ?? 'all';
                return section === 'all' ? r.info() : r.info(section);
            });
        }
        case 'redis_expire': {
            return safeExec(async (r) => {
                const result = await r.expire(args.key, args.seconds);
                return { success: result === 1 };
            });
        }
        default:
            return `❌ Ferramenta desconhecida: ${name}`;
    }
}
export async function closeRedis() {
    if (_redis) {
        _redis.quit();
        _redis = null;
    }
}

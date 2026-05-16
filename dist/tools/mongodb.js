import { MongoClient } from 'mongodb';
import { config } from '../config.js';
let _client = null;
async function getClient() {
    if (_client)
        return _client;
    _client = new MongoClient(config.mongodb.uri, { connectTimeoutMS: 10_000, serverSelectionTimeoutMS: 10_000 });
    await _client.connect();
    return _client;
}
function db(dbName) {
    return getClient().then(c => c.db(dbName ?? config.mongodb.defaultDb));
}
export const mongodbTools = [
    {
        name: 'mongo_list_databases',
        description: 'Lista todos os databases disponíveis no MongoDB com tamanho em MB.',
        inputSchema: { type: 'object', properties: {} },
    },
    {
        name: 'mongo_list_collections',
        description: 'Lista todas as collections de um database.',
        inputSchema: {
            type: 'object',
            properties: { database: { type: 'string', description: 'Nome do database (padrão: MONGODB_DEFAULT_DB)' } },
        },
    },
    {
        name: 'mongo_find',
        description: 'Busca documentos em uma collection com filtro, projeção e paginação.',
        inputSchema: {
            type: 'object',
            required: ['collection'],
            properties: {
                database: { type: 'string' },
                collection: { type: 'string' },
                filter: { type: 'object', description: 'Filtro MongoDB (ex: {"status": "active"})' },
                projection: { type: 'object', description: 'Campos a retornar' },
                sort: { type: 'object', description: 'Ordenação (ex: {"createdAt": -1})' },
                limit: { type: 'number', description: 'Máximo de documentos (padrão 20)' },
                skip: { type: 'number', description: 'Pular N documentos' },
            },
        },
    },
    {
        name: 'mongo_count',
        description: 'Conta documentos em uma collection com filtro opcional.',
        inputSchema: {
            type: 'object',
            required: ['collection'],
            properties: {
                database: { type: 'string' },
                collection: { type: 'string' },
                filter: { type: 'object' },
            },
        },
    },
    {
        name: 'mongo_insert',
        description: 'Insere um ou mais documentos em uma collection.',
        inputSchema: {
            type: 'object',
            required: ['collection', 'documents'],
            properties: {
                database: { type: 'string' },
                collection: { type: 'string' },
                documents: {
                    description: 'Documento único ou array de documentos',
                    oneOf: [{ type: 'object' }, { type: 'array' }],
                },
            },
        },
    },
    {
        name: 'mongo_update',
        description: 'Atualiza documentos em uma collection.',
        inputSchema: {
            type: 'object',
            required: ['collection', 'filter', 'update'],
            properties: {
                database: { type: 'string' },
                collection: { type: 'string' },
                filter: { type: 'object', description: 'Critério de seleção' },
                update: { type: 'object', description: 'Operação de update (ex: {"$set": {"status": "done"}})' },
                upsert: { type: 'boolean', description: 'Criar se não existir (padrão false)' },
                many: { type: 'boolean', description: 'Atualizar múltiplos documentos (padrão false)' },
            },
        },
    },
    {
        name: 'mongo_delete',
        description: 'Remove documentos de uma collection.',
        inputSchema: {
            type: 'object',
            required: ['collection', 'filter'],
            properties: {
                database: { type: 'string' },
                collection: { type: 'string' },
                filter: { type: 'object', description: 'Critério de seleção dos documentos a remover' },
                many: { type: 'boolean', description: 'Remover múltiplos documentos (padrão false)' },
            },
        },
    },
    {
        name: 'mongo_aggregate',
        description: 'Executa um pipeline de agregação MongoDB.',
        inputSchema: {
            type: 'object',
            required: ['collection', 'pipeline'],
            properties: {
                database: { type: 'string' },
                collection: { type: 'string' },
                pipeline: {
                    type: 'array',
                    description: 'Pipeline de agregação (ex: [{"$match": {}}, {"$group": {...}}])',
                },
            },
        },
    },
    {
        name: 'mongo_create_collection',
        description: 'Cria uma nova collection em um database.',
        inputSchema: {
            type: 'object',
            required: ['collection'],
            properties: {
                database: { type: 'string' },
                collection: { type: 'string' },
                validator: { type: 'object', description: 'Schema de validação JSON opcional' },
            },
        },
    },
    {
        name: 'mongo_drop_collection',
        description: 'Remove permanentemente uma collection e todos os seus documentos.',
        inputSchema: {
            type: 'object',
            required: ['collection'],
            properties: {
                database: { type: 'string' },
                collection: { type: 'string' },
            },
        },
    },
    {
        name: 'mongo_create_index',
        description: 'Cria um índice em uma collection.',
        inputSchema: {
            type: 'object',
            required: ['collection', 'keys'],
            properties: {
                database: { type: 'string' },
                collection: { type: 'string' },
                keys: { type: 'object', description: 'Campos e direção do índice (ex: {"email": 1})' },
                unique: { type: 'boolean', description: 'Índice único (padrão false)' },
                name: { type: 'string', description: 'Nome do índice' },
            },
        },
    },
];
async function safeExec(fn) {
    try {
        const result = await fn();
        return JSON.stringify(result, null, 2);
    }
    catch (err) {
        return `❌ Erro MongoDB: ${String(err)}`;
    }
}
export async function handleMongodbTool(name, args) {
    switch (name) {
        case 'mongo_list_databases': {
            return safeExec(async () => {
                const c = await getClient();
                const admin = c.db().admin();
                return admin.listDatabases();
            });
        }
        case 'mongo_list_collections': {
            return safeExec(async () => {
                const database = await db(args.database);
                return database.listCollections().toArray();
            });
        }
        case 'mongo_find': {
            return safeExec(async () => {
                const database = await db(args.database);
                const col = database.collection(args.collection);
                const filter = args.filter ?? {};
                let cursor = col.find(filter);
                if (args.projection)
                    cursor = cursor.project(args.projection);
                if (args.sort)
                    cursor = cursor.sort(args.sort);
                if (args.skip)
                    cursor = cursor.skip(args.skip);
                cursor = cursor.limit(args.limit ?? 20);
                return cursor.toArray();
            });
        }
        case 'mongo_count': {
            return safeExec(async () => {
                const database = await db(args.database);
                const col = database.collection(args.collection);
                const count = await col.countDocuments(args.filter ?? {});
                return { count };
            });
        }
        case 'mongo_insert': {
            return safeExec(async () => {
                const database = await db(args.database);
                const col = database.collection(args.collection);
                const docs = args.documents;
                if (Array.isArray(docs)) {
                    return col.insertMany(docs);
                }
                return col.insertOne(docs);
            });
        }
        case 'mongo_update': {
            return safeExec(async () => {
                const database = await db(args.database);
                const col = database.collection(args.collection);
                const filter = args.filter;
                const update = args.update;
                const options = { upsert: args.upsert ?? false };
                if (args.many)
                    return col.updateMany(filter, update, options);
                return col.updateOne(filter, update, options);
            });
        }
        case 'mongo_delete': {
            return safeExec(async () => {
                const database = await db(args.database);
                const col = database.collection(args.collection);
                const filter = args.filter;
                if (args.many)
                    return col.deleteMany(filter);
                return col.deleteOne(filter);
            });
        }
        case 'mongo_aggregate': {
            return safeExec(async () => {
                const database = await db(args.database);
                const col = database.collection(args.collection);
                return col.aggregate(args.pipeline).toArray();
            });
        }
        case 'mongo_create_collection': {
            return safeExec(async () => {
                const database = await db(args.database);
                const options = {};
                if (args.validator)
                    options.validator = args.validator;
                await database.createCollection(args.collection, options);
                return { created: args.collection };
            });
        }
        case 'mongo_drop_collection': {
            return safeExec(async () => {
                const database = await db(args.database);
                const result = await database.dropCollection(args.collection);
                return { dropped: result };
            });
        }
        case 'mongo_create_index': {
            return safeExec(async () => {
                const database = await db(args.database);
                const col = database.collection(args.collection);
                const indexName = await col.createIndex(args.keys, {
                    unique: args.unique ?? false,
                    name: args.name,
                });
                return { indexName };
            });
        }
        default:
            return `❌ Ferramenta desconhecida: ${name}`;
    }
}
export async function closeMongo() {
    if (_client) {
        await _client.close();
        _client = null;
    }
}

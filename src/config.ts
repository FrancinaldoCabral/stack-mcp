import 'dotenv/config';

export const config = {
  n8n: {
    url: process.env.N8N_URL ?? 'http://localhost:5678',
    apiKey: process.env.N8N_API_KEY ?? '',
  },
  evolution: {
    url: process.env.EVOLUTION_URL ?? 'http://localhost:8080',
    apiKey: process.env.EVOLUTION_API_KEY ?? '',
  },
  chatwoot: {
    url: process.env.CHATWOOT_URL ?? 'http://localhost:3000',
    apiKey: process.env.CHATWOOT_API_KEY ?? '',
    accountId: process.env.CHATWOOT_ACCOUNT_ID ?? '1',
  },
  mongodb: {
    uri: process.env.MONGODB_URI ?? 'mongodb://localhost:27017',
  },
  redis: {
    url: process.env.REDIS_URL ?? 'redis://localhost:6379',
  },
  qdrant: {
    url: process.env.QDRANT_URL ?? 'http://localhost:6333',
    apiKey: process.env.QDRANT_API_KEY ?? '',
  },
  coolify: {
    url: process.env.COOLIFY_URL ?? 'http://localhost:8000',
    token: process.env.COOLIFY_TOKEN ?? '',
  },
  openrouter: {
    apiKey: process.env.OPENROUTER_API_KEY ?? '',
    embeddingModel: process.env.OPENROUTER_EMBEDDING_MODEL ?? 'openai/text-embedding-3-small',
  },
  admin: {
    apiKey: process.env.ADMIN_API_KEY ?? 'vendly-admin-dev',
  },
};

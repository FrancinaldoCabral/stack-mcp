# ─────────────────────────────────────────────
# Stage 1: build
# ─────────────────────────────────────────────
FROM node:22-alpine AS builder

WORKDIR /app

# Instala dependências (aproveitando cache de layer)
COPY package*.json ./
RUN npm ci

# Copia fonte e compila
COPY tsconfig.json ./
COPY src/ ./src/
RUN npm run build

# ─────────────────────────────────────────────
# Stage 2: runtime (imagem final enxuta)
# ─────────────────────────────────────────────
FROM node:22-alpine AS runtime

# Usuário não-root por segurança
RUN addgroup -S mcp && adduser -S mcp -G mcp

WORKDIR /app

# Só as dependências de produção
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

# Copia apenas o build compilado
COPY --from=builder /app/dist ./dist

# Transfere ownership para usuário não-root
RUN chown -R mcp:mcp /app
USER mcp

# ── Variáveis de ambiente (sobrescreva no Coolify) ──
ENV NODE_ENV=production \
    N8N_URL="" \
    N8N_API_KEY="" \
    EVOLUTION_URL="" \
    EVOLUTION_API_KEY="" \
    CHATWOOT_URL="" \
    CHATWOOT_API_KEY="" \
    CHATWOOT_ACCOUNT_ID="1" \
    MONGODB_URI="" \
    MONGODB_DEFAULT_DB="admin" \
    REDIS_URL="" \
    QDRANT_URL="" \
    QDRANT_API_KEY="" \
    COOLIFY_URL="" \
    COOLIFY_TOKEN=""

# MCP usa stdio — não expõe porta HTTP
CMD ["node", "dist/index.js"]

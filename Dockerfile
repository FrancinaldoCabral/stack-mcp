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

# ── Variáveis de ambiente (injete no Coolify em runtime) ──
ENV NODE_ENV=production \
    PORT=3000

EXPOSE 3000

# MCP usa HTTP/SSE na porta 3000
CMD ["node", "dist/index.js"]

# 🚀 Stack MCP Server

MCP server completo para gerenciar toda a sua stack no VPS Contabo via Coolify.

## Serviços suportados

| Serviço | Ferramentas | Descrição |
|---|---|---|
| **n8n** | 9 | Workflows, execuções, credenciais |
| **Evolution API** | 10 | Instâncias WhatsApp, mensagens, webhooks |
| **Chatwoot** | 10 | Conversas, contatos, agentes, inboxes, relatórios |
| **MongoDB** | 11 | Databases, collections, CRUD, índices, agregações |
| **Redis** | 11 | Chaves, hashes, listas, TTL, info do servidor |
| **Qdrant** | 9 | Collections, vetores, similarity search, índices |
| **Coolify** | 16 | Projetos, serviços, deploys, env vars, logs |

**Total: 76 ferramentas MCP**

---

## Instalação

### 1. Clone e instale dependências

```bash
cd stack-mcp
npm install
npm run build
```

### 2. Configure variáveis de ambiente

Copie `.env.example` para `.env` e preencha com suas credenciais:

```bash
cp .env.example .env
nano .env
```

### 3. Configure no Claude Desktop (claude_desktop_config.json)

**macOS:** `~/Library/Application Support/Claude/claude_desktop_config.json`  
**Windows:** `%APPDATA%\Claude\claude_desktop_config.json`  
**Linux:** `~/.config/Claude/claude_desktop_config.json`

```json
{
  "mcpServers": {
    "stack-mcp": {
      "command": "node",
      "args": ["/caminho/para/stack-mcp/dist/index.js"],
      "env": {
        "N8N_URL": "https://n8n.seudominio.com",
        "N8N_API_KEY": "sua_chave",
        "EVOLUTION_URL": "https://evolution.seudominio.com",
        "EVOLUTION_API_KEY": "sua_chave",
        "CHATWOOT_URL": "https://chatwoot.seudominio.com",
        "CHATWOOT_API_KEY": "sua_chave",
        "CHATWOOT_ACCOUNT_ID": "1",
        "MONGODB_URI": "mongodb://user:pass@host:27017",
        "MONGODB_DEFAULT_DB": "meudb",
        "REDIS_URL": "redis://:password@host:6379",
        "QDRANT_URL": "https://qdrant.seudominio.com",
        "QDRANT_API_KEY": "sua_chave",
        "COOLIFY_URL": "https://coolify.seudominio.com",
        "COOLIFY_TOKEN": "seu_token"
      }
    }
  }
}
```

> **Dica:** Prefira colocar as credenciais no `env` do `claude_desktop_config.json`  
> (não precisa do arquivo `.env` em produção, fica mais seguro).

---

## Onde achar as credenciais

### n8n
- **URL:** endereço onde o n8n está rodando
- **API Key:** n8n → Settings → API → Create API Key

### Evolution API
- **URL:** endereço da sua instância Evolution
- **API Key:** definida no `AUTHENTICATION_API_KEY` da Evolution

### Chatwoot
- **URL:** endereço do seu Chatwoot
- **API Key:** Chatwoot → Profile Settings → Access Token
- **Account ID:** visível na URL após login (ex: `/app/accounts/1`)

### MongoDB
- **URI:** `mongodb://usuario:senha@host:porta/` (checar no Coolify → Database → Connection String)

### Redis
- **URL:** `redis://:senha@host:6379` (checar no Coolify → Database → Connection String)

### Qdrant
- **URL:** endereço do painel Qdrant
- **API Key:** configurada no `QDRANT__SERVICE__API_KEY` ou deixar vazio se sem auth

### Coolify
- **URL:** endereço do seu painel Coolify
- **Token:** Coolify → Keys & Tokens → API Tokens → Add

---

## Exemplos de uso com Claude

### n8n
- *"Liste todos os workflows ativos"*
- *"Crie um workflow chamado 'Alerta Diário' com trigger de cron às 9h"*
- *"Mostre as últimas 10 execuções com erro"*
- *"Desative o workflow ID abc123"*

### Evolution API
- *"Quais instâncias WhatsApp estão conectadas?"*
- *"Crie uma instância chamada 'suporte' integrada ao Chatwoot"*
- *"Envie 'Olá!' para 5511999999999 pela instância 'vendas'"*
- *"Configure o webhook da instância 'suporte' para https://n8n.seudominio.com/webhook/whatsapp"*

### Chatwoot
- *"Liste as conversas abertas da inbox 3"*
- *"Envie uma nota privada na conversa 42"*
- *"Crie um contato com o número +5511988887777"*
- *"Quantas conversas abertas temos agora?"*

### MongoDB
- *"Liste os databases disponíveis"*
- *"Busque os últimos 10 documentos da collection 'messages' ordenados por createdAt"*
- *"Crie um índice único no campo 'email' da collection 'users'"*
- *"Aggregue as mensagens por dia na última semana"*

### Redis
- *"Liste todas as chaves com prefixo 'session:'"*
- *"Qual o TTL da chave 'cache:users:123'?"*
- *"Mostre as informações de memória do Redis"*

### Qdrant
- *"Liste as collections existentes"*
- *"Crie uma collection 'knowledge_base' com 1536 dimensões e distância Cosine"*
- *"Busque os 5 vetores mais similares na collection 'docs'"*

### Coolify
- *"Liste todos os serviços em execução"*
- *"Faça deploy da aplicação com UUID abc-123"*
- *"Mostre os logs do último deployment do serviço 'n8n'"*
- *"Atualize a variável DATABASE_URL no serviço 'api'"*
- *"Qual o uso de CPU e memória do servidor?"*

---

## Desenvolvimento

```bash
# Rodar em modo dev com hot reload
npm run dev

# Build de produção
npm run build

# Executar build
npm start
```

## Estrutura do projeto

```
stack-mcp/
├── src/
│   ├── index.ts          # Servidor MCP principal
│   ├── config.ts         # Configuração via env vars
│   ├── utils/
│   │   └── http.ts       # Utilitário Axios
│   └── tools/
│       ├── n8n.ts        # Ferramentas n8n
│       ├── evolution.ts  # Ferramentas Evolution API
│       ├── chatwoot.ts   # Ferramentas Chatwoot
│       ├── mongodb.ts    # Ferramentas MongoDB
│       ├── redis.ts      # Ferramentas Redis
│       ├── qdrant.ts     # Ferramentas Qdrant
│       └── coolify.ts    # Ferramentas Coolify
├── .env.example
├── package.json
└── tsconfig.json
```

import 'dotenv/config';
import { createServer } from 'node:http';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type CallToolResult,
} from '@modelcontextprotocol/sdk/types.js';

import { n8nTools, handleN8nTool } from './tools/n8n.js';
import { evolutionTools, handleEvolutionTool } from './tools/evolution.js';
import { chatwootTools, handleChatwootTool } from './tools/chatwoot.js';
import { mongodbTools, handleMongodbTool, closeMongo } from './tools/mongodb.js';
import { redisTools, handleRedisTool, closeRedis } from './tools/redis.js';
import { qdrantTools, handleQdrantTool } from './tools/qdrant.js';
import { coolifyTools, handleCoolifyTool } from './tools/coolify.js';

// ── Registro global de ferramentas ─────────────────────────────────────────
const ALL_TOOLS = [
  ...n8nTools,
  ...evolutionTools,
  ...chatwootTools,
  ...mongodbTools,
  ...redisTools,
  ...qdrantTools,
  ...coolifyTools,
];

// ── Router central ─────────────────────────────────────────────────────────
async function routeTool(
  name: string,
  args: Record<string, unknown>
): Promise<string> {
  if (name.startsWith('n8n_'))        return handleN8nTool(name, args);
  if (name.startsWith('evolution_'))  return handleEvolutionTool(name, args);
  if (name.startsWith('chatwoot_'))   return handleChatwootTool(name, args);
  if (name.startsWith('mongo_'))      return handleMongodbTool(name, args);
  if (name.startsWith('redis_'))      return handleRedisTool(name, args);
  if (name.startsWith('qdrant_'))     return handleQdrantTool(name, args);
  if (name.startsWith('coolify_'))    return handleCoolifyTool(name, args);
  return `❌ Ferramenta não encontrada: ${name}`;
}

// ── Servidor MCP ────────────────────────────────────────────────────────────
const server = new Server(
  {
    name: 'stack-mcp',
    version: '1.0.0',
  },
  {
    capabilities: { tools: {} },
  }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: ALL_TOOLS,
}));

server.setRequestHandler(CallToolRequestSchema, async (request): Promise<{ content: CallToolResult['content'] }> => {
  const { name, arguments: args = {} } = request.params;
  try {
    const text = await routeTool(name, args as Record<string, unknown>);
    return {
      content: [{ type: 'text', text }],
    };
  } catch (err) {
    return {
      content: [{ type: 'text', text: `❌ Erro inesperado: ${String(err)}` }],
    };
  }
});

// ── Bootstrap ───────────────────────────────────────────────────────────────
async function main() {
  const port = process.env.PORT ? parseInt(process.env.PORT, 10) : undefined;

  process.on('SIGINT', async () => { await closeMongo(); await closeRedis(); process.exit(0); });
  process.on('SIGTERM', async () => { await closeMongo(); await closeRedis(); process.exit(0); });

  if (port) {
    // ── Modo HTTP (Streamable HTTP transport) ──────────────────────────────
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    await server.connect(transport);

    const httpServer = createServer(async (req, res) => {
      if (req.url === '/mcp' || req.url?.startsWith('/mcp?')) {
        try {
          await transport.handleRequest(req, res);
        } catch (err) {
          process.stderr.write(`❌ MCP request error: ${String(err)}\n`);
          if (!res.headersSent) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: String(err) }));
          }
        }
      } else if (req.url === '/health') {
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end('OK');
      } else {
        res.writeHead(404);
        res.end('Not found');
      }
    });

    httpServer.listen(port, () => {
      process.stderr.write(`✅ Stack MCP HTTP — porta ${port} — ${ALL_TOOLS.length} ferramentas\n`);
      process.stderr.write(
        `   n8n(${n8nTools.length}) | evolution(${evolutionTools.length}) | chatwoot(${chatwootTools.length}) | mongo(${mongodbTools.length}) | redis(${redisTools.length}) | qdrant(${qdrantTools.length}) | coolify(${coolifyTools.length})\n`
      );
    });
  } else {
    // ── Modo stdio (padrão) ────────────────────────────────────────────────
    const transport = new StdioServerTransport();
    await server.connect(transport);
    process.stderr.write(`✅ Stack MCP stdio — ${ALL_TOOLS.length} ferramentas disponíveis\n`);
    process.stderr.write(
      `   n8n(${n8nTools.length}) | evolution(${evolutionTools.length}) | chatwoot(${chatwootTools.length}) | mongo(${mongodbTools.length}) | redis(${redisTools.length}) | qdrant(${qdrantTools.length}) | coolify(${coolifyTools.length})\n`
    );
  }
}

main().catch(err => {
  process.stderr.write(`❌ Falha ao iniciar MCP: ${String(err)}\n`);
  process.exit(1);
});

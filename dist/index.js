import 'dotenv/config';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema, } from '@modelcontextprotocol/sdk/types.js';
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
async function routeTool(name, args) {
    if (name.startsWith('n8n_'))
        return handleN8nTool(name, args);
    if (name.startsWith('evolution_'))
        return handleEvolutionTool(name, args);
    if (name.startsWith('chatwoot_'))
        return handleChatwootTool(name, args);
    if (name.startsWith('mongo_'))
        return handleMongodbTool(name, args);
    if (name.startsWith('redis_'))
        return handleRedisTool(name, args);
    if (name.startsWith('qdrant_'))
        return handleQdrantTool(name, args);
    if (name.startsWith('coolify_'))
        return handleCoolifyTool(name, args);
    return `❌ Ferramenta não encontrada: ${name}`;
}
// ── Servidor MCP ────────────────────────────────────────────────────────────
const server = new Server({
    name: 'stack-mcp',
    version: '1.0.0',
}, {
    capabilities: { tools: {} },
});
server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: ALL_TOOLS,
}));
server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args = {} } = request.params;
    try {
        const text = await routeTool(name, args);
        return {
            content: [{ type: 'text', text }],
        };
    }
    catch (err) {
        return {
            content: [{ type: 'text', text: `❌ Erro inesperado: ${String(err)}` }],
        };
    }
});
// ── Bootstrap ───────────────────────────────────────────────────────────────
async function main() {
    const transport = new StdioServerTransport();
    process.on('SIGINT', async () => {
        await closeMongo();
        await closeRedis();
        process.exit(0);
    });
    process.on('SIGTERM', async () => {
        await closeMongo();
        await closeRedis();
        process.exit(0);
    });
    await server.connect(transport);
    // Log para stderr para não poluir o protocolo MCP no stdout
    process.stderr.write(`✅ Stack MCP iniciado — ${ALL_TOOLS.length} ferramentas disponíveis\n`);
    process.stderr.write(`   n8n(${n8nTools.length}) | evolution(${evolutionTools.length}) | chatwoot(${chatwootTools.length}) | mongo(${mongodbTools.length}) | redis(${redisTools.length}) | qdrant(${qdrantTools.length}) | coolify(${coolifyTools.length})\n`);
}
main().catch(err => {
    process.stderr.write(`❌ Falha ao iniciar MCP: ${String(err)}\n`);
    process.exit(1);
});

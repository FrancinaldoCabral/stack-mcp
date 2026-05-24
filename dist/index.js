import 'dotenv/config';
import { createServer } from 'node:http';
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { CallToolRequestSchema, ListToolsRequestSchema, } from '@modelcontextprotocol/sdk/types.js';
import { n8nTools, handleN8nTool } from './tools/n8n.js';
import { evolutionTools, handleEvolutionTool } from './tools/evolution.js';
import { chatwootTools, handleChatwootTool } from './tools/chatwoot.js';
import { mongodbTools, handleMongodbTool, closeMongo } from './tools/mongodb.js';
import { redisTools, handleRedisTool, closeRedis } from './tools/redis.js';
import { qdrantTools, handleQdrantTool } from './tools/qdrant.js';
import { coolifyTools, handleCoolifyTool } from './tools/coolify.js';
import { intelligenceTools, handleIntelligenceTool } from './tools/intelligence.js';
import { apiRouter } from './web/router.js';
import { connectRouter } from './web/routes/connect.js';
// ── Registro global de ferramentas ─────────────────────────────────────────
const ALL_TOOLS = [
    ...n8nTools,
    ...evolutionTools,
    ...chatwootTools,
    ...mongodbTools,
    ...redisTools,
    ...qdrantTools,
    ...coolifyTools,
    ...intelligenceTools,
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
    if (name.startsWith('intelligence_') || name.startsWith('customer_') || name.startsWith('business_'))
        return handleIntelligenceTool(name, args);
    return `❌ Ferramenta não encontrada: ${name}`;
}
// ── Factory: cria um Server MCP com todos os handlers ───────────────────────
function makeMcpServer() {
    const srv = new Server({ name: 'stack-mcp', version: '1.0.0' }, { capabilities: { tools: {} } });
    srv.setRequestHandler(ListToolsRequestSchema, async () => ({
        tools: ALL_TOOLS,
    }));
    srv.setRequestHandler(CallToolRequestSchema, async (request) => {
        const { name, arguments: args = {} } = request.params;
        try {
            const text = await routeTool(name, args);
            return { content: [{ type: 'text', text }] };
        }
        catch (err) {
            return { content: [{ type: 'text', text: `❌ Erro inesperado: ${String(err)}` }] };
        }
    });
    return srv;
}
// ── Lê o body de um IncomingMessage ─────────────────────────────────────────
function readBody(req) {
    return new Promise((resolve, reject) => {
        let data = '';
        req.on('data', (chunk) => { data += chunk.toString(); });
        req.on('end', () => resolve(data));
        req.on('error', reject);
    });
}
// ── Bootstrap ───────────────────────────────────────────────────────────────
async function main() {
    const port = process.env.PORT ? parseInt(process.env.PORT, 10) : undefined;
    process.on('SIGINT', async () => { await closeMongo(); await closeRedis(); process.exit(0); });
    process.on('SIGTERM', async () => { await closeMongo(); await closeRedis(); process.exit(0); });
    if (port) {
        // ── Modo HTTP: nova instância de server+transport por request (stateless) ─
        // ── Express app for dashboard + REST API ─────────────────────────────
        const __dirname = path.dirname(fileURLToPath(import.meta.url));
        const publicDir = path.resolve(__dirname, '..', 'public');
        const webApp = express();
        webApp.use(express.json({ limit: '2mb' }));
        webApp.use('/api', apiRouter);
        webApp.use('/connect', connectRouter); // public QR connect page (no auth)
        webApp.use(express.static(publicDir));
        // ── Utilitário: baixa arquivo e retorna base64 (para N8N que não consegue binary em Code node) ─
        webApp.get('/util/audio-base64', async (req, res) => {
            const url = req.query.url;
            if (!url) {
                res.status(400).json({ error: 'url required' });
                return;
            }
            // Segurança: só permite URLs do Chatwoot
            try {
                const parsed = new URL(url);
                const allowed = new URL(process.env.CHATWOOT_URL ?? 'https://chatwoot.vendly.chat').hostname;
                if (parsed.hostname !== allowed) {
                    res.status(403).json({ error: 'URL não permitida' });
                    return;
                }
            }
            catch {
                res.status(400).json({ error: 'URL inválida' });
                return;
            }
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), 15_000);
            try {
                const r = await fetch(url, { signal: controller.signal });
                if (!r.ok) {
                    res.status(502).json({ error: `upstream ${r.status}` });
                    return;
                }
                const buf = Buffer.from(await r.arrayBuffer());
                res.json({ base64: buf.toString('base64'), size: buf.length });
            }
            catch (err) {
                res.status(500).json({ error: String(err) });
            }
            finally {
                clearTimeout(timer);
            }
        });
        // ── Utilitário: chama OpenRouter TTS e retorna base64 (N8N não consegue binary em Code node) ─
        webApp.post('/util/tts', async (req, res) => {
            const { text, voice = 'alloy', model = 'openai/gpt-4o-mini-tts-2025-12-15' } = req.body ?? {};
            if (!text) {
                res.status(400).json({ error: 'text required' });
                return;
            }
            // Aceita chave via Authorization header (N8N injeta via credencial) ou env var
            const authHeader = req.headers.authorization;
            const apiKey = (authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null)
                ?? process.env.OPENROUTER_API_KEY;
            if (!apiKey) {
                res.status(500).json({ error: 'no OpenRouter API key available' });
                return;
            }
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), 30_000);
            try {
                const r = await fetch('https://openrouter.ai/api/v1/audio/speech', {
                    method: 'POST',
                    signal: controller.signal,
                    headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
                    body: JSON.stringify({ model, input: text, voice, response_format: 'mp3' }),
                });
                if (!r.ok) {
                    const errBody = await r.text();
                    res.status(502).json({ error: `OpenRouter TTS ${r.status}`, detail: errBody });
                    return;
                }
                const buf = Buffer.from(await r.arrayBuffer());
                res.json({ base64: buf.toString('base64'), size: buf.length });
            }
            catch (err) {
                res.status(500).json({ error: String(err) });
            }
            finally {
                clearTimeout(timer);
            }
        });
        // SPA fallback — serve index.html for all non-API routes
        webApp.get(/^\/(?!api|mcp|health|util).*/, (_req, webRes) => {
            webRes.sendFile(path.join(publicDir, 'index.html'));
        });
        const httpServer = createServer(async (req, res) => {
            if (req.url === '/mcp' || req.url?.startsWith('/mcp?')) {
                const srv = makeMcpServer();
                const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
                try {
                    await srv.connect(transport);
                    const raw = await readBody(req);
                    const parsedBody = raw ? JSON.parse(raw) : undefined;
                    await transport.handleRequest(req, res, parsedBody);
                    res.on('close', () => { transport.close(); srv.close(); });
                }
                catch (err) {
                    process.stderr.write(`❌ MCP request error: ${String(err)}\n`);
                    if (!res.headersSent) {
                        res.writeHead(500, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ error: String(err) }));
                    }
                }
            }
            else if (req.url === '/health') {
                res.writeHead(200, { 'Content-Type': 'text/plain' });
                res.end('OK');
            }
            else {
                // Delegate to Express (dashboard + API)
                webApp(req, res);
            }
        });
        httpServer.listen(port, () => {
            process.stderr.write(`✅ Stack MCP HTTP — porta ${port} — ${ALL_TOOLS.length} ferramentas\n`);
            process.stderr.write(`   n8n(${n8nTools.length}) | evolution(${evolutionTools.length}) | chatwoot(${chatwootTools.length}) | mongo(${mongodbTools.length}) | redis(${redisTools.length}) | qdrant(${qdrantTools.length}) | coolify(${coolifyTools.length})\n`);
        });
    }
    else {
        // ── Modo stdio (padrão) ────────────────────────────────────────────────
        const transport = new StdioServerTransport();
        const srv = makeMcpServer();
        await srv.connect(transport);
        process.stderr.write(`✅ Stack MCP stdio — ${ALL_TOOLS.length} ferramentas disponíveis\n`);
        process.stderr.write(`   n8n(${n8nTools.length}) | evolution(${evolutionTools.length}) | chatwoot(${chatwootTools.length}) | mongo(${mongodbTools.length}) | redis(${redisTools.length}) | qdrant(${qdrantTools.length}) | coolify(${coolifyTools.length})\n`);
    }
}
main().catch(err => {
    process.stderr.write(`❌ Falha ao iniciar MCP: ${String(err)}\n`);
    process.exit(1);
});

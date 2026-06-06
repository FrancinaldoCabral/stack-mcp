import 'dotenv/config';
import { createServer } from 'node:http';
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
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
import { intelligenceTools, handleIntelligenceTool } from './tools/intelligence.js';
import { systemTools, handleSystemTool } from './tools/system.js';
import { deliveryTools, handleDeliveryTool } from './tools/delivery.js';
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
  ...systemTools,
  ...deliveryTools,
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
  if (name.startsWith('intelligence_') || name.startsWith('customer_') || name.startsWith('business_')) return handleIntelligenceTool(name, args);
  if (name.startsWith('system_')) return handleSystemTool(name, args);
  if (name.startsWith('delivery_')) return handleDeliveryTool(name, args);
  return `❌ Ferramenta não encontrada: ${name}`;
}

// ── Factory: cria um Server MCP com todos os handlers ───────────────────────
function makeMcpServer(): Server {
  const srv = new Server(
    { name: 'stack-mcp', version: '1.0.0' },
    { capabilities: { tools: {} } }
  );

  srv.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: ALL_TOOLS,
  }));

  srv.setRequestHandler(CallToolRequestSchema, async (request): Promise<{ content: CallToolResult['content'] }> => {
    const { name, arguments: args = {} } = request.params;
    try {
      const text = await routeTool(name, args as Record<string, unknown>);
      return { content: [{ type: 'text', text }] };
    } catch (err) {
      return { content: [{ type: 'text', text: `❌ Erro inesperado: ${String(err)}` }] };
    }
  });

  return srv;
}

// ── Lê o body de um IncomingMessage ─────────────────────────────────────────
function readBody(req: import('node:http').IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk: Buffer) => { data += chunk.toString(); });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

// ── PCM → WAV helper (Gemini TTS retorna PCM bruto) ────────────────────────
function pcmToWav(pcmBytes: Uint8Array, sampleRate = 24000, channels = 1, bitsPerSample = 16): Buffer {
  const dataSize = pcmBytes.length;
  const wav = Buffer.alloc(44 + dataSize);
  wav.write('RIFF', 0);
  wav.writeUInt32LE(36 + dataSize, 4);
  wav.write('WAVE', 8);
  wav.write('fmt ', 12);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(channels, 22);
  wav.writeUInt32LE(sampleRate, 24);
  wav.writeUInt32LE(sampleRate * channels * bitsPerSample / 8, 28);
  wav.writeUInt16LE(channels * bitsPerSample / 8, 32);
  wav.writeUInt16LE(bitsPerSample, 34);
  wav.write('data', 36);
  wav.writeUInt32LE(dataSize, 40);
  Buffer.from(pcmBytes).copy(wav, 44);
  return wav;
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
      const url = req.query.url as string;
      if (!url) { res.status(400).json({ error: 'url required' }); return; }
      // Segurança: permite URLs HTTPS de hosts conhecidos (Chatwoot + whitelist env)
      try {
        const parsed = new URL(url);
        if (parsed.protocol !== 'https:') { res.status(403).json({ error: 'Apenas HTTPS permitido' }); return; }
        // Bloquear IPs internos (SSRF protection)
        const host = parsed.hostname;
        if (/^(10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.|127\.|localhost|::1)/.test(host)) {
          res.status(403).json({ error: 'URL não permitida' }); return;
        }
      } catch { res.status(400).json({ error: 'URL inválida' }); return; }
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 15_000);
      try {
        const r = await fetch(url, { signal: controller.signal });
        if (!r.ok) { res.status(502).json({ error: `upstream ${r.status}` }); return; }
        const buf = Buffer.from(await r.arrayBuffer());
        let mimeType = r.headers.get('content-type')?.split(';')[0]?.trim() ?? 'audio/ogg';
        // Normalize application/ogg → audio/ogg (Gemini requires audio/ prefix)
        if (mimeType === 'application/ogg') mimeType = 'audio/ogg';
        res.json({ base64: buf.toString('base64'), size: buf.length, mimeType });
      } catch (err) {
        res.status(500).json({ error: String(err) });
      } finally {
        clearTimeout(timer);
      }
    });

    // ── Utilitário: chama OpenRouter TTS e retorna base64 (N8N não consegue binary em Code node) ─
    webApp.post('/util/tts', async (req, res) => {
      const DEFAULT_MODEL = process.env.MODEL_TTS || 'google/gemini-3.1-flash-tts-preview';
      const isGemini = (m: string) => m.toLowerCase().includes('gemini');
      const DEFAULT_VOICE = isGemini(DEFAULT_MODEL)
        ? (process.env.VOICE_TTS || 'Kore')
        : (process.env.VOICE_TTS || 'alloy');
      const { text, model = DEFAULT_MODEL } = req.body ?? {};
      const voice: string = (req.body as Record<string, unknown>)?.voice as string
        ?? (isGemini(model) ? 'Kore' : 'alloy');
      if (!text) { res.status(400).json({ error: 'text required' }); return; }
      // Aceita chave via Authorization header (N8N injeta via credencial) ou env var
      const authHeader = req.headers.authorization;
      const apiKey = (authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null)
        ?? process.env.OPENROUTER_API_KEY;
      if (!apiKey) { res.status(500).json({ error: 'no OpenRouter API key available' }); return; }
      // Gemini TTS só suporta PCM — precisamos empacotar em WAV antes de retornar
      const responseFormat = isGemini(model) ? 'pcm' : 'mp3';
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 30_000);
      try {
        const r = await fetch('https://openrouter.ai/api/v1/audio/speech', {
          method: 'POST',
          signal: controller.signal,
          headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ model, input: text, voice, response_format: responseFormat }),
        });
        if (!r.ok) {
          const errBody = await r.text();
          res.status(502).json({ error: `OpenRouter TTS ${r.status}`, detail: errBody });
          return;
        }
        const rawBuf = new Uint8Array(await r.arrayBuffer());
        // PCM → WAV (Gemini: 24000 Hz, 16-bit, mono)
        const buf = responseFormat === 'pcm' ? pcmToWav(rawBuf, 24000, 1, 16) : Buffer.from(rawBuf);
        res.json({ base64: buf.toString('base64'), size: buf.length });
      } catch (err) {
        res.status(500).json({ error: String(err) });
      } finally {
        clearTimeout(timer);
      }
    });

    // ── Utilitário: transcreve áudio via OpenRouter multimodal ──────────────────────────────────
    webApp.post('/util/transcribe', async (req, res) => {
      const { url, base64: inBase64, mimeType: inMimeType = 'audio/ogg' } = req.body ?? {};
      if (!url && !inBase64) { res.status(400).json({ error: 'url or base64 required' }); return; }
      const authHeader = req.headers.authorization;
      const apiKey = (authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null)
        ?? process.env.OPENROUTER_API_KEY;
      if (!apiKey) { res.status(500).json({ error: 'no OpenRouter API key' }); return; }

      let audioBase64: string | undefined = inBase64 as string | undefined;
      let mimeType: string = inMimeType as string;

      if (!audioBase64 && url) {
        let parsedUrl: URL;
        try {
          parsedUrl = new URL(url as string);
          const allowedHosts = [
            new URL(process.env.CHATWOOT_URL ?? 'https://chatwoot.vendly.chat').hostname,
            new URL(process.env.EVOLUTION_URL ?? 'https://evolution.vendly.chat').hostname,
          ];
          if (!allowedHosts.includes(parsedUrl.hostname)) {
            res.status(403).json({ error: 'URL não permitida' }); return;
          }
        } catch { res.status(400).json({ error: 'URL inválida' }); return; }

        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), 15_000);
        try {
          const fetchHeaders: Record<string, string> = {};
          const chatwootHostname = new URL(process.env.CHATWOOT_URL ?? 'https://chatwoot.vendly.chat').hostname;
          if (parsedUrl.hostname === chatwootHostname && process.env.CHATWOOT_API_KEY) {
            fetchHeaders['api_access_token'] = process.env.CHATWOOT_API_KEY;
          }
          const r = await fetch(url as string, { signal: ctrl.signal, headers: fetchHeaders });
          if (!r.ok) { res.status(502).json({ error: `download ${r.status}` }); return; }
          const buf = Buffer.from(await r.arrayBuffer());
          audioBase64 = buf.toString('base64');
          const ct = r.headers.get('content-type');
          if (ct && ct.startsWith('audio/')) mimeType = ct.split(';')[0].trim();
        } catch (err) {
          res.status(500).json({ error: `download: ${String(err)}` }); return;
        } finally { clearTimeout(t); }
      }

      const model = process.env.OPENROUTER_MULTIMODAL_MODEL ?? 'google/gemini-2.0-flash-lite-001';
      const ctrl2 = new AbortController();
      const t2 = setTimeout(() => ctrl2.abort(), 30_000);
      try {
        const r2 = await fetch('https://openrouter.ai/api/v1/chat/completions', {
          method: 'POST',
          signal: ctrl2.signal,
          headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model,
            messages: [{
              role: 'user',
              content: [
                { type: 'text', text: 'Transcreva este áudio para texto em português. Retorne SOMENTE o texto transcrito, sem comentários adicionais.' },
                { type: 'image_url', image_url: { url: `data:${mimeType};base64,${audioBase64}` } },
              ],
            }],
          }),
        });
        if (!r2.ok) {
          const errBody = await r2.text();
          res.status(502).json({ error: `OpenRouter ${r2.status}`, detail: errBody }); return;
        }
        const data = await r2.json() as { choices?: Array<{ message?: { content?: string } }> };
        const transcription = data.choices?.[0]?.message?.content ?? '';
        res.json({ transcription, model });
      } catch (err) {
        res.status(500).json({ error: String(err) });
      } finally { clearTimeout(t2); }
    });

    // Agentic loop — executa LLM + tool calls em loop até resposta final (sem limite de rounds).
    // Substitui a cadeia manual de rounds hardcoded no n8n.
    // Recebe { openRouterBody, businessId, instance } do n8n via HTTP Request node.
    // Retorna { choices: [{ message: { content }, finish_reason: 'stop' }] } — compatível com Parsear Chunks.
    webApp.post('/agent-loop', async (req, res) => {
      const MAX_ITER = 10;
      const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
      const authHeader = req.headers.authorization;
      const apiKey = (authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null)
        ?? process.env.OPENROUTER_API_KEY ?? '';
      const qdrantUrl = process.env.QDRANT_URL ?? 'http://localhost:6333';
      const qdrantKey = process.env.QDRANT_API_KEY ?? '';
      const embModel = process.env.OPENROUTER_EMBEDDING_MODEL ?? 'openai/text-embedding-3-small';

      const payload = req.body as { openRouterBody?: unknown; businessId?: string; instance?: string };
      let currentBody = payload.openRouterBody as Record<string, unknown> | undefined;
      if (!currentBody || typeof currentBody !== 'object') {
        res.status(400).json({ error: 'openRouterBody required' }); return;
      }
      const businessId = String(payload.businessId ?? payload.instance ?? '');
      const instance = String(payload.instance ?? '');

      const FALLBACK_MODEL = process.env.OPENROUTER_FALLBACK_MODEL ?? 'google/gemini-2.5-flash';
      let modelInUse = String((currentBody as Record<string,unknown>).model ?? 'unknown');
      const originalBody = { ...currentBody };
      let finalContent: string | null = null;
      let toolCallsMade = false;
      const ctxLog: string[] = [];

      for (let iter = 0; iter < MAX_ITER; iter++) {
        const msgs = Array.isArray(currentBody.messages) ? currentBody.messages as unknown[] : [];
        const ctxChars = JSON.stringify(msgs).length;
        ctxLog.push(`round${iter}:${ctxChars}chars`);

        // Chamar LLM
        let llmData: Record<string, unknown>;
        let httpStatus = 0;
        try {
          const ctrl = new AbortController();
          const t = setTimeout(() => ctrl.abort(), 60_000);
          try {
            const r = await fetch(OPENROUTER_URL, {
              method: 'POST',
              headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
              body: JSON.stringify(currentBody),
              signal: ctrl.signal,
            });
            httpStatus = r.status;
            llmData = await r.json() as Record<string, unknown>;
          } finally { clearTimeout(t); }
        } catch (e) {
          console.error(`[agent-loop] model=${modelInUse} iter=${iter} ctx=${ctxLog.join(',')} FETCH_ERROR:`, String(e));
          finalContent = 'Desculpe, erro ao conectar com o assistente. Tente novamente.';
          break;
        }

        type LLMChoice = {
          finish_reason?: string; native_finish_reason?: string;
          message?: { content?: string; tool_calls?: Array<{ id: string; function?: { name: string; arguments: string } }> };
        };
        // Erro direto do provider — tentar fallback model antes de desistir
        if (llmData.error || !llmData.choices) {
          const errPayload = JSON.stringify(llmData).slice(0, 500);
          console.error(`[agent-loop] PROVIDER_ERROR model=${modelInUse} iter=${iter} http=${httpStatus} ctx=${ctxLog.join(',')} payload=${errPayload}`);

          if (modelInUse !== FALLBACK_MODEL) {
            console.error(`[agent-loop] Switching to fallback model ${FALLBACK_MODEL}`);
            modelInUse = FALLBACK_MODEL;
            currentBody = { ...originalBody, model: FALLBACK_MODEL };
            iter = -1;
            ctxLog.length = 0;
            toolCallsMade = false;
            continue;
          }

          finalContent = 'Desculpe, não consegui processar essa mensagem agora. Pode tentar novamente?';
          break;
        }

        const choice = (llmData.choices as LLMChoice[] | undefined)?.[0];
        const finish = choice?.finish_reason ?? '';
        const native = choice?.native_finish_reason ?? '';

        if (finish === 'error' || native.includes('MALFORMED')) {
          finalContent = 'Desculpe, não consegui processar essa mensagem. Pode tentar novamente?';
          break;
        }

        const toolCalls = choice?.message?.tool_calls ?? [];

        // Sem tool calls → resposta final
        if (toolCalls.length === 0) {
          finalContent = choice?.message?.content ?? 'Desculpe, erro interno.';
          break;
        }

        // Executar tool calls e acumular resultados
        toolCallsMade = true;
        const assistantMsg = choice!.message!;
        const toolResults: Array<{ role: string; tool_call_id: string; content: string }> = [];
        const toolNames = toolCalls.map(tc => tc.function?.name ?? '?').join(',');
        console.log(`[agent-loop] model=${modelInUse} iter=${iter} ctx=${ctxChars}chars tools=[${toolNames}]`);

        for (const tc of toolCalls) {
          const toolName = tc.function?.name ?? '';
          let args: Record<string, unknown> = {};
          try { args = JSON.parse(tc.function?.arguments ?? '{}'); } catch { /**/ }
          let content = '';

          if (toolName === 'buscar_memoria') {
            try {
              const query = String(args.query ?? '');
              const embCtrl = new AbortController();
              const et = setTimeout(() => embCtrl.abort(), 15_000);
              let embedding: number[] = [];
              try {
                const er = await fetch('https://openrouter.ai/api/v1/embeddings', {
                  method: 'POST',
                  headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
                  body: JSON.stringify({ model: embModel, input: query }),
                  signal: embCtrl.signal,
                });
                const ed = await er.json() as { data?: Array<{ embedding: number[] }> };
                embedding = ed.data?.[0]?.embedding ?? [];
              } finally { clearTimeout(et); }

              const qCtrl = new AbortController();
              const qt = setTimeout(() => qCtrl.abort(), 10_000);
              try {
                const qh: Record<string, string> = { 'Content-Type': 'application/json' };
                if (qdrantKey) qh['api-key'] = qdrantKey;
                const qr = await fetch(`${qdrantUrl}/collections/vendly_intelligence/points/search`, {
                  method: 'POST', headers: qh, signal: qCtrl.signal,
                  body: JSON.stringify({
                    vector: embedding, limit: 5, with_payload: true, score_threshold: 0.35,
                    filter: { should: [
                      { key: 'businessId', match: { value: businessId } },
                      { key: 'businessId', match: { value: 'global' } },
                      { key: 'instance', match: { value: instance } },
                      { key: 'instance', match: { value: 'global' } },
                    ]},
                  }),
                });
                const qd = await qr.json() as { result?: Array<{ score?: number; payload?: { content?: string; text?: string } }> };
                const hits = (qd.result ?? [])
                  .filter(r => (r.score ?? 0) >= 0.35)
                  .map(r => r.payload?.content || r.payload?.text || '')
                  .filter(Boolean);
                content = hits.length > 0 ? hits.join('\n\n') : 'Nenhuma informação relevante encontrada.';
              } finally { clearTimeout(qt); }
            } catch (e) { content = 'Erro ao buscar na base de conhecimento: ' + String(e); }
          } else {
            try {
              const text = await routeTool(toolName, args);
              try {
                const p = JSON.parse(text) as { ok?: boolean; result?: unknown; error?: unknown };
                content = p.ok === true
                  ? (typeof p.result === 'string' ? p.result : JSON.stringify(p.result))
                  : p.ok === false
                    ? 'Erro ferramenta: ' + String(p.error ?? JSON.stringify(p))
                    : text;
              } catch { content = text; }
            } catch (e) { content = 'Erro ao executar ' + toolName + ': ' + String(e); }
          }

          const MAX_TOOL_RESULT = 3000;
          if (content.length > MAX_TOOL_RESULT) {
            console.warn(`[agent-loop] tool=${toolName} result truncado ${content.length}->${MAX_TOOL_RESULT}chars`);
            content = content.slice(0, MAX_TOOL_RESULT) + '\n[resultado truncado]';
          }
          console.log(`[agent-loop]   tool=${toolName} result=${content.length}chars`);
          toolResults.push({ role: 'tool', tool_call_id: tc.id, content });
        }

        // Próximo round com o contexto acumulado
        const prevMsgs: unknown[] = Array.isArray(currentBody.messages) ? currentBody.messages as unknown[] : [];
        currentBody = { ...currentBody, messages: [...prevMsgs, assistantMsg, ...toolResults] };
      }

      // tool_calls_made sinaliza ao Parsear Chunks que houve execucao real de ferramentas
      // (desativa guarda de alucinacao que filtraria referencias legítimas como LT-XXXX)
      res.json({ choices: [{ message: { content: finalContent ?? 'Desculpe, não consegui concluir. Tente novamente.' }, finish_reason: 'stop' }], tool_calls_made: toolCallsMade });
    });

    // REST direto de ferramentas (uso interno: N8N, scripts).
    // Bypassa o protocolo MCP (sem session/initialize) — chama o handler direto.
    // POST /tool/:name  body = arguments (objeto)
    webApp.post('/tool/:name', async (req, res) => {
      const name = req.params.name;
      const args = (req.body ?? {}) as Record<string, unknown>;
      try {
        const text = await routeTool(name, args);
        res.json({ ok: true, name, result: text });
      } catch (err) {
        res.status(500).json({ ok: false, name, error: String(err) });
      }
    });

    // SPA fallback — serve index.html for all non-API routes
    webApp.get(/^\/(?!api|mcp|health|util|tool).*/, (_req, webRes) => {
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
        // Delegate to Express (dashboard + API)
        webApp(req, res);
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
    const srv = makeMcpServer();
    await srv.connect(transport);
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

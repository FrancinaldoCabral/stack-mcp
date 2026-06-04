/**
 * fix-parsear-tool-loop.mjs
 *
 * Melhora a robustez do loop de tool calls em "Parsear Chunks":
 * 1. Adiciona timeout (15s) no fetch de cada tool call ao MCP server
 * 2. Adiciona timeout (20s) no segundo fetch ao OpenRouter dentro do loop
 * 3. Melhora tratamento de resposta não-JSON do OpenRouter
 * 4. Ajusta mensagem de erro para ser mais descritiva
 */
import 'dotenv/config';

const N8N = process.env.N8N_URL || 'https://workflows.vendly.chat';
const KEY = process.env.N8N_API_KEY;
const WF_ID = 'jleu4RPvSnYDL8Gd';
if (!KEY) { console.error('N8N_API_KEY ausente'); process.exit(1); }
const h = { 'X-N8N-API-KEY': KEY, 'Accept': 'application/json', 'Content-Type': 'application/json' };

const wf = await (await fetch(`${N8N}/api/v1/workflows/${WF_ID}`, { headers: h })).json();
const pcNode = wf.nodes.find(n => n.name === 'Parsear Chunks');
if (!pcNode) throw new Error('"Parsear Chunks" não encontrado');

let code = pcNode.parameters.jsCode;

// ── 1. Adicionar timeout ao fetch de tool call (MCP server) ──────────────────
// Padrão atual:
//   const __tr = await fetch(`${MCP_BASE}/tool/${__tcName}`, {
// Novo (com AbortController e timeout de 12s):
const OLD_TOOL_FETCH = `      let __toolResult = '';
      try {
        const __tr = await fetch(\`\${MCP_BASE}/tool/\${__tcName}\`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(__tcArgs),
        });
        __toolResult = await __tr.text();
      } catch (__e) {
        __toolResult = JSON.stringify({ error: 'Falha ao executar ferramenta: ' + __e.message });
      }`;

const NEW_TOOL_FETCH = `      let __toolResult = '';
      try {
        const __toolCtrl = new AbortController();
        const __toolTimer = setTimeout(() => __toolCtrl.abort(), 12000);
        try {
          const __tr = await fetch(\`\${MCP_BASE}/tool/\${__tcName}\`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(__tcArgs),
            signal: __toolCtrl.signal,
          });
          __toolResult = await __tr.text();
        } finally {
          clearTimeout(__toolTimer);
        }
      } catch (__e) {
        const __isTimeout = __e.name === 'AbortError';
        __toolResult = JSON.stringify({ error: __isTimeout ? 'Tempo limite excedido ao executar ferramenta ' + __tcName + ' (tente novamente)' : 'Falha ao executar ferramenta ' + __tcName + ': ' + __e.message });
      }`;

if (code.includes(OLD_TOOL_FETCH)) {
  code = code.replace(OLD_TOOL_FETCH, NEW_TOOL_FETCH);
  console.log('✓ Timeout (12s) adicionado ao fetch de tool call');
} else {
  console.warn('⚠ Padrão do fetch de tool call não encontrado — verificando alternativo...');
  // Tenta padrão sem espaço exato
  const altIdx = code.indexOf("const __tr = await fetch(`${MCP_BASE}/tool/${__tcName}`");
  if (altIdx !== -1) {
    console.log('  Encontrado em posição', altIdx, '— aplicando manualmente');
    // Não altera se não encontrou o padrão exato — melhor não quebrar
    console.warn('  AVISO: padrão diferente, pulando essa alteração');
  }
}

// ── 2. Melhorar o fetch ao OpenRouter dentro do loop (timeout + JSON robusto) ──
// Padrão atual:
//   const __nr = await fetch('https://openrouter.ai/api/v1/chat/completions', {
//     ...
//   });
//   __curResp = await __nr.json();
// Novo (com timeout e fallback para texto se não for JSON):
const OLD_OR_FETCH = `        try {
      const __nr = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': \`Bearer \${OR_KEY}\`,
          'HTTP-Referer': 'https://app.vendly.chat',
          'X-Title': 'VendlyChat',
        },
        body: JSON.stringify({
          model: __lmModel,
          messages: __msgs,
          temperature: 0.8,
          ...(__includeTools ? { tools: __lmTools, tool_choice: 'auto' } : {}),
        }),
      });
      __curResp = await __nr.json();
    } catch (__e) {
      content = 'Desculpe, não consegui completar a operação. Pode tentar novamente?';
      break;
    }`;

const NEW_OR_FETCH = `        try {
      const __orCtrl = new AbortController();
      const __orTimer = setTimeout(() => __orCtrl.abort(), 25000);
      let __orResp;
      try {
        __orResp = await fetch('https://openrouter.ai/api/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': \`Bearer \${OR_KEY}\`,
            'HTTP-Referer': 'https://app.vendly.chat',
            'X-Title': 'VendlyChat',
          },
          body: JSON.stringify({
            model: __lmModel,
            messages: __msgs,
            temperature: 0.8,
            ...(__includeTools ? { tools: __lmTools, tool_choice: 'auto' } : {}),
          }),
          signal: __orCtrl.signal,
        });
      } finally {
        clearTimeout(__orTimer);
      }
      const __orText = await __orResp.text();
      try {
        __curResp = JSON.parse(__orText);
      } catch {
        // Resposta não-JSON (ex: erro de rate limit em texto plano)
        content = 'Ops, erro temporário ao processar. Tente novamente em instantes.';
        break;
      }
      // Verifica se OpenRouter retornou erro
      if (__curResp.error) {
        const __orErrMsg = typeof __curResp.error === 'string' ? __curResp.error : (__curResp.error?.message || 'erro desconhecido');
        content = 'Não consegui concluir a operação (' + __orErrMsg.slice(0, 60) + '). Tente novamente.';
        break;
      }
    } catch (__e) {
      const __isTimeout = __e.name === 'AbortError';
      content = __isTimeout ? 'Operação demorou demais. Tente novamente.' : 'Não consegui completar a operação. Tente novamente.';
      break;
    }`;

if (code.includes(OLD_OR_FETCH)) {
  code = code.replace(OLD_OR_FETCH, NEW_OR_FETCH);
  console.log('✓ Timeout (25s) + robustez adicionados ao fetch OpenRouter no loop');
} else {
  console.warn('⚠ Padrão do fetch OpenRouter no loop não encontrado — verificando...');
  const orIdx = code.indexOf("await fetch('https://openrouter.ai/api/v1/chat/completions'");
  console.log('  openrouter fetch found at idx:', orIdx);
}

// ── 3. Salvar ────────────────────────────────────────────────────────────────
pcNode.parameters.jsCode = code;

const allowedSettings = ['saveExecutionProgress','saveManualExecutions','saveDataErrorExecution','saveDataSuccessExecution','executionTimeout','errorWorkflow','timezone','executionOrder'];
const cleanSettings = {};
for (const k of allowedSettings) if (wf.settings?.[k] !== undefined) cleanSettings[k] = wf.settings[k];
if (!cleanSettings.executionOrder) cleanSettings.executionOrder = 'v1';

const put = await fetch(`${N8N}/api/v1/workflows/${WF_ID}`, {
  method: 'PUT', headers: h,
  body: JSON.stringify({ name: wf.name, nodes: wf.nodes, connections: wf.connections, settings: cleanSettings }),
});
const putJ = await put.json();
if (!put.ok) { console.error('PUT falhou:', JSON.stringify(putJ).slice(0,300)); process.exit(1); }
console.log('✅ Workflow salvo (id=' + putJ.id + ')');

require('dotenv').config();
const axios = require('axios');

const WF_ID = 'jleu4RPvSnYDL8Gd';
const headers = {
  'X-N8N-API-KEY': process.env.N8N_API_KEY,
  Accept: 'application/json',
  'Content-Type': 'application/json'
};

(async () => {
  const { data: wf } = await axios.get('https://workflows.vendly.chat/api/v1/workflows/' + WF_ID, { headers });

  // ── 1. Parsear Chunks: add tool_calls guard ──────────────────────────────
  const pcIdx = wf.nodes.findIndex(n => n.name === 'Parsear Chunks');
  const oldCode = wf.nodes[pcIdx].parameters.jsCode;

  // Strategy: replace just the else block that contains 'erro interno' (avoid non-ASCII in match)
  const oldElse = "} else {\n  content = _choice?.message?.content ?? resp.error?.message ?? 'Desculpe, erro interno.';\n}";
  const newElse = [
    "} else if (_finishReason === 'tool_calls' && !_choice?.message?.content) {",
    "  // LLM solicitou outra ferramenta mas o workflow suporta apenas 1 round - mensagem neutra",
    "  content = 'Estou verificando aqui, um segundo... \uD83E\uDDE0';",
    "} else {",
    "  content = _choice?.message?.content",
    "    ?? (resp.error ? (resp.error.message ?? JSON.stringify(resp.error)) : null)",
    "    ?? 'Desculpe, n\u00e3o consegui processar. Pode tentar novamente?';",
    "}"
  ].join('\n');

  if (!oldCode.includes(oldElse)) {
    const i = oldCode.indexOf("'Desculpe, erro interno.'");
    console.error('Anchor not found. Nearby code:');
    if (i >= 0) console.error('[' + oldCode.substring(i - 150, i + 60) + ']');
    process.exit(1);
  }

  wf.nodes[pcIdx].parameters.jsCode = oldCode.replace(oldElse, newElse);
  console.log('Parsear Chunks tool_calls guard:', wf.nodes[pcIdx].parameters.jsCode.includes("_finishReason === 'tool_calls'"));

  // ── 2. OpenRouter (main): add neverError: true ───────────────────────────
  const orIdx = wf.nodes.findIndex(n => n.name === 'OpenRouter');
  wf.nodes[orIdx].parameters.options = { response: { response: { neverError: true } } };
  console.log('OpenRouter neverError set');

  // ── PUT ──────────────────────────────────────────────────────────────────
  const body = {
    name: wf.name,
    nodes: wf.nodes,
    connections: wf.connections,
    settings: { executionOrder: 'v1', saveManualExecutions: true },
  };

  const { data: updated } = await axios.put(
    'https://workflows.vendly.chat/api/v1/workflows/' + WF_ID,
    body,
    { headers }
  );

  console.log('Workflow updated at:', updated.updatedAt);
  const pcFinal = updated.nodes.find(n => n.name === 'Parsear Chunks');
  const orFinal = updated.nodes.find(n => n.name === 'OpenRouter');
  console.log('Parsear Chunks has tool_calls guard:', pcFinal.parameters.jsCode.includes("_finishReason === 'tool_calls'"));
  console.log('OpenRouter neverError:', orFinal.parameters.options?.response?.response?.neverError);
})().catch(e => { console.error(e.response?.data || e.message); process.exit(1); });

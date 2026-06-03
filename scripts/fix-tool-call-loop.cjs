require('dotenv').config();
const axios = require('axios');

const WF_ID = 'jleu4RPvSnYDL8Gd';
const headers = {
  'X-N8N-API-KEY': process.env.N8N_API_KEY,
  Accept: 'application/json',
  'Content-Type': 'application/json'
};

(async () => {
  const { data: wf } = await axios.get('https://workflows.vendly.craft/api/v1/workflows/' + WF_ID, { headers })
    .catch(() => axios.get('https://workflows.vendly.chat/api/v1/workflows/' + WF_ID, { headers }));

  // 1. Montar Tool Result MCP: tool_choice 'auto' → 'none'
  const mtrIdx = wf.nodes.findIndex(n => n.name === 'Montar Tool Result MCP');
  const oldCode = wf.nodes[mtrIdx].parameters.jsCode;

  const OLD_COMMENT = "// SEMPRE 'auto' na 2a chamada — evita loop de tool_calls e permite resposta em texto final\nconst outBody = { ...baseBody, messages: newMessages, tool_choice: 'auto' };";
  const NEW_COMMENT = "// 'none' na 2a chamada: força o modelo a gerar texto, sem nova tool call\n// Isso evita que o modelo tente encadear 2 tools (ex: draft_order → confirm_order) numa única rodada\nconst outBody = { ...baseBody, messages: newMessages, tool_choice: 'none' };";

  if (!oldCode.includes(OLD_COMMENT)) {
    console.error('Anchor not found in Montar Tool Result MCP:');
    const i = oldCode.indexOf("tool_choice:");
    if (i >= 0) console.error(oldCode.substring(i - 60, i + 80));
    process.exit(1);
  }

  wf.nodes[mtrIdx].parameters.jsCode = oldCode.replace(OLD_COMMENT, NEW_COMMENT);
  console.log('Montar Tool Result MCP patched:', wf.nodes[mtrIdx].parameters.jsCode.includes("tool_choice: 'none'"));

  // 2. Also update Construir Prompt node with the new construir.js content
  const fs = require('fs');
  const newConstruirJs = fs.readFileSync('construir.js', 'utf8');
  const cpIdx = wf.nodes.findIndex(n => n.name === 'Construir Prompt');
  const oldConstruirCode = wf.nodes[cpIdx].parameters.jsCode;

  // Verify the new code has our fix
  if (!newConstruirJs.includes('__groupHeaderMatch')) {
    console.error('construir.js does not have __groupHeaderMatch fix!');
    process.exit(1);
  }

  wf.nodes[cpIdx].parameters.jsCode = newConstruirJs;
  console.log('Construir Prompt updated with new construir.js');
  console.log('  Has group header fix:', newConstruirJs.includes('__groupHeaderMatch'));
  console.log('  Has sim/pode in confirm regex:', newConstruirJs.includes('sim|pode'));

  // PUT
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

  console.log('\nWorkflow updated at:', updated.updatedAt);
  const mtrFinal = updated.nodes.find(n => n.name === 'Montar Tool Result MCP');
  const cpFinal = updated.nodes.find(n => n.name === 'Construir Prompt');
  console.log('Montar Tool Result tool_choice none:', mtrFinal.parameters.jsCode.includes("tool_choice: 'none'"));
  console.log('Construir Prompt group header fix:', cpFinal.parameters.jsCode.includes('__groupHeaderMatch'));
})().catch(e => { console.error(e.response?.data || e.message); process.exit(1); });

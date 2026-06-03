// Patches Parsear Chunks node: adds guard to strip hallucinated ⏰ Pronto às HH:MM
require('dotenv').config();
const axios = require('axios');

const WF_ID = 'jleu4RPvSnYDL8Gd';
const API = 'https://workflows.vendly.chat/api/v1';
const headers = { 'X-N8N-API-KEY': process.env.N8N_API_KEY, 'Accept': 'application/json', 'Content-Type': 'application/json' };

const NEW_GUARD = `
  // 3. Strip "⏰ Pronto às HH:MM" when no time was explicitly mentioned by the user.
  //    The LLM hallucinates this field when the restaurant didn't provide a ready time.
  if (/\\u23f0\\s*Pronto\\s+[a\\u00e0]s?\\s+\\d{1,2}:\\d{2}/i.test(content)) {
    const __recentUserMsgs = (promptData.messages || [])
      .filter(m => m.role === 'user')
      .slice(-6)
      .map(m => typeof m.content === 'string' ? m.content : JSON.stringify(m.content))
      .join(' ');
    const __timeWasMentioned = /\\b\\d{1,2}:\\d{2}\\b|pronto\\s+(?:em|[a\\u00e0]s?)\\s+\\d|\\d+\\s*min(?:utos?)?\\s+de\\s+preparo|prazo\\s+de\\s+preparo/.test(__recentUserMsgs);
    if (!__timeWasMentioned) {
      // No real time in context — strip the ⏰ line to prevent hallucinated times being sent
      content = content.replace(/\\u23f0[^\\n]*\\d{1,2}:\\d{2}[^\\n]*/gi, '').trim();
    }
  }
`;

async function patch() {
  const { data: wf } = await axios.get(`${API}/workflows/${WF_ID}`, { headers });
  
  const nodeIdx = wf.nodes.findIndex(n => n.name === 'Parsear Chunks');
  if (nodeIdx === -1) { console.error('Parsear Chunks not found'); process.exit(1); }
  
  const code = wf.nodes[nodeIdx].parameters.jsCode;
  const GUARD_END = '/* hallucination-guard-end */';
  
  if (!code.includes(GUARD_END)) { console.error('Guard end marker not found'); process.exit(1); }
  if (code.includes('__timeWasMentioned')) { console.log('Guard already patched'); process.exit(0); }
  
  wf.nodes[nodeIdx].parameters.jsCode = code.replace(
    `} catch(__guardErr) { /* não bloqueia o fluxo */ }\n${GUARD_END}`,
    `${NEW_GUARD}} catch(__guardErr) { /* não bloqueia o fluxo */ }\n${GUARD_END}`
  );
  
  const body = {
    name: wf.name,
    nodes: wf.nodes,
    connections: wf.connections,
    settings: { executionOrder: 'v1', saveManualExecutions: true },
  };
  
  const { data: updated } = await axios.put(`${API}/workflows/${WF_ID}`, body, { headers });
  console.log('Updated workflow updatedAt:', updated.updatedAt);
  
  // Verify
  const patchedCode = updated.nodes.find(n => n.name === 'Parsear Chunks').parameters.jsCode;
  console.log('Guard present:', patchedCode.includes('__timeWasMentioned'));
}

patch().catch(e => { console.error(e.response?.data || e.message); process.exit(1); });

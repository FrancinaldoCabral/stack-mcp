import 'dotenv/config';

/**
 * Testa se nó HTTP Request nativo do N8N pode retornar binary correto
 * via responseFormat: arraybuffer ou similar
 */

const H = { 'X-N8N-API-KEY': process.env.N8N_API_KEY, 'Accept': 'application/json', 'Content-Type': 'application/json' };
const WF_ID = 'jleu4RPvSnYDL8Gd';

const wf = await fetch(`https://workflows.vendly.chat/api/v1/workflows/${WF_ID}`, { headers: H }).then(r => r.json());

// Update Baixar Áudio to test different response formats
const baixarNode = wf.nodes.find(n => n.name === 'Baixar Áudio');
if (!baixarNode) throw new Error('Baixar Áudio não encontrado');

// Test: responseFormat = arraybuffer (not standard but let's see)
baixarNode.parameters = {
  method: 'GET',
  url: '={{ $json.audioUrl }}',
  responseFormat: 'arraybuffer',
  dataPropertyName: 'data',
  options: {
    response: {
      response: {
        neverError: true,
      },
    },
  },
};

// Update Prep Transcrição to be diagnostic again
const prepNode = wf.nodes.find(n => n.name === 'Prep Transcrição');
prepNode.parameters.jsCode = `const msg = $('Desembalar Payload').first().json;
const audioUrl = msg.metadata?.url ?? '';
return [{ json: { ...msg, audioUrl, audioOk: !!audioUrl } }];`;
delete prepNode.credentials;

// Also update the Code node after Baixar Áudio to check binary
// We'll temporarily put a code node to inspect what Baixar Áudio returns
// Actually, let's just check the exec output

const payload = { name: wf.name, nodes: wf.nodes, connections: wf.connections, settings: { executionOrder: 'v1', saveManualExecutions: true } };
const r = await fetch(`https://workflows.vendly.chat/api/v1/workflows/${WF_ID}`, {
  method: 'PUT', headers: H, body: JSON.stringify(payload)
}).then(r => r.json());
console.log('Updated:', r.updatedAt ?? JSON.stringify(r).slice(0, 100));

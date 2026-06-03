/**
 * Fix Montar Tool Result MCP — v2
 *
 * Problema detectado:
 *   A v1 convertia o resultado da ferramenta para role:user num turn separado.
 *   O Gemini fica confuso com 2 turns de usuario consecutivos e ecoa o resultado
 *   em vez de responder naturalmente (ex: "delivery_assign_deliverer(orderId=...").
 *
 * Solução:
 *   Injetar o resultado da ferramenta DENTRO da última mensagem do usuário existente.
 *   O modelo vê uma única mensagem enriquecida e responde ao usuário normalmente.
 */
import 'dotenv/config';
import https from 'https';

const N8N_URL = process.env.N8N_URL;
const N8N_KEY = process.env.N8N_API_KEY;
const WF_ID   = 'jleu4RPvSnYDL8Gd';

function n8nReq(method, path, body = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(N8N_URL + path);
    const payload = body ? JSON.stringify(body) : null;
    const headers = {
      'X-N8N-API-KEY': N8N_KEY,
      'Accept': 'application/json, text/event-stream',
    };
    if (payload) {
      headers['Content-Type'] = 'application/json';
      headers['Content-Length'] = Buffer.byteLength(payload);
    }
    const req = https.request(
      { hostname: url.hostname, path: url.pathname + url.search, method, headers },
      res => {
        let d = ''; res.on('data', c => d += c);
        res.on('end', () => {
          try { resolve({ status: res.statusCode, data: JSON.parse(d) }); }
          catch { resolve({ status: res.statusCode, data: d }); }
        });
      }
    );
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

// Novo código para o nó Montar Tool Result MCP
const NEW_MESSAGES_BLOCK = `// Para a 2ª chamada: injeta o resultado da ferramenta na última mensagem do usuário.
// Isso evita "tool mode" do Gemini (que persiste mesmo sem 'tools' no body quando
// há role:assistant+tool_calls ou role:tool no histórico) e também evita que o
// modelo ecoe o resultado em vez de responder naturalmente.
const baseMessages = [...(baseBody.messages || promptData.messages || [])];
const toolNote = \`\\n\\n[DADOS: \${extr.toolName ?? 'consulta'} →\\n\${textResult}]\`;
// Encontrar a última mensagem do usuário e injetar o resultado da ferramenta
let appended = false;
for (let i = baseMessages.length - 1; i >= 0; i--) {
  if (baseMessages[i].role === 'user') {
    const origContent = typeof baseMessages[i].content === 'string'
      ? baseMessages[i].content
      : Array.isArray(baseMessages[i].content)
        ? baseMessages[i].content.filter(p => p.type === 'text').map(p => p.text).join(' ')
        : '';
    baseMessages[i] = { ...baseMessages[i], content: origContent + toolNote };
    appended = true;
    break;
  }
}
if (!appended) {
  baseMessages.push({ role: 'user', content: toolNote });
}
const outBody = { ...baseBody, messages: baseMessages };
delete outBody.tools;
delete outBody.tool_choice;`;

// Padrão OLD usado na v1 (o que está no workflow agora)
const OLD_PATTERNS = [
  // v1 (role:user separado)
  /\/\/ Para a 2ª chamada: NÃO incluir.*?delete outBody\.tool_choice;/s,
  // fallback: qualquer bloco que constrói newMessages com role:user + resultado
  /const assistantContent = extr\.assistantMessage.*?delete outBody\.tool_choice;/s,
];

async function main() {
  console.log('Buscando workflow atual do N8N...');
  const { status, data: wf } = await n8nReq('GET', `/api/v1/workflows/${WF_ID}`);
  if (status !== 200) { console.error('Erro GET:', status, JSON.stringify(wf).slice(0,200)); process.exit(1); }
  console.log(`Workflow: "${wf.name}" — updatedAt: ${wf.updatedAt}`);

  const node = wf.nodes.find(n => n.name === 'Montar Tool Result MCP');
  if (!node) { console.error('Nó "Montar Tool Result MCP" não encontrado'); process.exit(1); }

  const origCode = node.parameters.jsCode;
  console.log('\nTrechos relevantes no código atual:');
  origCode.split('\n').forEach((l, i) => {
    if (/newMessages|assistantContent|role.*tool|outBody|tool_mode|inject|DADOS/.test(l)) {
      console.log(`  ${String(i).padStart(3)}: ${l}`);
    }
  });

  let newCode = origCode;
  let replaced = false;
  for (const pat of OLD_PATTERNS) {
    if (pat.test(newCode)) {
      newCode = newCode.replace(pat, NEW_MESSAGES_BLOCK);
      replaced = true;
      console.log('\nReplacement pattern matched!');
      break;
    }
  }

  if (!replaced) {
    console.error('\nNenhum padrão OLD encontrou correspondência. Código atual do nó:');
    console.error('--- START ---');
    console.error(origCode);
    console.error('--- END ---');
    process.exit(1);
  }

  console.log('\nCódigo após substituição (linhas com "baseMessages" e "outBody"):');
  newCode.split('\n').forEach((l, i) => {
    if (/baseMessages|toolNote|appended|outBody|DADOS|inject/.test(l)) {
      console.log(`  ${String(i).padStart(3)}: ${l}`);
    }
  });

  node.parameters.jsCode = newCode;

  const putBody = {
    name: wf.name,
    nodes: wf.nodes,
    connections: wf.connections,
    settings: { executionOrder: 'v1', saveManualExecutions: true },
  };

  console.log('\nEnviando PUT para N8N...');
  const { status: putStatus, data: putResp } = await n8nReq('PUT', `/api/v1/workflows/${WF_ID}`, putBody);
  if (putStatus === 200) {
    console.log('PUT OK — updatedAt:', putResp.updatedAt);
  } else {
    console.error('PUT FAIL status:', putStatus);
    console.error(JSON.stringify(putResp).slice(0, 500));
    process.exit(1);
  }
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });

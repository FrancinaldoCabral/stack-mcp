#!/usr/bin/env node
/**
 * Patch cirúrgico no workflow [AGENT] Executor para:
 * 1. Registrar as tools delivery_* no OpenRouter (dinamicamente, com base em $json.toolsAllowed da persona).
 * 2. Adicionar branch que executa tool calls via MCP (HTTP POST → MCP em prod).
 *
 * Idempotente: roda quantas vezes precisar.
 */
import 'dotenv/config';
import axios from 'axios';

const N8N_URL  = (process.env.N8N_URL || 'https://workflows.vendly.chat').replace(/\/$/, '');
const API_KEY  = process.env.N8N_API_KEY;
const WF_ID    = 'jleu4RPvSnYDL8Gd'; // [AGENT] Executor
const MCP_URL  = process.env.MCP_URL || 'http://fco8og80s4sw4c0wc0ogswws.157.173.111.65.sslip.io/mcp';

if (!API_KEY) { console.error('N8N_API_KEY ausente'); process.exit(1); }

const headers = { 'X-N8N-API-KEY': API_KEY, 'Content-Type': 'application/json', 'Accept': 'application/json' };
const api = axios.create({ baseURL: `${N8N_URL}/api/v1`, headers, timeout: 30000 });

// ── Definições das tools delivery_* (subset essencial) ────────────────────────
const DELIVERY_TOOL_DEFS = {
  delivery_draft_order: {
    description: 'Cria um pedido em RASCUNHO (não publica no grupo). Use ao capturar pedido pela primeira vez.',
    parameters: {
      type: 'object',
      required: ['restaurantId'],
      properties: {
        restaurantId: { type: 'string', description: 'ID do restaurante (passe o restaurantId do contexto)' },
        clientName: { type: 'string' },
        clientAddress: { type: 'string' },
        clientPhone: { type: 'string' },
        items: { type: 'array', items: { type: 'string' } },
        value: { type: 'number' },
        notes: { type: 'string' },
      },
    },
  },
  delivery_update_draft: {
    description: 'Atualiza campos de um pedido em rascunho.',
    parameters: {
      type: 'object',
      required: ['orderId'],
      properties: {
        orderId: { type: 'string' },
        clientName: { type: 'string' },
        clientAddress: { type: 'string' },
        clientPhone: { type: 'string' },
        items: { type: 'array', items: { type: 'string' } },
        value: { type: 'number' },
        notes: { type: 'string' },
      },
    },
  },
  delivery_confirm_order: {
    description: 'Confirma o rascunho e PUBLICA AUTOMATICAMENTE o pedido no grupo dos entregadores. Use após confirmação textual do restaurante.',
    parameters: {
      type: 'object',
      required: ['orderId'],
      properties: {
        orderId: { type: 'string' },
        crossPost: { type: 'boolean' },
      },
    },
  },
  delivery_update_order_status: {
    description: 'Atualiza status de um pedido. Espelha automaticamente no grupo de comandos.',
    parameters: {
      type: 'object',
      required: ['orderId', 'status'],
      properties: {
        orderId: { type: 'string' },
        status: { type: 'string', enum: ['rascunho','pendente','aceito','a_caminho','no_restaurante','saindo','no_cliente','entregue','problema','cancelado'] },
        note: { type: 'string' },
      },
    },
  },
  delivery_assign_deliverer: {
    description: 'Atribui um entregador a um pedido.',
    parameters: {
      type: 'object',
      required: ['orderId','delivererJid','delivererName'],
      properties: {
        orderId: { type: 'string' },
        delivererJid: { type: 'string', description: 'JID do entregador (ex: 5521xxx@s.whatsapp.net)' },
        delivererName: { type: 'string' },
        etaMin: { type: 'number' },
      },
    },
  },
  delivery_log_settlement: {
    description: 'Registra um lançamento financeiro (débito = entregador deve à LT; crédito = LT deve ao entregador).',
    parameters: {
      type: 'object',
      required: ['delivererJid','delivererName','type','amount'],
      properties: {
        delivererJid: { type: 'string' },
        delivererName: { type: 'string' },
        type: { type: 'string', enum: ['debito','credito'] },
        amount: { type: 'number' },
        description: { type: 'string' },
        restaurantId: { type: 'string' },
        orderRef: { type: 'string' },
      },
    },
  },
  delivery_post_to_command_group: {
    description: 'Envia mensagem ao grupo de COMANDOS do restaurante. Use para AVISAR o restaurante sobre status (ex: "entregador a caminho").',
    parameters: {
      type: 'object',
      required: ['restaurantId','text'],
      properties: {
        restaurantId: { type: 'string' },
        text: { type: 'string' },
      },
    },
  },
  delivery_post_to_deliverer_group: {
    description: 'Envia mensagem ao grupo dos ENTREGADORES do restaurante.',
    parameters: {
      type: 'object',
      required: ['restaurantId','text'],
      properties: {
        restaurantId: { type: 'string' },
        text: { type: 'string' },
      },
    },
  },
  delivery_get_order: {
    description: 'Consulta um pedido por ID ou referência (LT-XXXXXX).',
    parameters: {
      type: 'object',
      required: ['orderIdOrRef'],
      properties: { orderIdOrRef: { type: 'string' } },
    },
  },
  delivery_list_orders: {
    description: 'Lista pedidos com filtros opcionais.',
    parameters: {
      type: 'object',
      properties: {
        restaurantId: { type: 'string' },
        status: { type: 'string' },
        delivererJid: { type: 'string' },
        days: { type: 'number' },
        limit: { type: 'number' },
      },
    },
  },
};

// ── jsonBody do OpenRouter (referência simples; body montado no Construir Prompt) ──
const OPENROUTER_BODY = `={{ $json.openRouterBody }}`;

// Código a ser injetado no fim do Construir Prompt para preparar o body do OpenRouter
const OPENROUTER_BODY_SNIPPET = `
/* delivery-openrouter-body */
const __DEFS = ${JSON.stringify(DELIVERY_TOOL_DEFS)};
const __allowed = Array.isArray(__deliveryCtx.toolsAllowed) ? __deliveryCtx.toolsAllowed : [];
const __baseTools = [{ type: 'function', function: { name: 'buscar_memoria', description: 'Busca na base de conhecimento do negócio (RAG). Use para perguntas sobre produtos, preços, políticas, FAQs.', parameters: { type: 'object', required: ['query'], properties: { query: { type: 'string' } } } } }];
const __extraTools = __allowed.filter(n => __DEFS[n]).map(n => ({ type: 'function', function: { name: n, ...__DEFS[n] } }));
const __model = businessDoc?.settings?.model || 'google/gemini-2.5-flash-lite';
const __openRouterBody = JSON.stringify({ model: __model, messages, temperature: 0.8, tools: [...__baseTools, ...__extraTools], tool_choice: 'auto' });
`;

// ── Novo Extrair Query Ferramenta (propaga args completos) ────────────────────
const NEW_EXTRAIR_CODE = `const resp = $input.first().json;
const tc = resp.choices?.[0]?.message?.tool_calls?.[0];
if (!tc) return [];
let args = {};
try { args = JSON.parse(tc.function?.arguments ?? '{}'); } catch {}
const name = tc.function?.name || '';
const isMcp = name.startsWith('delivery_');
return [{
  json: {
    toolCallId: tc.id,
    toolName: name,
    isMcp,
    query: args.query ?? '',
    args,
    assistantMessage: resp.choices[0].message,
  }
}];
`;

// ── Novo nó: IF É Tool MCP? ───────────────────────────────────────────────────
const IF_MCP_NODE = {
  parameters: {
    conditions: {
      options: { caseSensitive: true, leftValue: '', typeValidation: 'loose' },
      conditions: [{
        id: 'mcp-check',
        leftValue: '={{ $json.isMcp }}',
        rightValue: true,
        operator: { type: 'boolean', operation: 'true', singleValue: true },
      }],
      combinator: 'and',
    },
    options: {},
  },
  id: 'if-is-mcp-tool',
  name: 'IF É Tool MCP?',
  type: 'n8n-nodes-base.if',
  typeVersion: 2,
  position: [0, 0],
};

// ── Novo nó: Executar Tool MCP ───────────────────────────────────────────────
const EXEC_MCP_NODE = {
  parameters: {
    method: 'POST',
    url: MCP_URL,
    sendHeaders: true,
    headerParameters: { parameters: [
      { name: 'Content-Type', value: 'application/json' },
      { name: 'Accept', value: 'application/json, text/event-stream' },
    ]},
    sendBody: true,
    specifyBody: 'json',
    jsonBody: `={{ JSON.stringify({ jsonrpc: '2.0', id: Date.now(), method: 'tools/call', params: { name: $json.toolName, arguments: $json.args } }) }}`,
    options: { response: { response: { neverError: true, responseFormat: 'text' } } },
  },
  id: 'exec-mcp-tool',
  name: 'Executar Tool MCP',
  type: 'n8n-nodes-base.httpRequest',
  typeVersion: 4.2,
  position: [0, 0],
};

// ── Novo nó: Montar Tool Result MCP ───────────────────────────────────────────
const MONTAR_MCP_NODE = {
  parameters: {
    jsCode: `// Parse resposta MCP (text/event-stream → SSE: "event: message\\ndata: {...}")
const raw = $input.first().json;
const extr = $('Extrair Query Ferramenta').first().json;
const promptData = $('Construir Prompt').first().json;

let textResult = '';
try {
  const body = raw.data ?? raw.body ?? (typeof raw === 'string' ? raw : JSON.stringify(raw));
  const dataLine = String(body).split('\\n').find(l => l.startsWith('data: '));
  const jsonStr = dataLine ? dataLine.slice(6) : String(body);
  const parsed = JSON.parse(jsonStr);
  if (parsed.error) {
    textResult = 'Erro MCP: ' + (parsed.error.message || JSON.stringify(parsed.error));
  } else {
    const content = parsed.result?.content?.[0]?.text;
    textResult = content || JSON.stringify(parsed.result);
  }
} catch (e) {
  textResult = 'Erro parseando resposta MCP: ' + e.message + ' | raw=' + String(raw).slice(0, 200);
}

const messages = [
  ...promptData.messages,
  extr.assistantMessage,
  { role: 'tool', tool_call_id: extr.toolCallId, content: textResult },
];

return [{
  json: {
    model: promptData.model ?? 'google/gemini-2.5-flash-lite',
    messages,
    temperature: 0.8,
  }
}];
`,
  },
  id: 'montar-mcp-result',
  name: 'Montar Tool Result MCP',
  type: 'n8n-nodes-base.code',
  typeVersion: 2,
  position: [0, 0],
};

// ── Inject restaurantId / contexto no system prompt (Construir Prompt) ────────
// O LLM precisa SABER o restaurantId pra passar nas tools. Vou patchear o Construir Prompt
// para incluir o restaurantId no system prompt quando vier da Resolver Persona.

async function main() {
  console.log('🔍 Buscando workflow [AGENT] Executor...');
  const { data: wf } = await api.get(`/workflows/${WF_ID}`);
  console.log('   nodes=' + wf.nodes.length + ' active=' + wf.active);

  const nodes = wf.nodes;
  const connections = wf.connections;

  // 1. Patch OpenRouter jsonBody
  const openRouter = nodes.find(n => n.name === 'OpenRouter');
  if (!openRouter) throw new Error('Nó OpenRouter não encontrado');
  openRouter.parameters.jsonBody = OPENROUTER_BODY;
  console.log('✏️  OpenRouter.jsonBody atualizado');

  // 2. Patch Extrair Query Ferramenta
  const extrair = nodes.find(n => n.name === 'Extrair Query Ferramenta');
  if (!extrair) throw new Error('Nó Extrair Query Ferramenta não encontrado');
  extrair.parameters.jsCode = NEW_EXTRAIR_CODE;
  console.log('✏️  Extrair Query Ferramenta.jsCode atualizado');

  // 3. Patch Construir Prompt — injeta restaurantId no system prompt
  const construir = nodes.find(n => n.name === 'Construir Prompt');
  if (!construir) throw new Error('Nó Construir Prompt não encontrado');
  let code = construir.parameters.jsCode;
  const MARKER = '/* delivery-ctx-injected */';
  if (!code.includes(MARKER)) {
    // Injeta logo após o personaOverride
    const anchor = `const customSystemPrompt = __personaOverride || businessDoc?.systemPrompt || '';`;
    if (!code.includes(anchor)) throw new Error('Anchor do Construir Prompt não encontrado');
    const injection = `\n${MARKER}\nconst __deliveryCtx = (typeof $ === 'function' ? $('Resolver Persona').first()?.json : null) || {};\nconst __ctxBlock = __deliveryCtx.restaurantId ? \`\\n\\n## Contexto Operacional\\n- restaurantId: \${__deliveryCtx.restaurantId}\\n- personaKey: \${__deliveryCtx.personaKey || ''}\\n- Use este restaurantId em TODAS as chamadas de ferramenta delivery_*.\` : '';\n`;
    code = code.replace(anchor, anchor + injection);
    // E concatena __ctxBlock no sistemaPrompt final
    code = code.replace(
      `const sistemaPrompt = (customSystemPrompt || defaultPrompt) + customerCtx + intelligenceCtx + audioSystemNote + escalaSystemNote;`,
      `const sistemaPrompt = (customSystemPrompt || defaultPrompt) + __ctxBlock + customerCtx + intelligenceCtx + audioSystemNote + escalaSystemNote;`
    );
    // E propaga toolsAllowed no return final
    code = code.replace(
      `return [{ json: { ...msg, messages, historico, respondWithAudio } }];`,
      `return [{ json: { ...msg, messages, historico, respondWithAudio, toolsAllowed: __deliveryCtx.toolsAllowed || [], restaurantId: __deliveryCtx.restaurantId || null, openRouterBody: __openRouterBody, model: __model } }];`
    );
    construir.parameters.jsCode = code;
    console.log('✏️  Construir Prompt patcheado (contexto + toolsAllowed)');
  } else {
    console.log('✔️  Construir Prompt já tem patch delivery-ctx');
  }

  // 3b. Garantir que o snippet do openRouterBody está presente e atualizado (idempotente)
  const BODY_MARKER = '/* delivery-openrouter-body */';
  let code2 = construir.parameters.jsCode;
  // remove versão antiga (entre marker e a próxima linha 'const respondWithAudio')
  if (code2.includes(BODY_MARKER)) {
    const startIdx = code2.indexOf(BODY_MARKER);
    const endIdx = code2.indexOf('const messages = [', startIdx);
    if (endIdx > startIdx) {
      code2 = code2.slice(0, startIdx) + code2.slice(endIdx);
    }
  }
  // injeta antes de 'const messages = ['
  const msgAnchor = 'const messages = [';
  if (!code2.includes(BODY_MARKER)) {
    code2 = code2.replace(msgAnchor, OPENROUTER_BODY_SNIPPET + '\n' + msgAnchor);
  }
  // Atualiza o return final para que use __openRouterBody/__model SEMPRE (mesmo em re-runs)
  code2 = code2.replace(
    /return \[\{ json: \{ \.\.\.msg, messages, historico, respondWithAudio[^}]*\} \}\];/,
    `return [{ json: { ...msg, messages, historico, respondWithAudio, toolsAllowed: __deliveryCtx.toolsAllowed || [], restaurantId: __deliveryCtx.restaurantId || null, openRouterBody: __openRouterBody, model: __model } }];`
  );
  construir.parameters.jsCode = code2;
  console.log('✏️  Construir Prompt: snippet openRouterBody garantido');

  // 4. Adicionar nós novos (idempotente)
  const ensureNode = (def) => {
    const existing = nodes.find(n => n.name === def.name);
    if (existing) { Object.assign(existing.parameters, def.parameters); return existing; }
    // posiciona perto do Extrair Query Ferramenta
    const ref = nodes.find(n => n.name === 'Extrair Query Ferramenta');
    const pos = ref ? [ref.position[0] + 250, ref.position[1] + 200] : [0, 0];
    const newNode = { ...def, position: pos };
    nodes.push(newNode);
    return newNode;
  };

  ensureNode(IF_MCP_NODE);
  ensureNode(EXEC_MCP_NODE);
  ensureNode(MONTAR_MCP_NODE);
  console.log('✏️  Nós MCP garantidos');

  // 5. Conexões:
  //   Extrair Query Ferramenta → IF É Tool MCP?
  //   IF É Tool MCP? [true]  → Executar Tool MCP → Montar Tool Result MCP → OpenRouter Com Ferramenta
  //   IF É Tool MCP? [false] → Gerar Embedding Ferramenta (caminho antigo)

  // Remove conexões antigas saindo de Extrair Query Ferramenta
  delete connections['Extrair Query Ferramenta'];
  connections['Extrair Query Ferramenta'] = {
    main: [[ { node: 'IF É Tool MCP?', type: 'main', index: 0 } ]]
  };

  connections['IF É Tool MCP?'] = {
    main: [
      [ { node: 'Executar Tool MCP', type: 'main', index: 0 } ],   // true
      [ { node: 'Gerar Embedding Ferramenta', type: 'main', index: 0 } ], // false
    ]
  };

  connections['Executar Tool MCP'] = {
    main: [[ { node: 'Montar Tool Result MCP', type: 'main', index: 0 } ]]
  };

  connections['Montar Tool Result MCP'] = {
    main: [[ { node: 'OpenRouter Com Ferramenta', type: 'main', index: 0 } ]]
  };

  console.log('✏️  Conexões atualizadas');

  // 6. PUT (apenas campos permitidos)
  const allowedSettings = ['executionOrder','saveManualExecutions','saveExecutionProgress','saveDataErrorExecution','saveDataSuccessExecution','timezone','executionTimeout','errorWorkflow','callerPolicy'];
  const cleanSettings = {};
  for (const k of allowedSettings) {
    if (wf.settings && wf.settings[k] !== undefined) cleanSettings[k] = wf.settings[k];
  }
  if (!cleanSettings.executionOrder) cleanSettings.executionOrder = 'v1';
  const payload = {
    name: wf.name,
    nodes: wf.nodes,
    connections: wf.connections,
    settings: cleanSettings,
  };
  await api.put(`/workflows/${WF_ID}`, payload);
  console.log('✅ Workflow atualizado.');
  console.log('\n🎯 Tools delivery_* agora disponíveis para o LLM quando persona for restaurant/deliverer.');
}

main().catch(e => {
  console.error('❌', e.response?.data ?? e.message);
  process.exit(1);
});

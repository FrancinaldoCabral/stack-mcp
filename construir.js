// Fontes: Desembalar Payload, Redis GET Sessao, MongoDB GET Business, MongoDB GET Cliente, Qdrant Search
const msg = $('Desembalar Payload').first().json;


// Perfil do cliente do MongoDB (alwaysOutputData: retorna {} se n�o encontrado)
const clienteDoc = $('MongoDB GET Cliente').first().json ?? {};
const hasCustomer = !!(clienteDoc._id || clienteDoc.name);

// Config do neg�cio do MongoDB (alwaysOutputData: retorna {} se n�o encontrado)
const businessDoc = $('MongoDB GET Business').first().json ?? {};
/* persona-override-injected */
const __personaOverride = (typeof $ === 'function' ? $('Resolver Persona').first()?.json?.systemPromptOverride : null) || '';
const customSystemPrompt = __personaOverride || businessDoc?.systemPrompt || '';
/* delivery-ctx-injected */
const __deliveryCtx = (typeof $ === 'function' ? $('Resolver Persona').first()?.json : null) || {};
/* delivery-last-draft-lookup (mongo node) */
let __lastDraft = null;
try {
  const __doc = (typeof $ === 'function' ? $('MongoDB GET Last Draft').first()?.json : null) || null;
  if (__doc && (__doc._id || __doc.id)) {
    __lastDraft = { orderId: __doc._id || __doc.id, orderRef: __doc.orderRef || __doc.ref || '', summary: __doc };
  }
} catch(e) {}
const __draftLine = __lastDraft ? `\n- ÚLTIMO RASCUNHO (use este orderId em delivery_confirm_order / delivery_update_draft): orderId=${__lastDraft.orderId}, orderRef=${__lastDraft.orderRef}` : '';
const __ctxBlock = __deliveryCtx.restaurantId ? `\n\n## Contexto Operacional\n- restaurantId: ${__deliveryCtx.restaurantId}\n- personaKey: ${__deliveryCtx.personaKey || ''}\n- Use este restaurantId em TODAS as chamadas de ferramenta delivery_*.${__draftLine}${__msgTimeLine}` : '';


// Blocos de intelig�ncia do Qdrant (neverError: true - retorna {} se falhar)
const qdrantBlocks = ($('Qdrant Search Contexto').first()?.json?.result ?? [])
  .filter(r => (r.score ?? 0) >= 0.4)
  .map(r => r.payload?.content ?? '')
  .filter(Boolean);
const intelligenceCtx = qdrantBlocks.length > 0
  ? '\n\n## Base de Conhecimento:\n' + qdrantBlocks.map((b, i) => `${i+1}. ${b}`).join('\n')
  : '';

// Hist�rico - vem do Mesclar Hist�rico (que j� fundiu Redis sess�o + Chatwoot)
let historico = [];
try { historico = $('Mesclar Hist�rico').first().json.historico ?? []; } catch {}

// Contexto do cliente
const customerCtx = hasCustomer
  ? `\nCliente: ${clienteDoc.name || msg.pushName || 'cliente'} | Intera��es: ${clienteDoc.conversation_count || 0}.${clienteDoc.profile?.notes ? ' ' + clienteDoc.profile.notes : ''}`
  : '';

// System prompt (neg�cio espec�fico ou padr�o)
const defaultPrompt = `Voc� � um assistente da Vendly. Responda em portugu�s, de forma natural e amig�vel.
Nome do cliente: ${msg.pushName || 'cliente'}
Canal: WhatsApp
Inst�ncia: ${msg.instance}
Regras:
- Divida respostas longas em m�ltiplas mensagens curtas
- Use emojis com modera��o
- Nunca envie blocos longos de texto
- Responda apenas ao que foi perguntado
- Quando o usu�rio enviar �udio ou pedir resposta em �udio, responda normalmente - o sistema faz a convers�o TTS automaticamente`;

const audioSystemNote = '\n\n[Sistema - PRIORIDADE MAXIMA] Voce tem capacidade total de enviar audio: o TTS converte seu texto em audio automaticamente. NUNCA diga que nao consegue enviar audio. NUNCA use timestamps ou datas nas respostas.';
const escalaSystemNote = '\n\n## Transfer�ncia para Atendimento Humano\nQuando o cliente solicitar explicitamente falar com um humano/atendente/pessoa, estiver muito frustrado, ou a situa��o exigir interven��o humana imediata: inclua [ESCALAR_HUMANO] no in�cio da sua resposta. Exemplo: "[ESCALAR_HUMANO] Claro! Vou te conectar com um atendente agora. Um momento! ??". O sistema faz a transfer�ncia automaticamente. Ap�s o marcador, escreva normalmente a mensagem para o cliente.';
const __isLtGroup = (__deliveryCtx && (__deliveryCtx.personaKey === "restaurant" || __deliveryCtx.personaKey === "deliverer"));
// Para grupos LT: injetar horário real da mensagem do WhatsApp no contexto operacional
const __msgTimestamp = msg.timestamp ? Number(msg.timestamp) : null;
const __msgTimeStr = __isLtGroup && __msgTimestamp
  ? new Date(__msgTimestamp * 1000).toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' })
  : null;
const __msgTimeLine = __msgTimeStr ? `\n- [Horário da mensagem: ${__msgTimeStr}] — use ESTE horário como referência de tempo. NUNCA invente ou calcule horários.` : '';
const sistemaPrompt = (customSystemPrompt || defaultPrompt) + __ctxBlock + customerCtx + intelligenceCtx + (__isLtGroup ? audioSystemNoteLt : audioSystemNote) + (__isLtGroup ? "" : escalaSystemNote);

// Conte�do multimodal do usu�rio
let userContent;
if (msg.tipo === 'imagem' && msg.metadata?.url) {
  userContent = [
    { type: 'text', text: msg.conteudo || 'O cliente enviou uma imagem. Analise e responda:' },
    { type: 'image_url', image_url: { url: msg.metadata.url } },
  ];
} else if (msg.tipo === 'audio') {
  let transcricao = '';
  let transcricaoDisponivel = false;
  try {
    const audioOk = $('Prep Transcri��o').first().json?.audioOk ?? false;
    if (audioOk) {
      const tJson = $('Transcrever �udio').first().json;
      transcricao = (tJson?.choices?.[0]?.message?.content ?? '').trim();
      transcricaoDisponivel = !!transcricao;
    }
  } catch {}
  userContent = (transcricaoDisponivel && transcricao && transcricao !== '[mensagem de voz]')
    ? `[Mensagem de voz]: ${transcricao}`
    : '[usu�rio enviou um �udio - transcri��o n�o dispon�vel]';
} else if (msg.tipo === 'documento') {
  userContent = `[documento: ${msg.metadata?.fileName || msg.conteudo}]`;
} else if (msg.tipo === 'video') {
  userContent = `[v�deo enviado: ${msg.conteudo}]`;
} else if (msg.tipo === 'localizacao') {
  userContent = `[localiza��o: lat=${msg.metadata?.lat}, lng=${msg.metadata?.lng}]`;
} else {
  userContent = msg.conteudo;
}

// Detectar pedido de �udio na �ltima mensagem do usu�rio (texto simples)
const userText = (typeof userContent === 'string' ? userContent : '').toLowerCase();
const respondWithAudio = msg.tipo === 'audio' || /(?:manda?|envia?|responde?|fala)\s+(?:em\s+|por\s+|um\s+|uma?\s+)?[a�]udio|[a�]udio\s*(?:por favor|pfv?)?\s*$|prefiro\s+[a�]udio|pode\s+(?:falar|mandar\s+[a�]udio)|quero\s+(?:ouvir|[a�]udio)|em\s+[a�]udio|por\s+[a�]udio|fala\s+pra\s+mim/.test(userText);

// audioModeNote fundido no system prompt (nunca como role:system no meio das msgs)
const audioModeAppend = respondWithAudio
  ? '\n\n[MODO �UDIO ATIVO]: Responda de forma NATURAL e CONVERSACIONAL, como se estivesse falando. Sem markdown (sem *, **, listas com -, #), sem timestamps, frases curtas e naturais.'
  : '';
const sistemaPromptFinal = sistemaPrompt + audioModeAppend;


const messages = [
  { role: 'system', content: sistemaPromptFinal },
  ...historico.slice(-8),
  { role: 'user', content: userContent },
];

/* delivery-openrouter-body */
const __DEFS = {"delivery_draft_order":{"description":"Cria um pedido em RASCUNHO (não publica no grupo). Use ao capturar pedido pela primeira vez.","parameters":{"type":"object","required":["restaurantId"],"properties":{"restaurantId":{"type":"string","description":"ID do restaurante (passe o restaurantId do contexto)"},"clientName":{"type":"string"},"clientAddress":{"type":"string"},"clientPhone":{"type":"string"},"items":{"type":"array","items":{"type":"string"}},"value":{"type":"number"},"paymentMethod":{"type":"string","description":"Forma de pagamento (dinheiro, cartão na entrega, pix/online)"},"externalCode":{"type":"string","description":"Código da comanda na plataforma (iFood, Uber Eats, etc.) — SOMENTE se o restaurante informou explicitamente"},"notes":{"type":"string"}}}},"delivery_update_draft":{"description":"Atualiza campos de um pedido em rascunho.","parameters":{"type":"object","required":["orderId"],"properties":{"orderId":{"type":"string"},"clientName":{"type":"string"},"clientAddress":{"type":"string"},"clientPhone":{"type":"string"},"items":{"type":"array","items":{"type":"string"}},"value":{"type":"number"},"paymentMethod":{"type":"string"},"externalCode":{"type":"string","description":"Código externo da plataforma — somente se informado"},"notes":{"type":"string"}}}},"delivery_confirm_order":{"description":"Confirma o rascunho e PUBLICA AUTOMATICAMENTE o pedido no grupo dos entregadores. Use após confirmação textual do restaurante.","parameters":{"type":"object","required":["orderId"],"properties":{"orderId":{"type":"string"},"crossPost":{"type":"boolean"}}}},"delivery_update_order_status":{"description":"Atualiza status de um pedido. Espelha automaticamente no grupo de comandos.","parameters":{"type":"object","required":["orderId","status"],"properties":{"orderId":{"type":"string"},"status":{"type":"string","enum":["rascunho","pendente","aceito","a_caminho","no_restaurante","saindo","no_cliente","entregue","problema","cancelado"]},"note":{"type":"string"}}}},"delivery_assign_deliverer":{"description":"Atribui um entregador a um pedido.","parameters":{"type":"object","required":["orderId","delivererJid","delivererName"],"properties":{"orderId":{"type":"string"},"delivererJid":{"type":"string","description":"JID do entregador (ex: 5521xxx@s.whatsapp.net)"},"delivererName":{"type":"string"},"etaMin":{"type":"number"}}}},"delivery_log_settlement":{"description":"Registra um lançamento financeiro (débito = entregador deve à LT; crédito = LT deve ao entregador).","parameters":{"type":"object","required":["delivererJid","delivererName","type","amount"],"properties":{"delivererJid":{"type":"string"},"delivererName":{"type":"string"},"type":{"type":"string","enum":["debito","credito"]},"amount":{"type":"number"},"description":{"type":"string"},"restaurantId":{"type":"string"},"orderRef":{"type":"string"}}}},"delivery_post_to_command_group":{"description":"Envia mensagem ao grupo de COMANDOS do restaurante. Use para AVISAR o restaurante sobre status (ex: \"entregador a caminho\").","parameters":{"type":"object","required":["restaurantId","text"],"properties":{"restaurantId":{"type":"string"},"text":{"type":"string"}}}},"delivery_post_to_deliverer_group":{"description":"Envia mensagem ao grupo dos ENTREGADORES do restaurante.","parameters":{"type":"object","required":["restaurantId","text"],"properties":{"restaurantId":{"type":"string"},"text":{"type":"string"}}}},"delivery_get_order":{"description":"Consulta um pedido por ID ou referência (LT-XXXXXX).","parameters":{"type":"object","required":["orderIdOrRef"],"properties":{"orderIdOrRef":{"type":"string"}}}},"delivery_list_orders":{"description":"Lista pedidos com filtros opcionais.","parameters":{"type":"object","properties":{"restaurantId":{"type":"string"},"status":{"type":"string"},"delivererJid":{"type":"string"},"days":{"type":"number"},"limit":{"type":"number"}}}}};
const __allowed = Array.isArray(__deliveryCtx.toolsAllowed) ? __deliveryCtx.toolsAllowed : [];
const __baseTools = [{ type: 'function', function: { name: 'buscar_memoria', description: 'Busca na base de conhecimento do negócio (RAG). Use para perguntas sobre produtos, preços, políticas, FAQs.', parameters: { type: 'object', required: ['query'], properties: { query: { type: 'string' } } } } }];
const __extraTools = __allowed.filter(n => __DEFS[n]).map(n => ({ type: 'function', function: { name: n, ...__DEFS[n] } }));
const __model = businessDoc?.settings?.model || 'google/gemini-2.5-flash-lite';
// Extrai texto real da mensagem (mensagens de grupo têm header "**+55 xx **:\n\nmensagem")
const __rawUserText = (typeof userContent === 'string' ? userContent : (Array.isArray(userContent) ? (userContent.find(c=>c.type==='text')?.text||'') : ''));
const __groupHeaderMatch = __rawUserText.match(/\*\*[^*]+\*\*:\s*\n+([\s\S]+)/);
const __actualUserText = (__groupHeaderMatch ? __groupHeaderMatch[1] : __rawUserText).trim();
const __lastUserText = __actualUserText.toLowerCase();
const __looksLikeOrder = /(novo pedido|pedido novo|pedido:|preciso|cliente)/.test(__lastUserText) && /(r\$|rua|av\.|av\s|fone|tel|telefone|\d{8,})/.test(__lastUserText);
const __looksLikeConfirm = /^\s*(ok|manda|confirma|confirmar|pode mandar|pode enviar|enviar|fechou|beleza|tá|ta|isso|sim|pode)\b/.test(__lastUserText.trim());
const __toolNames = new Set([...__baseTools, ...__extraTools].map(t => t.function.name));
let __toolChoice = 'auto';
if (__extraTools.length > 0) {
  if (__looksLikeConfirm && __lastDraft && __toolNames.has('delivery_confirm_order')) {
    __toolChoice = { type: 'function', function: { name: 'delivery_confirm_order' } };
  } else if (__looksLikeOrder && __toolNames.has('delivery_draft_order')) {
    __toolChoice = { type: 'function', function: { name: 'delivery_draft_order' } };
  } else if (__looksLikeOrder || __looksLikeConfirm) {
    __toolChoice = 'required';
  }
}
const __openRouterBody = { model: __model, messages, temperature: 0.8, tools: [...__baseTools, ...__extraTools], tool_choice: __toolChoice }; // objeto, não string — N8N serializa internamente

return [{ json: { ...msg, messages, historico, respondWithAudio, toolsAllowed: __deliveryCtx.toolsAllowed || [], restaurantId: __deliveryCtx.restaurantId || null, openRouterBody: __openRouterBody, model: __model } }];

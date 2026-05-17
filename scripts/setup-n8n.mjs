/**
 * FASE 1 + 7 — Criar workflows N8N via MCP
 */

const MCP_URL = 'http://fco8og80s4sw4c0wc0ogswws.157.173.111.65.sslip.io/mcp';
const N8N_WEBHOOK_BASE = process.env.N8N_WEBHOOK_BASE ?? 'https://n8n.vendly.chat';

async function http_post(body) {
  const { request } = await import('node:http');
  return new Promise((resolve, reject) => {
    const b = JSON.stringify(body);
    const u = new URL(MCP_URL);
    const opt = {
      hostname: u.hostname, port: 80, path: '/mcp', method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json, text/event-stream', 'Content-Length': Buffer.byteLength(b) }
    };
    const req = request(opt, r => {
      let d = '';
      r.on('data', c => d += c);
      r.on('end', () => {
        if (!d.trim()) return resolve(null);
        const lines = d.split('\n').filter(l => l.startsWith('data: '));
        try { resolve(lines.length ? JSON.parse(lines[0].slice(6)) : JSON.parse(d)); }
        catch { resolve(null); }
      });
    });
    req.on('error', reject);
    req.write(b); req.end();
  });
}

async function tool(name, args) {
  await http_post({ jsonrpc: '2.0', id: 0, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'setup', version: '1.0' } } });
  await http_post({ jsonrpc: '2.0', method: 'notifications/initialized', params: {} });
  const res = await http_post({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } });
  if (res?.error) throw new Error(JSON.stringify(res.error));
  const text = res?.result?.content?.[0]?.text ?? JSON.stringify(res?.result);
  return JSON.parse(text);
}

function log(msg) { process.stdout.write(msg + '\n'); }
function ok(label) { log(`  ✅ ${label}`); }
function err(label, e) { log(`  ❌ ${label}: ${e?.message ?? e}`); }
function section(title) { log(`\n── ${title} ${'─'.repeat(50 - title.length)}`); }

// ── Workflow 1: [CORE] Entrada de Mensagem ─────────────────────────────────
const workflowEntrada = {
  name: '[CORE] Entrada de Mensagem',
  active: false,
  nodes: [
    {
      id: 'webhook-evolution',
      name: 'Webhook Evolution',
      type: 'n8n-nodes-base.webhook',
      typeVersion: 2,
      position: [240, 300],
      parameters: {
        path: 'evolution',
        httpMethod: 'POST',
        responseMode: 'responseNode',
        options: {}
      }
    },
    {
      id: 'filtrar-mensagem',
      name: 'Filtrar Mensagem',
      type: 'n8n-nodes-base.code',
      typeVersion: 2,
      position: [460, 300],
      parameters: {
        jsCode: `// Ignorar mensagens do próprio bot e tipos irrelevantes
const data = $input.first().json;
const fromMe = data?.data?.key?.fromMe;
const tipo = Object.keys(data?.data?.message ?? {})[0];
const tiposIgnorar = ['protocolMessage', 'senderKeyDistributionMessage', 'reactionMessage'];

if (fromMe || tiposIgnorar.includes(tipo)) {
  return []; // para o workflow
}

const remoteJid = data?.data?.key?.remoteJid ?? '';
const telefone = remoteJid.replace('@s.whatsapp.net', '').replace('@g.us', '');
const mensagem = data?.data?.message?.conversation
  || data?.data?.message?.extendedTextMessage?.text
  || null;

return [{
  json: {
    instance: data.instance,
    telefone,
    remoteJid,
    mensagem,
    tipo_midia: tipo,
    timestamp: data?.data?.messageTimestamp ?? Date.now(),
    raw: data
  }
}];`
      }
    },
    {
      id: 'buscar-business',
      name: 'Buscar Business no Redis',
      type: 'n8n-nodes-base.code',
      typeVersion: 2,
      position: [680, 300],
      parameters: {
        jsCode: `// Busca config do business pelo nome da instance
// Primeiro tenta Redis, fallback para MongoDB
const { instance, telefone } = $input.first().json;

// Esta função será expandida para chamar o MCP
// Por ora, usa a instance como business_id diretamente
return [{
  json: {
    ...$input.first().json,
    business_id: instance,
    debounce_segundos: 8
  }
}];`
      }
    },
    {
      id: 'adicionar-buffer',
      name: 'Adicionar ao Buffer Redis',
      type: 'n8n-nodes-base.httpRequest',
      typeVersion: 4.2,
      position: [900, 300],
      parameters: {
        method: 'POST',
        url: `${N8N_WEBHOOK_BASE}/webhook/mcp-redis-rpush`,
        sendBody: true,
        contentType: 'json',
        body: {
          key: `={{ "buffer:" + $json.business_id + ":" + $json.telefone }}`,
          values: [`={{ JSON.stringify({conteudo: $json.mensagem, tipo: $json.tipo_midia, timestamp: $json.timestamp}) }}`]
        },
        options: {}
      }
    },
    {
      id: 'respond-ok',
      name: 'Responder OK',
      type: 'n8n-nodes-base.respondToWebhook',
      typeVersion: 1,
      position: [1120, 300],
      parameters: {
        respondWith: 'text',
        responseBody: 'OK'
      }
    }
  ],
  connections: {
    'Webhook Evolution': { main: [[{ node: 'Filtrar Mensagem', type: 'main', index: 0 }]] },
    'Filtrar Mensagem': { main: [[{ node: 'Buscar Business no Redis', type: 'main', index: 0 }]] },
    'Buscar Business no Redis': { main: [[{ node: 'Adicionar ao Buffer Redis', type: 'main', index: 0 }]] },
    'Adicionar ao Buffer Redis': { main: [[{ node: 'Responder OK', type: 'main', index: 0 }]] }
  }
};

// ── Workflow 2: [CORE] Processar Buffer (Debounce) ─────────────────────────
const workflowDebounce = {
  name: '[CORE] Processar Buffer (Debounce)',
  active: false,
  nodes: [
    {
      id: 'webhook-debounce',
      name: 'Webhook Debounce',
      type: 'n8n-nodes-base.webhook',
      typeVersion: 2,
      position: [240, 300],
      parameters: {
        path: 'debounce-trigger',
        httpMethod: 'POST',
        responseMode: 'lastNode',
        options: {}
      }
    },
    {
      id: 'ler-buffer',
      name: 'Ler Buffer Redis',
      type: 'n8n-nodes-base.code',
      typeVersion: 2,
      position: [460, 300],
      parameters: {
        jsCode: `// Recebe {business_id, telefone} do trigger de expiração
const { business_id, telefone } = $input.first().json;
return [{ json: { business_id, telefone, bufferKey: \`buffer:\${business_id}:\${telefone}\` } }];`
      }
    },
    {
      id: 'consolidar-mensagens',
      name: 'Consolidar Mensagens',
      type: 'n8n-nodes-base.code',
      typeVersion: 2,
      position: [680, 300],
      parameters: {
        jsCode: `// Consolida todas as mensagens do buffer em um único texto
const items = $input.all();
const mensagens = items
  .map(i => { try { return JSON.parse(i.json?.content ?? i.json); } catch { return i.json; } })
  .filter(m => m?.conteudo)
  .map(m => m.conteudo);

const input_consolidado = mensagens.join('\\n');

return [{
  json: {
    ...$input.first().json,
    input_consolidado,
    total_mensagens: mensagens.length
  }
}];`
      }
    },
    {
      id: 'publicar-stream',
      name: 'Publicar no Stream Redis',
      type: 'n8n-nodes-base.httpRequest',
      typeVersion: 4.2,
      position: [900, 300],
      parameters: {
        method: 'POST',
        url: `${N8N_WEBHOOK_BASE}/webhook/mcp-xadd`,
        sendBody: true,
        contentType: 'json',
        body: {
          stream: `={{ "events:" + $json.business_id }}`,
          fields: {
            tipo: 'message',
            telefone: `={{ $json.telefone }}`,
            conteudo: `={{ $json.input_consolidado }}`,
            timestamp: `={{ Date.now() }}`
          },
          maxlen: 1000
        },
        options: {}
      }
    },
    {
      id: 'chamar-agente',
      name: 'Chamar Agente (sub-workflow)',
      type: 'n8n-nodes-base.httpRequest',
      typeVersion: 4.2,
      position: [1120, 300],
      parameters: {
        method: 'POST',
        url: `${N8N_WEBHOOK_BASE}/webhook/agent-executor`,
        sendBody: true,
        contentType: 'json',
        body: {
          business_id: `={{ $json.business_id }}`,
          telefone: `={{ $json.telefone }}`,
          input: `={{ $json.input_consolidado }}`
        },
        options: {}
      }
    }
  ],
  connections: {
    'Webhook Debounce': { main: [[{ node: 'Ler Buffer Redis', type: 'main', index: 0 }]] },
    'Ler Buffer Redis': { main: [[{ node: 'Consolidar Mensagens', type: 'main', index: 0 }]] },
    'Consolidar Mensagens': { main: [[{ node: 'Publicar no Stream Redis', type: 'main', index: 0 }]] },
    'Publicar no Stream Redis': { main: [[{ node: 'Chamar Agente (sub-workflow)', type: 'main', index: 0 }]] }
  }
};

// ── Workflow 3: [AGENT] Executor ───────────────────────────────────────────
const workflowAgente = {
  name: '[AGENT] Executor',
  active: false,
  nodes: [
    {
      id: 'webhook-agent',
      name: 'Webhook Agent',
      type: 'n8n-nodes-base.webhook',
      typeVersion: 2,
      position: [240, 300],
      parameters: {
        path: 'agent-executor',
        httpMethod: 'POST',
        responseMode: 'lastNode',
        options: {}
      }
    },
    {
      id: 'carregar-contexto',
      name: 'Carregar Contexto',
      type: 'n8n-nodes-base.code',
      typeVersion: 2,
      position: [460, 300],
      parameters: {
        jsCode: `// Carrega sessão e histórico do Redis
// TODO: integrar com MCP tools via HTTP requests paralelas
const { business_id, telefone, input } = $input.first().json;
return [{
  json: {
    business_id,
    telefone,
    input,
    sessao_key: \`sessao:\${business_id}:\${telefone}\`,
    historico_key: \`historico:\${business_id}:\${telefone}\`
  }
}];`
      }
    },
    {
      id: 'chamar-anthropic',
      name: 'Chamar Claude (Anthropic)',
      type: 'n8n-nodes-base.httpRequest',
      typeVersion: 4.2,
      position: [680, 300],
      parameters: {
        method: 'POST',
        url: 'https://api.anthropic.com/v1/messages',
        authentication: 'genericCredentialType',
        genericAuthType: 'httpHeaderAuth',
        sendHeaders: true,
        headerParameters: {
          parameters: [
            { name: 'anthropic-version', value: '2023-06-01' },
            { name: 'x-api-key', value: '={{ $credentials.value }}' }
          ]
        },
        sendBody: true,
        contentType: 'json',
        body: {
          model: 'claude-sonnet-4-20250514',
          max_tokens: 1024,
          system: 'Você é um assistente inteligente de atendimento. Responda de forma natural e útil.',
          messages: [{ role: 'user', content: `={{ $json.input }}` }]
        },
        options: {}
      }
    },
    {
      id: 'extrair-resposta',
      name: 'Extrair Resposta',
      type: 'n8n-nodes-base.code',
      typeVersion: 2,
      position: [900, 300],
      parameters: {
        jsCode: `const resposta = $input.first().json?.content?.[0]?.text ?? '';
return [{
  json: {
    ...$('Carregar Contexto').first().json,
    resposta_agente: resposta
  }
}];`
      }
    },
    {
      id: 'enviar-whatsapp',
      name: 'Enviar via Evolution MCP',
      type: 'n8n-nodes-base.httpRequest',
      typeVersion: 4.2,
      position: [1120, 300],
      parameters: {
        method: 'POST',
        url: `${N8N_WEBHOOK_BASE}/webhook/mcp-evolution-send`,
        sendBody: true,
        contentType: 'json',
        body: {
          business_id: `={{ $json.business_id }}`,
          telefone: `={{ $json.telefone }}`,
          mensagem: `={{ $json.resposta_agente }}`
        },
        options: {}
      }
    }
  ],
  connections: {
    'Webhook Agent': { main: [[{ node: 'Carregar Contexto', type: 'main', index: 0 }]] },
    'Carregar Contexto': { main: [[{ node: 'Chamar Claude (Anthropic)', type: 'main', index: 0 }]] },
    'Chamar Claude (Anthropic)': { main: [[{ node: 'Extrair Resposta', type: 'main', index: 0 }]] },
    'Extrair Resposta': { main: [[{ node: 'Enviar via Evolution MCP', type: 'main', index: 0 }]] }
  }
};

// ── Workflow 4: [ADMIN] Provisionar Negócio ────────────────────────────────
const workflowOnboarding = {
  name: '[ADMIN] Provisionar Negócio',
  active: false,
  nodes: [
    {
      id: 'webhook-onboarding',
      name: 'Webhook Onboarding',
      type: 'n8n-nodes-base.webhook',
      typeVersion: 2,
      position: [240, 300],
      parameters: {
        path: 'onboarding',
        httpMethod: 'POST',
        responseMode: 'lastNode',
        options: {}
      }
    },
    {
      id: 'gerar-ids',
      name: 'Gerar IDs e Validar',
      type: 'n8n-nodes-base.code',
      typeVersion: 2,
      position: [460, 300],
      parameters: {
        jsCode: `const crypto = require('crypto');
const { nome, plano, telefone_gestor, segmento } = $input.first().json;

if (!nome || !plano) throw new Error('nome e plano são obrigatórios');

const business_id = 'biz_' + crypto.randomBytes(4).toString('hex');

return [{
  json: {
    business_id,
    nome,
    plano,
    telefone_gestor,
    segmento: segmento ?? 'geral',
    mongodb_database: business_id,
    evolution_instance: business_id,
    status: 'ativo',
    config: {
      debounce_segundos: 8,
      timeout_objetivo_horas: 48,
      idioma: 'pt-BR',
      timezone: 'America/Sao_Paulo',
      escalada_automatica: true,
      threshold_escalada_percent: 30
    },
    agentes: {
      temperatura: 0.7,
      modelo: 'claude-sonnet-4-20250514'
    },
    criado_em: new Date().toISOString(),
    vencimento: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
  }
}];`
      }
    },
    {
      id: 'criar-instance-evolution',
      name: 'Criar Instance Evolution',
      type: 'n8n-nodes-base.httpRequest',
      typeVersion: 4.2,
      position: [680, 300],
      parameters: {
        method: 'POST',
        url: `${N8N_WEBHOOK_BASE}/webhook/mcp-evolution-create`,
        sendBody: true,
        contentType: 'json',
        body: {
          business_id: `={{ $json.business_id }}`,
          instance_name: `={{ $json.evolution_instance }}`
        },
        options: {}
      }
    },
    {
      id: 'criar-indexes-mongo',
      name: 'Criar Indexes MongoDB',
      type: 'n8n-nodes-base.httpRequest',
      typeVersion: 4.2,
      position: [900, 300],
      parameters: {
        method: 'POST',
        url: `${N8N_WEBHOOK_BASE}/webhook/mcp-mongo-setup`,
        sendBody: true,
        contentType: 'json',
        body: {
          business_id: `={{ $json.business_id }}`,
          database: `={{ $json.mongodb_database }}`
        },
        options: {}
      }
    },
    {
      id: 'registrar-business',
      name: 'Registrar em admin.businesses',
      type: 'n8n-nodes-base.httpRequest',
      typeVersion: 4.2,
      position: [1120, 300],
      parameters: {
        method: 'POST',
        url: `${N8N_WEBHOOK_BASE}/webhook/mcp-mongo-insert`,
        sendBody: true,
        contentType: 'json',
        body: {
          database: 'admin',
          collection: 'businesses',
          document: `={{ $json }}`
        },
        options: {}
      }
    },
    {
      id: 'criar-redis-stream',
      name: 'Criar Redis Stream',
      type: 'n8n-nodes-base.httpRequest',
      typeVersion: 4.2,
      position: [1340, 300],
      parameters: {
        method: 'POST',
        url: `${N8N_WEBHOOK_BASE}/webhook/mcp-xgroup-create`,
        sendBody: true,
        contentType: 'json',
        body: {
          stream: `={{ "events:" + $json.business_id }}`,
          group: 'knowledge_consumer',
          mkstream: true
        },
        options: {}
      }
    },
    {
      id: 'responder-onboarding',
      name: 'Responder com business_id',
      type: 'n8n-nodes-base.respondToWebhook',
      typeVersion: 1,
      position: [1560, 300],
      parameters: {
        respondWith: 'json',
        responseBody: `={{ JSON.stringify({ success: true, business_id: $('Gerar IDs e Validar').first().json.business_id }) }}`
      }
    }
  ],
  connections: {
    'Webhook Onboarding': { main: [[{ node: 'Gerar IDs e Validar', type: 'main', index: 0 }]] },
    'Gerar IDs e Validar': { main: [[{ node: 'Criar Instance Evolution', type: 'main', index: 0 }]] },
    'Criar Instance Evolution': { main: [[{ node: 'Criar Indexes MongoDB', type: 'main', index: 0 }]] },
    'Criar Indexes MongoDB': { main: [[{ node: 'Registrar em admin.businesses', type: 'main', index: 0 }]] },
    'Registrar em admin.businesses': { main: [[{ node: 'Criar Redis Stream', type: 'main', index: 0 }]] },
    'Criar Redis Stream': { main: [[{ node: 'Responder com business_id', type: 'main', index: 0 }]] }
  }
};

// ── Workflow 5: [OBJECTIVES] Manager ──────────────────────────────────────
const workflowObjectives = {
  name: '[OBJECTIVES] Manager',
  active: false,
  nodes: [
    {
      id: 'webhook-objectives',
      name: 'Webhook Objectives',
      type: 'n8n-nodes-base.webhook',
      typeVersion: 2,
      position: [240, 300],
      parameters: {
        path: 'objectives-manager',
        httpMethod: 'POST',
        responseMode: 'lastNode',
        options: {}
      }
    },
    {
      id: 'processar-objetivo',
      name: 'Processar Ação do Objetivo',
      type: 'n8n-nodes-base.code',
      typeVersion: 2,
      position: [460, 300],
      parameters: {
        jsCode: `const { action, business_id, telefone, tipo, gatilho, objetivo_id, etapa, desfecho } = $input.first().json;
const crypto = require('crypto');

const etapasPorTipo = {
  venda: ['qualificacao', 'apresentacao', 'proposta', 'fechamento'],
  suporte: ['identificacao', 'diagnostico', 'resolucao'],
  agendamento: ['verificacao_disponibilidade', 'confirmacao', 'registro'],
  cadastro: ['coleta_dados', 'validacao', 'registro'],
  reengajamento: ['contato', 'oferta', 'decisao']
};

const agentesPorTipo = {
  venda: 'vendas', suporte: 'suporte',
  agendamento: 'agendamento', cadastro: 'cadastro', reengajamento: 'vendas'
};

if (action === 'abrir') {
  const novo_objetivo_id = 'obj_' + crypto.randomBytes(4).toString('hex');
  const etapas = (etapasPorTipo[tipo] ?? ['execucao']).map(nome => ({
    nome, status: 'pendente', iniciada_em: null, concluida_em: null
  }));
  return [{
    json: {
      action,
      business_id,
      objetivo: {
        objetivo_id: novo_objetivo_id,
        telefone,
        tipo,
        status: 'aberto',
        gatilho,
        etapas,
        agente_responsavel: agentesPorTipo[tipo] ?? 'roteador',
        ferramentas_usadas: [],
        tempo_inicio: new Date().toISOString(),
        desfecho: null
      }
    }
  }];
}

if (action === 'concluir' || action === 'abandonar' || action === 'escalar') {
  return [{
    json: {
      action,
      business_id,
      objetivo_id,
      update: {
        status: action === 'concluir' ? 'concluido' : action === 'escalar' ? 'escalado' : 'abandonado',
        desfecho: desfecho ?? action,
        tempo_fim: new Date().toISOString()
      }
    }
  }];
}

return [{ json: $input.first().json }];`
      }
    }
  ],
  connections: {
    'Webhook Objectives': { main: [[{ node: 'Processar Ação do Objetivo', type: 'main', index: 0 }]] }
  }
};

// ── Main: criar todos os workflows ───────────────────────────────────────────
section('FASE 1+7 — N8N Workflows');

const workflows = [
  workflowEntrada,
  workflowDebounce,
  workflowAgente,
  workflowOnboarding,
  workflowObjectives,
];

for (const wf of workflows) {
  try {
    const res = await tool('n8n_create_workflow', {
      name: wf.name,
      nodes: wf.nodes,
      connections: wf.connections,
      active: false,
    });
    ok(`"${wf.name}" — id: ${res?.id}`);
  } catch (e) {
    err(`"${wf.name}"`, e);
  }
}

log('\n✅ Workflows criados.\n');
log('⚠️  Próximos passos:');
log('   1. Configurar credencial Anthropic no N8N');
log('   2. Configurar URL real do N8N nos HTTP Request nodes');
log('   3. Ativar workflows após configurar credenciais');
log('   4. Configurar webhook da Evolution API apontando para [CORE] Entrada de Mensagem');

# Plano de Implementação — Sistema de Atendimento Inteligente

**Versão:** 1.0
**Objetivo:** Guia completo para implementação por agentes de IA ou desenvolvedores.
**Premissa:** Evolution API, N8N, Chatwoot, MongoDB, Redis, Qdrant instalados e acessíveis.

---

# FASE 0 — Fundação de Dados

## 0.1 — MongoDB: Schemas e Indexes

Criar o database `admin` com a coleção de controle central. Todos os outros databases são criados dinamicamente no onboarding de cada negócio.

**Database: `admin`**

```js
// Collection: businesses
{
  _id: ObjectId(),
  business_id: "string único gerado no onboarding",
  nome: "string",
  plano: "starter | growth | scale",
  status: "ativo | suspenso | cancelado",
  evolution_instance: "string — nome da instance no Evolution API",
  chatwoot_account_id: "number",
  chatwoot_inbox_id: "number",
  n8n_project_id: "string",
  mongodb_database: "string — ex: biz_abc123",
  config: {
    debounce_segundos: 8,
    timeout_objetivo_horas: 48,
    idioma: "pt-BR",
    timezone: "America/Sao_Paulo",
    escalada_automatica: true,
    threshold_escalada_percent: 30
  },
  agentes: {
    system_prompt_base: "string",
    temperatura: 0.7,
    modelo: "claude-sonnet-4-20250514"
  },
  criado_em: ISODate(),
  vencimento: ISODate()
}
```

**Database por negócio: `biz_{business_id}`**

```js
// Collection: leads
{
  _id: ObjectId(),
  telefone: "string — remoteJid sem @s.whatsapp.net",
  nome: "string | null",
  perfil: {
    segmento: "string",
    tamanho_empresa: "string | null",
    historico_compras: [],
    score: 0
  },
  primeiro_contato: ISODate(),
  ultimo_contato: ISODate(),
  tags: []
}

// Collection: objectives
{
  _id: ObjectId(),
  objetivo_id: "string",
  telefone: "string",
  tipo: "venda | suporte | agendamento | cadastro | reengajamento | qualificacao",
  status: "aberto | em_andamento | concluido | abandonado | escalado",
  gatilho: "string",
  etapas: [
    { nome: "string", status: "pendente | em_andamento | concluida", iniciada_em: ISODate(), concluida_em: ISODate() }
  ],
  agente_responsavel: "string",
  atendente_humano_id: "number | null",
  ferramentas_usadas: [],
  desfecho: "string | null",
  tempo_inicio: ISODate(),
  tempo_fim: ISODate() | null,
  metadata: {}
}

// Collection: knowledge
{
  _id: ObjectId(),
  tipo: "resolucao | objection | script | gap | product | behavior | external",
  fonte: "human | agent | tool | objective | external",
  conteudo_raw: "string — texto original",
  conteudo_estruturado: {},
  desfecho_associado: "string | null",
  qdrant_id: "string — ID do ponto no Qdrant",
  relevancia: 0,
  criado_em: ISODate(),
  atualizado_em: ISODate()
}

// Collection: events
{
  _id: ObjectId(),
  evento_id: "string",
  tipo: "message | tool_call | tool_result | objective_transition | human_action | external",
  fonte: "string",
  telefone: "string",
  objetivo_id: "string | null",
  conteudo: {},
  resultado: "sucesso | falha | parcial | null",
  timestamp: ISODate()
}

// Collection: agent_prompts
{
  _id: ObjectId(),
  agente: "roteador | vendas | suporte | agendamento | cadastro | escalada | extrator | analitico",
  versao: "number",
  system_prompt: "string",
  tools_disponiveis: [],
  ativo: true,
  criado_em: ISODate()
}

// Collection: catalog
{
  _id: ObjectId(),
  nome: "string",
  descricao: "string",
  preco: "number | null",
  categoria: "string",
  atributos: {},
  qdrant_id: "string"
}
```

**Indexes obrigatórios:**
```js
db.leads.createIndex({ telefone: 1 })
db.objectives.createIndex({ telefone: 1, status: 1 })
db.objectives.createIndex({ status: 1, tempo_inicio: -1 })
db.events.createIndex({ telefone: 1, timestamp: -1 })
db.events.createIndex({ objetivo_id: 1 })
db.knowledge.createIndex({ tipo: 1, fonte: 1 })
```

---

## 0.2 — Redis: Estrutura de Chaves

Toda chave segue o padrão: `{prefixo}:{business_id}:{identificador}`

```
# Buffer de mensagens (debounce)
buffer:{business_id}:{telefone}           → List de mensagens    TTL: debounce_segundos

# Sessão ativa da conversa
sessao:{business_id}:{telefone}           → JSON da sessão       TTL: 24h
  {
    agente_ativo: string,
    objetivo_id: string,
    turno: number,
    dados_parciais: {},
    aguardando: string | null
  }

# Histórico recente (contexto quente)
historico:{business_id}:{telefone}        → List JSON            TTL: 24h
  Máximo 20 itens. Cada item: { role, content, timestamp }

# Lock de processamento (evita race condition)
lock:{business_id}:{telefone}             → "1"                  TTL: 30s

# Contadores de uso mensal
uso:{business_id}:{YYYY-MM}:mensagens     → number               TTL: 60 dias
uso:{business_id}:{YYYY-MM}:objetivos     → number               TTL: 60 dias

# Fila de eventos para o pipeline de conhecimento
Stream: events:{business_id}             → Redis Stream

# Cache de configuração do negócio
config:{business_id}                     → JSON da config        TTL: 1h
```

---

## 0.3 — Qdrant: Collections

Criar todas as collections com dimensão 1536 (OpenAI text-embedding-3-small) ou 768 se usar modelo local.

```python
# Executar via API REST do Qdrant ou SDK

collections = [
  "messages",        # toda mensagem de usuário
  "agent_responses", # respostas de agentes com desfecho
  "human_actions",   # intervenções humanas
  "tool_patterns",   # sequências de ferramentas por desfecho
  "objective_flows", # trajetórias completas de objetivos
  "product_context", # catálogo + perguntas associadas
  "user_profiles",   # comportamento agregado por perfil
  "external_signals" # eventos externos correlacionados
]

# Payload obrigatório em todos os pontos:
{
  business_id: string,
  tipo: string,
  fonte: string,
  desfecho: string | null,
  mongodb_id: string,
  telefone: string | null,
  timestamp: string,
  tags: []
}
```

---

# FASE 1 — Orquestrador Central no N8N

## 1.1 — Webhook de Entrada (Evolution API → N8N)

Criar workflow `[CORE] Entrada de Mensagem`.

**Trigger:** Webhook POST `/webhook/evolution`

**Passo 1 — Extrair dados do payload Evolution:**
```js
// O payload da Evolution API tem esta estrutura:
const instance = $json.instance                          // nome da instance
const remoteJid = $json.data.key.remoteJid              // telefone@s.whatsapp.net
const telefone = remoteJid.replace("@s.whatsapp.net","")
const mensagem = $json.data.message?.conversation 
              || $json.data.message?.extendedTextMessage?.text
              || null
const tipo_midia = Object.keys($json.data.message || {})[0]
const timestamp = $json.data.messageTimestamp

// Ignorar se não for mensagem de texto ou mídia relevante
// Ignorar mensagens do próprio bot (fromMe: true)
if ($json.data.key.fromMe) return null
if (!mensagem && tipo_midia === "protocolMessage") return null
```

**Passo 2 — Identificar o negócio:**
```js
// Buscar no MongoDB admin.businesses pelo evolution_instance
// Usar cache Redis primeiro:
// GET config:{business_id} 
// Se não existir, buscar MongoDB e salvar no Redis com TTL 1h

const business = await redis.get(`config:${instance}`) 
  || await mongo.admin.businesses.findOne({ evolution_instance: instance })
```

**Passo 3 — Verificar lock:**
```js
// Evita processar duas mensagens simultâneas do mesmo usuário
const lockKey = `lock:${business_id}:${telefone}`
const locked = await redis.get(lockKey)
if (locked) {
  // Aguardar 1s e tentar novamente (máx 3 tentativas)
  // Se ainda locked após 3s, adicionar ao buffer e encerrar
}
await redis.set(lockKey, "1", "EX", 30)
```

**Passo 4 — Buffer e Debounce:**
```js
const bufferKey = `buffer:${business_id}:${telefone}`

// Adicionar mensagem ao buffer
await redis.rpush(bufferKey, JSON.stringify({
  conteudo: mensagem,
  tipo: tipo_midia,
  timestamp
}))

// Resetar TTL do buffer
await redis.expire(bufferKey, business.config.debounce_segundos)

// Publicar no stream de eventos para o consumer de debounce
await redis.xadd(`events:${business_id}`, "*", {
  tipo: "message_buffered",
  telefone,
  timestamp
})

// Encerrar aqui. O consumer de debounce processa quando o TTL expirar.
```

---

## 1.2 — Consumer de Debounce (N8N Scheduled + Redis)

Criar workflow `[CORE] Consumer Debounce`.

**Trigger:** Schedule a cada 3 segundos.

**Lógica:**
```js
// Buscar todas as chaves buffer:* que expiraram (TTL = 0 ou inexistente)
// N8N não tem acesso direto a expiração de chaves Redis
// Solução: usar Redis keyspace notifications ou polling

// Estratégia de polling:
// 1. Buscar todas as sessões ativas: KEYS sessao:*
// 2. Para cada sessão, verificar se existe buffer correspondente
// 3. Se sessão existe mas buffer não existe mais → buffer expirou → processar

// OU (mais elegante):
// Usar Redis Stream como fila de trabalho
// Quando buffer expira (TTL), um N8N webhook é chamado via
// Redis keyspace notification configurado no redis.conf:
// notify-keyspace-events Ex

// O N8N escuta o webhook de expiração e dispara o processamento
```

**Configurar no redis.conf:**
```
notify-keyspace-events "Ex"
```

**Criar subscriber no N8N ou via script Node.js auxiliar que chama webhook N8N quando chave `buffer:*` expira.**

**Quando buffer expira — Processar:**
```js
// 1. Ler todo o buffer
const mensagens = await redis.lrange(bufferKey, 0, -1)
const input_consolidado = mensagens
  .map(m => JSON.parse(m))
  .map(m => m.conteudo)
  .filter(Boolean)
  .join("\n")

// 2. Carregar contexto
const sessao = await redis.get(`sessao:${business_id}:${telefone}`)
const historico = await redis.lrange(`historico:${business_id}:${telefone}`, 0, -1)
const lead = await mongo.findOne(`biz_${business_id}`, "leads", { telefone })

// 3. Montar pacote de contexto e passar para o Roteador
// 4. Publicar evento no Stream
await redis.xadd(`events:${business_id}`, "*", {
  tipo: "message",
  telefone,
  conteudo: input_consolidado,
  timestamp: Date.now()
})

// 5. Liberar lock
await redis.del(lockKey)
```

---

## 1.3 — Montagem de Contexto RAG

Criar função reutilizável `[UTIL] Montar Contexto RAG`.

```js
async function montarContexto(business_id, telefone, input_usuario) {
  
  // 1. Embeddar o input do usuário
  const embedding = await openai.embeddings.create({
    model: "text-embedding-3-small",
    input: input_usuario
  })
  
  // 2. Buscar em paralelo no Qdrant
  const [msgs, respostas, produtos, fluxos, perfil] = await Promise.all([
    qdrant.search("messages", { vector: embedding, limit: 3, filter: { business_id } }),
    qdrant.search("agent_responses", { vector: embedding, limit: 3, filter: { business_id, desfecho: "sucesso" } }),
    qdrant.search("product_context", { vector: embedding, limit: 3, filter: { business_id } }),
    qdrant.search("objective_flows", { vector: embedding, limit: 2, filter: { business_id, desfecho: "convertido" } }),
    qdrant.search("user_profiles", { vector: embedding, limit: 1, filter: { business_id, telefone } })
  ])
  
  // 3. Carregar histórico recente do Redis
  const historico = await redis.lrange(`historico:${business_id}:${telefone}`, -10, -1)
  
  // 4. Carregar sessão e objetivo atual
  const sessao = JSON.parse(await redis.get(`sessao:${business_id}:${telefone}`) || "{}")
  const objetivo = sessao.objetivo_id 
    ? await mongo.findOne(`biz_${business_id}`, "objectives", { objetivo_id: sessao.objetivo_id })
    : null
  
  // 5. Carregar system prompt do negócio
  const config = JSON.parse(await redis.get(`config:${business_id}`))
  const prompt_agente = await mongo.findOne(`biz_${business_id}`, "agent_prompts", { 
    agente: sessao.agente_ativo || "roteador", 
    ativo: true 
  })
  
  return {
    system_prompt: config.agentes.system_prompt_base + "\n\n" + prompt_agente.system_prompt,
    conhecimento_relevante: { msgs, respostas, produtos, fluxos, perfil },
    historico_recente: historico.map(h => JSON.parse(h)),
    sessao,
    objetivo,
    input_usuario
  }
}
```

---

# FASE 2 — Agentes

## 2.1 — System Prompts Base

Criar na coleção `agent_prompts` de cada negócio.

**Agente Roteador:**
```
Você é o roteador de conversas. Analise a mensagem do usuário, o histórico e o estado atual.
Retorne APENAS um JSON com:
{
  "agente": "vendas | suporte | agendamento | cadastro | escalada",
  "objetivo_tipo": "venda | suporte | agendamento | cadastro | reengajamento | qualificacao",
  "objetivo_novo": true | false,
  "urgencia": "baixa | media | alta",
  "resumo_contexto": "string curta para o agente especialista",
  "continuar_objetivo": true | false
}
Não responda ao usuário. Apenas roteie.
```

**Agente Vendas:**
```
Você é um especialista em vendas conversacionais via WhatsApp.
Seu objetivo atual: {objetivo_atual}
Contexto do negócio: {system_prompt_base}

Conhecimento relevante disponível:
{conhecimento_relevante}

Histórico da conversa:
{historico_recente}

Dados do lead:
{perfil_lead}

Regras:
- Responda de forma natural, como uma pessoa real responderia no WhatsApp
- Use o conhecimento disponível para personalizar sua abordagem
- Se encontrar objeção, busque no conhecimento respostas que funcionaram
- Declare ferramentas que precisa chamar em JSON: {"tool": "nome", "params": {}}
- Quando identificar momento de fechar, tente. Não espere o cliente pedir.
- Se não conseguir avançar após 3 tentativas, declare: {"action": "escalar", "motivo": "string"}
- Declare objetivo cumprido com: {"action": "objetivo_concluido", "desfecho": "string"}
```

*Criar prompts equivalentes para Suporte, Agendamento, Cadastro seguindo o mesmo padrão.*

---

## 2.2 — Workflow do Agente Especialista

Criar workflow `[AGENT] Executor`.

```js
// Recebe: contexto montado + agente selecionado pelo roteador

// 1. Chamar API Anthropic com contexto completo
const response = await fetch("https://api.anthropic.com/v1/messages", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    model: "claude-sonnet-4-20250514",
    max_tokens: 1000,
    system: contexto.system_prompt,
    messages: [
      ...contexto.historico_recente,
      { role: "user", content: contexto.input_usuario }
    ]
  })
})

const resposta_agente = response.content[0].text

// 2. Verificar se agente declarou ação ou ferramenta
const acao = extrairJSON(resposta_agente)

if (acao?.tool) {
  // Executar ferramenta e retornar resultado ao agente
  // Loop até agente não declarar mais ferramentas
}

if (acao?.action === "escalar") {
  // Disparar workflow de escalada para Chatwoot
}

if (acao?.action === "objetivo_concluido") {
  // Fechar objetivo no MongoDB
  // Disparar pipeline de conhecimento
}

// 3. Enviar resposta via Evolution API
await evolution.sendMessage({
  instance: business.evolution_instance,
  to: telefone,
  message: resposta_texto_limpo
})

// 4. Atualizar histórico no Redis
await redis.rpush(`historico:${business_id}:${telefone}`, 
  JSON.stringify({ role: "user", content: input_usuario, timestamp: Date.now() }),
  JSON.stringify({ role: "assistant", content: resposta_texto_limpo, timestamp: Date.now() })
)
await redis.ltrim(`historico:${business_id}:${telefone}`, -20, -1)
await redis.expire(`historico:${business_id}:${telefone}`, 86400)

// 5. Publicar evento no Stream de conhecimento
await redis.xadd(`events:${business_id}`, "*", {
  tipo: "agent_response",
  telefone,
  agente: agente_ativo,
  input: input_usuario,
  output: resposta_texto_limpo,
  ferramentas_usadas: JSON.stringify(ferramentas_chamadas),
  objetivo_id: sessao.objetivo_id
})
```

---

## 2.3 — Ferramentas Disponíveis por Agente

Implementar cada ferramenta como subworkflow N8N chamado via `Execute Workflow`.

```
buscar_produto(query)
  → Qdrant search em product_context
  → Retorna top 3 produtos relevantes com preço e descrição

verificar_agenda(data, servico, business_id)
  → Consulta coleção agendamentos no MongoDB
  → Retorna slots disponíveis

criar_agendamento(telefone, data, servico, nome)
  → Insere em agendamentos
  → Envia confirmação via Evolution API

registrar_lead(telefone, dados)
  → Upsert em leads
  → Calcula score inicial

consultar_historico_cliente(telefone)
  → Busca em leads + objectives anteriores
  → Retorna resumo estruturado

buscar_conhecimento(query)
  → Qdrant search em knowledge + human_actions
  → Retorna resoluções anteriores relevantes

escalar_para_humano(telefone, motivo, resumo)
  → Cria conversa no Chatwoot
  → Atualiza sessão Redis com flag "aguardando_humano"
  → Notifica atendente

registrar_pagamento(telefone, produto, valor)
  → Insere em transacoes
  → Atualiza score do lead
  → Dispara objetivo pós-venda
```

---

# FASE 3 — Sistema de Objetivos

## 3.1 — Workflow de Objetivos

Criar workflow `[OBJECTIVES] Manager`.

**Abrir objetivo:**
```js
async function abrirObjetivo(business_id, telefone, tipo, gatilho) {
  const etapas_por_tipo = {
    venda: ["qualificacao", "apresentacao", "proposta", "fechamento"],
    suporte: ["identificacao", "diagnostico", "resolucao"],
    agendamento: ["verificacao_disponibilidade", "confirmacao", "registro"],
    cadastro: ["coleta_dados", "validacao", "registro"],
    reengajamento: ["contato", "oferta", "decisao"]
  }
  
  const objetivo = {
    objetivo_id: gerarID(),
    telefone,
    tipo,
    status: "aberto",
    gatilho,
    etapas: etapas_por_tipo[tipo].map(nome => ({ 
      nome, status: "pendente", iniciada_em: null, concluida_em: null 
    })),
    agente_responsavel: mapearAgente(tipo),
    ferramentas_usadas: [],
    tempo_inicio: new Date(),
    desfecho: null
  }
  
  await mongo.insertOne(`biz_${business_id}`, "objectives", objetivo)
  
  // Atualizar sessão Redis
  const sessao = JSON.parse(await redis.get(`sessao:${business_id}:${telefone}`) || "{}")
  sessao.objetivo_id = objetivo.objetivo_id
  sessao.agente_ativo = objetivo.agente_responsavel
  await redis.set(`sessao:${business_id}:${telefone}`, JSON.stringify(sessao), "EX", 86400)
  
  // Incrementar contador
  await redis.incr(`uso:${business_id}:${mesAtual()}:objetivos`)
  
  return objetivo
}
```

**Avançar etapa:**
```js
async function avancarEtapa(business_id, objetivo_id, nome_etapa) {
  await mongo.updateOne(`biz_${business_id}`, "objectives", 
    { objetivo_id, "etapas.nome": nome_etapa },
    { $set: { 
      "etapas.$.status": "concluida", 
      "etapas.$.concluida_em": new Date(),
      status: "em_andamento"
    }}
  )
  
  // Publicar evento
  await redis.xadd(`events:${business_id}`, "*", {
    tipo: "objective_transition",
    objetivo_id,
    etapa: nome_etapa,
    timestamp: Date.now()
  })
}
```

**Timeout automático:**
Criar workflow `[OBJECTIVES] Timeout Check` com schedule diário:
```js
// Buscar objetivos em_andamento há mais de config.timeout_objetivo_horas
// Atualizar status para "abandonado"
// Publicar evento para pipeline de conhecimento
// Opcionalmente disparar reengajamento
```

---

# FASE 4 — Pipeline de Conhecimento

## 4.1 — Consumer do Stream de Eventos

Criar workflow `[KNOWLEDGE] Event Consumer`.

**Trigger:** Schedule a cada 30 segundos lendo Redis Stream.

```js
// Ler eventos não processados do Stream
const eventos = await redis.xreadgroup(
  "GROUP", "knowledge_consumer", "worker_1",
  "COUNT", "50", "STREAMS", `events:${business_id}`, ">"
)

for (const evento of eventos) {
  await processarEvento(evento)
  await redis.xack(`events:${business_id}`, "knowledge_consumer", evento.id)
}
```

**Processar evento:**
```js
async function processarEvento(evento) {
  const { tipo, telefone, objetivo_id } = evento
  
  // Cada tipo de evento gera conhecimento diferente
  const handlers = {
    message: extrairConhecimentoDeMensagem,
    agent_response: extrairConhecimentoDeResposta,
    tool_call: extrairPadraoDeFerramentas,
    objective_transition: extrairTrajetoriaDeObjetivo,
    human_action: extrairConhecimentoHumano,
    external: extrairSinalExterno
  }
  
  const conhecimento = await handlers[tipo]?.(evento)
  if (!conhecimento) return
  
  // Embeddar e salvar no Qdrant
  const embedding = await gerarEmbedding(conhecimento.conteudo_texto)
  const qdrant_id = await qdrant.upsert(conhecimento.collection, {
    vector: embedding,
    payload: {
      business_id: evento.business_id,
      tipo: conhecimento.tipo,
      fonte: conhecimento.fonte,
      desfecho: conhecimento.desfecho,
      mongodb_id: conhecimento.mongodb_id,
      telefone,
      timestamp: new Date().toISOString(),
      tags: conhecimento.tags
    }
  })
  
  // Salvar referência no MongoDB
  await mongo.insertOne(`biz_${evento.business_id}`, "knowledge", {
    ...conhecimento,
    qdrant_id,
    criado_em: new Date()
  })
}
```

---

## 4.2 — Extratores por Tipo de Evento

```js
// Mensagem do usuário
async function extrairConhecimentoDeMensagem(evento) {
  return {
    collection: "messages",
    tipo: "mensagem_usuario",
    fonte: "user",
    conteudo_texto: evento.conteudo,
    desfecho: null, // será atualizado quando objetivo fechar
    tags: ["input", "linguagem_natural"]
  }
}

// Resposta do agente com contexto de desfecho
async function extrairConhecimentoDeResposta(evento) {
  // Só salva respostas que levaram a avanço de etapa ou conversão
  // O desfecho é preenchido retroativamente quando o objetivo fecha
  return {
    collection: "agent_responses",
    tipo: "resposta_agente",
    fonte: evento.agente,
    conteudo_texto: `[Contexto: ${evento.input}]\n[Resposta: ${evento.output}]`,
    desfecho: null,
    tags: ["agent", evento.agente]
  }
}

// Quando objetivo fecha: atualizar desfecho em todos os eventos associados
async function atualizarDesfechoConhecimento(business_id, objetivo_id, desfecho) {
  const eventos = await mongo.find(`biz_${business_id}`, "knowledge", { objetivo_id })
  for (const doc of eventos) {
    await qdrant.setPayload(doc.collection, doc.qdrant_id, { desfecho })
    await mongo.updateOne(`biz_${business_id}`, "knowledge", 
      { _id: doc._id }, 
      { $set: { desfecho } }
    )
  }
}
```

---

# FASE 5 — Chatwoot: Escalada e Retomada

## 5.1 — Workflow de Escalada

Criar workflow `[CHATWOOT] Escalar Conversa`.

```js
// 1. Buscar histórico completo para resumo
const historico = await redis.lrange(`historico:${business_id}:${telefone}`, 0, -1)
const objetivo = await mongo.findOne(`biz_${business_id}`, "objectives", { objetivo_id })

// 2. Agente gera resumo para o atendente
const resumo = await chamarAgente("escalada", {
  historico,
  objetivo,
  motivo_escalada: motivo
})

// 3. Criar contato no Chatwoot se não existir
const contato = await chatwoot.contacts.create({
  account_id: business.chatwoot_account_id,
  phone_number: `+${telefone}`,
  name: lead.nome || telefone
})

// 4. Criar conversa no Chatwoot
const conversa = await chatwoot.conversations.create({
  account_id: business.chatwoot_account_id,
  inbox_id: business.chatwoot_inbox_id,
  contact_id: contato.id,
  additional_attributes: {
    objetivo_id,
    business_id,
    resumo_ia: resumo
  }
})

// 5. Enviar resumo como nota privada (atendente vê, cliente não)
await chatwoot.messages.create({
  account_id: business.chatwoot_account_id,
  conversation_id: conversa.id,
  content: resumo,
  message_type: "activity",
  private: true
})

// 6. Atualizar sessão Redis
const sessao = JSON.parse(await redis.get(`sessao:${business_id}:${telefone}`))
sessao.aguardando_humano = true
sessao.chatwoot_conversation_id = conversa.id
await redis.set(`sessao:${business_id}:${telefone}`, JSON.stringify(sessao), "EX", 86400)

// 7. Atualizar objetivo
await mongo.updateOne(`biz_${business_id}`, "objectives",
  { objetivo_id },
  { $set: { status: "escalado", atendente_humano_id: null } }
)
```

## 5.2 — Webhook Chatwoot → N8N (Retomada)

```js
// Quando atendente resolve e fecha a conversa no Chatwoot:
// Chatwoot dispara webhook para N8N

// N8N recebe evento conversation_resolved:
const { conversation } = $json
const { objetivo_id, business_id } = conversation.additional_attributes

// Fechar objetivo
await mongo.updateOne(`biz_${business_id}`, "objectives",
  { objetivo_id },
  { $set: { 
    status: "concluido", 
    desfecho: "resolvido_humano",
    tempo_fim: new Date()
  }}
)

// Limpar flag de aguardando humano
const sessao = JSON.parse(await redis.get(`sessao:${business_id}:${telefone}`))
sessao.aguardando_humano = false
await redis.set(`sessao:${business_id}:${telefone}`, JSON.stringify(sessao), "EX", 86400)

// Disparar pipeline de conhecimento
await redis.xadd(`events:${business_id}`, "*", {
  tipo: "human_action",
  telefone,
  objetivo_id,
  desfecho: "resolvido_humano",
  conteudo: conversation.meta?.summary || ""
})

// Opcionalmente: iniciar objetivo pós-venda ou follow-up
```

---

# FASE 6 — Relatórios e Performance

## 6.1 — Workflow de Relatório Diário

Criar workflow `[REPORTS] Daily` com schedule diário às 7h.

```js
// Para cada negócio ativo:

const metricas = {
  
  objetivos: await mongo.aggregate(`biz_${business_id}`, "objectives", [
    { $match: { tempo_inicio: { $gte: inicioDia, $lte: fimDia } } },
    { $group: {
      _id: { tipo: "$tipo", desfecho: "$desfecho" },
      count: { $sum: 1 },
      tempo_medio_min: { $avg: { $divide: [
        { $subtract: ["$tempo_fim", "$tempo_inicio"] }, 60000
      ]}}
    }}
  ]),
  
  escaladas: await mongo.countDocuments(`biz_${business_id}`, "objectives", {
    status: "escalado",
    tempo_inicio: { $gte: inicioDia }
  }),
  
  conversoes: await mongo.countDocuments(`biz_${business_id}`, "objectives", {
    tipo: "venda", desfecho: "convertido",
    tempo_inicio: { $gte: inicioDia }
  }),
  
  novos_leads: await mongo.countDocuments(`biz_${business_id}`, "leads", {
    primeiro_contato: { $gte: inicioDia }
  }),
  
  mensagens: parseInt(await redis.get(`uso:${business_id}:${mesAtual()}:mensagens`) || "0"),
  
  gaps_agente: await mongo.countDocuments(`biz_${business_id}`, "knowledge", {
    tipo: "gap",
    criado_em: { $gte: inicioDia }
  })
}

// Agente analítico gera narrativa
const relatorio = await chamarAgente("analitico", {
  metricas,
  periodo: "dia",
  negocio: business.nome
})

// Salvar no MongoDB
await mongo.insertOne(`biz_${business_id}`, "reports", {
  periodo: "diario",
  data: inicioDia,
  metricas,
  narrativa: relatorio,
  criado_em: new Date()
})

// Enviar para responsável via WhatsApp
await evolution.sendMessage({
  instance: business.evolution_instance,
  to: business.config.numero_gestor,
  message: relatorio
})
```

---

# FASE 7 — Onboarding de Novos Clientes

## 7.1 — Workflow de Provisionamento

Criar workflow `[ADMIN] Provisionar Negócio`. Disparado por webhook de pagamento confirmado.

```js
const business_id = gerarID() // ex: biz_abc123

// 1. Criar instance Evolution API
await evolution.post("/instance/create", {
  instanceName: business_id,
  webhook: `${N8N_URL}/webhook/evolution`,
  webhookByEvents: true,
  events: ["MESSAGES_UPSERT"]
})

// 2. Criar Account Chatwoot
const account = await chatwoot.accounts.create({ name: dados_cliente.nome })
const inbox = await chatwoot.inboxes.create({
  account_id: account.id,
  name: "WhatsApp",
  channel: { type: "api" }
})

// 3. Criar database MongoDB e collections com indexes
await provisionarMongoDB(business_id)

// 4. Inserir system prompts padrão (clonar do template master)
await clonarPromptsTemplate(business_id, dados_cliente.segmento)

// 5. Registrar no admin.businesses
await mongo.insertOne("admin", "businesses", {
  business_id,
  evolution_instance: business_id,
  chatwoot_account_id: account.id,
  chatwoot_inbox_id: inbox.id,
  mongodb_database: `biz_${business_id}`,
  config: CONFIG_PADRAO,
  ...dados_cliente
})

// 6. Criar Redis Stream para o negócio
await redis.xadd(`events:${business_id}`, "*", { tipo: "business_created" })

// 7. Configurar consumer group no Redis Stream
await redis.xgroup("CREATE", `events:${business_id}`, "knowledge_consumer", "$", "MKSTREAM")

// 8. Enviar credenciais para o cliente
await notificarCliente(dados_cliente, { business_id, qr_code_url })
```

---

# CHECKLIST DE VALIDAÇÃO

Antes de considerar qualquer fase concluída, validar:

**Fase 0:**
- [ ] Todos os schemas criados com indexes
- [ ] Todas as collections Qdrant criadas com dimensão correta
- [ ] Estrutura de chaves Redis documentada e funcionando

**Fase 1:**
- [ ] Webhook Evolution recebendo mensagens de teste
- [ ] Buffer acumulando mensagens fragmentadas corretamente
- [ ] Debounce respeitando o TTL configurado
- [ ] Lock evitando processamento duplicado
- [ ] Contexto RAG retornando resultados relevantes

**Fase 2:**
- [ ] Roteador retornando JSON válido em todos os cenários
- [ ] Cada agente especialista respondendo adequadamente
- [ ] Ferramentas executando e retornando ao agente
- [ ] Histórico sendo salvo e carregado corretamente

**Fase 3:**
- [ ] Objetivo abrindo no gatilho correto
- [ ] Etapas avançando nas ações corretas
- [ ] Timeout funcionando para objetivos abandonados

**Fase 4:**
- [ ] Eventos sendo publicados no Stream
- [ ] Consumer processando sem duplicatas
- [ ] Vetores sendo salvos no Qdrant com payload correto
- [ ] Desfecho sendo atualizado retroativamente nos vetores

**Fase 5:**
- [ ] Escalada criando conversa no Chatwoot com resumo
- [ ] Atendente recebendo nota privada com contexto
- [ ] Webhook de resolução retomando o fluxo

**Fase 6:**
- [ ] Relatório diário sendo gerado e enviado
- [ ] Métricas corretas por negócio

**Fase 7:**
- [ ] Onboarding completo em menos de 2 minutos
- [ ] Cliente recebendo acesso e QR code automaticamente

---

# ORDEM DE IMPLEMENTAÇÃO

```
Semana 1: Fase 0 completa + Fase 7 (onboarding)
Semana 2: Fase 1 completa (orquestrador + debounce)
Semana 3: Fase 2 completa (agentes + ferramentas base)
Semana 4: Fase 3 + Fase 5 (objetivos + Chatwoot)
Semana 5: Fase 4 (pipeline de conhecimento)
Semana 6: Fase 6 + testes de carga + ajuste de prompts
```

Cada fase é independente o suficiente para ser implementada e testada isoladamente antes de avançar.
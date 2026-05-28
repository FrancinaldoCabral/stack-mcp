// Cria o negócio LivraisonTotale + personas (restaurant, deliverer) no Mongo de produção via MCP.
// Idempotente: se já existir, faz update.
import 'dotenv/config';
import { randomUUID } from 'crypto';

const PROD = 'http://fco8og80s4sw4c0wc0ogswws.157.173.111.65.sslip.io';

async function mcp(name, args) {
  const r = await fetch(`${PROD}/mcp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
    body: JSON.stringify({ jsonrpc: '2.0', id: Date.now(), method: 'tools/call', params: { name, arguments: args } }),
  });
  const txt = await r.text();
  const data = txt.replace(/^event: message\s*\n/, '').replace(/^data: /, '').trim();
  const parsed = JSON.parse(data);
  if (parsed.error) throw new Error(JSON.stringify(parsed.error));
  return JSON.parse(parsed.result.content[0].text);
}

// ── Personas ─────────────────────────────────────────────────────────────────

const personaRestaurant = {
  key: 'restaurant',
  label: 'Restaurante (grupo de comandos)',
  systemPrompt: `Você é o canal de atendimento da LivraisonTotale (LT) com restaurantes parceiros.
Está conversando dentro de um GRUPO DE COMANDOS de UM restaurante. Toda mensagem que chega aqui é do restaurante: pode ser texto, foto rascunho, áudio, ou mensagem solta.

OBJETIVO PRINCIPAL: capturar pedidos, organizá-los, e manter o restaurante informado sobre o status da entrega.

COMPORTAMENTO

1) Quando chega um novo pedido (foto, texto, áudio):
   - Responda IMEDIATAMENTE com "Montando 👀" para sinalizar que está cuidando.
   - Extraia: itens, endereço, telefone do cliente, valor, forma de pagamento, observações.
   - Se faltar dado essencial (endereço completo, telefone, valor), pergunte de forma direta e curta.
   - Quando os dados estiverem completos, use delivery_draft_order para criar o rascunho.
   - Confirme com o restaurante a versão textual: "Confere isso aqui? [resumo]".
   - Após confirmação, use delivery_confirm_order — isso publica o pedido no grupo de entregadores AUTOMATICAMENTE.

2) Quando o entregador (via outro fluxo) sinalizar um status, você POSTA aqui no grupo de comandos:
   - "Entregador X a caminho, chega em ~Y min"
   - "Entregador chegou no restaurante"
   - "Pedido saiu para entrega"
   - "Pedido entregue ✅"

3) Quando o restaurante perguntar algo (status, prazo, problema):
   - Consulte o pedido com delivery_get_order e responda com o status atual.
   - Se houver problema (cliente não responde, atraso), explique a situação real.

4) Acertos:
   - Se o restaurante mencionar acerto/dinheiro/valor pendente, use delivery_log_settlement para registrar.
   - Sempre confirme o valor antes de registrar.

ESTILO
- Mensagens curtas, profissionais e amistosas.
- Use emojis com moderação (👀 ✅ 🛵 📦 ⏱️).
- Nada de blocos longos. Quebre em mensagens pequenas se precisar.
- Sempre em português brasileiro, tom de quem trabalha no operacional.

NUNCA
- Nunca envie foto rascunho original para entregador — sempre o texto padronizado.
- Nunca confirme pedido sem dados completos.
- Nunca prometa tempo sem checar com o entregador.
- Nunca invente status — se não souber, consulte.`,
  tools: [
    'delivery_draft_order',
    'delivery_update_draft',
    'delivery_confirm_order',
    'delivery_create_order',
    'delivery_update_order_status',
    'delivery_list_orders',
    'delivery_get_order',
    'delivery_log_settlement',
    'delivery_post_to_command_group',
    'delivery_post_to_deliverer_group',
    'delivery_list_restaurants',
    'delivery_get_restaurant',
    'search_memory',
  ],
};

const personaDeliverer = {
  key: 'deliverer',
  label: 'Entregadores (grupo LT)',
  systemPrompt: `Você é o canal de atendimento da LivraisonTotale (LT) com os entregadores.
Está conversando dentro do GRUPO DOS ENTREGADORES. Mensagens vêm de vários entregadores diferentes — sempre identifique quem está falando.

OBJETIVO PRINCIPAL: distribuir pedidos, registrar quem aceitou cada corrida, acompanhar status, e controlar acertos financeiros.

COMPORTAMENTO

1) Quando o sistema publicar um novo pedido aqui (via delivery_confirm_order):
   - O pedido aparece com texto padronizado e referência (LT-XXXXXX).
   - Aguarde algum entregador se manifestar ("eu faço", "to a X min", etc).
   - Quando um entregador aceitar:
     • Use delivery_assign_deliverer para registrar quem pegou.
     • Pergunte: "Em quanto tempo você chega no restaurante?"
     • Quando responder, use delivery_post_to_command_group para avisar o restaurante: "Entregador X a caminho, chega em Y min".

2) Acompanhe os status que o entregador sinalizar:
   - "Cheguei no restaurante" → delivery_update_order_status(status='no_restaurante')
   - "Saí pra entrega" / "to indo" → delivery_update_order_status(status='a_caminho_cliente')
   - "Entreguei" / "entregue" → delivery_update_order_status(status='entregue')
   - "Cliente não respondeu" / problema → delivery_update_order_status(status='problema', notes='...')
   Cada update REPLICA AUTOMATICAMENTE no grupo de comandos do restaurante.

3) Acertos:
   - Se o entregador mandar "pedido X acertado", marque o settlement como liquidado.
   - Se o entregador mandar "saí sem acertar do restaurante Y, valor Z", registre com delivery_log_settlement type='debito' (entregador deve à LT/restaurante).
   - Se a LT deve para o entregador (taxa de entrega não paga), registre type='credito'.
   - Quando vários acertos se acumulam, faça compensação: "Você deve R$X de pedidos, mas tem R$Y de taxas — saldo: ...".

4) Se ninguém se manifestar em até 3 minutos, mencione: "@entregadores quem topa essa? Cliente em [bairro]".

ESTILO
- Tom mais direto e descontraído, como em grupo de trabalho.
- Identifique cada entregador pelo nome ou @ quando responder.
- Emojis: 🛵 ✅ 📦 ⏱️ 💰
- Mensagens curtas, uma ação por vez.

NUNCA
- Nunca atribua pedido sem confirmação explícita do entregador.
- Nunca encerre pedido sem confirmação de entrega.
- Nunca esqueça de replicar status no grupo de comandos.`,
  tools: [
    'delivery_update_order_status',
    'delivery_assign_deliverer',
    'delivery_list_orders',
    'delivery_get_order',
    'delivery_log_settlement',
    'delivery_post_to_command_group',
    'delivery_post_to_deliverer_group',
    'delivery_list_restaurants',
    'search_memory',
  ],
};

// ── Negócio ──────────────────────────────────────────────────────────────────

const businessDoc = {
  name: 'LivraisonTotale',
  instances: ['livraisontotale'], // ← instância Evolution; troque/adicione no dashboard depois
  assistantName: 'Suporte LT',
  systemPrompt: `Você é o atendente de suporte da LivraisonTotale (LT), uma plataforma própria de delivery que conecta restaurantes parceiros a entregadores próprios (concorrente do iFood/99). 
Sua função padrão (quando não houver persona específica configurada para o JID) é responder dúvidas operacionais sobre o serviço LT, de forma profissional, breve e cordial em português brasileiro.

Se a conversa for de um grupo de comandos de restaurante ou de entregadores, você vai assumir uma persona específica configurada via personas. Se for de um cliente final ou contato avulso, responda como atendimento institucional.`,
  settings: {
    model: 'google/gemini-2.5-flash-preview',
    maxHistoryTokens: 500_000,
    tools: { searchMemory: true },
  },
  personas: [personaRestaurant, personaDeliverer],
  contextRoutes: [], // ← preenchido automaticamente quando você cadastrar restaurantes no dashboard
};

// ── Execução ─────────────────────────────────────────────────────────────────

async function main() {
  console.log('🔍 Procurando negócio LivraisonTotale...');
  const existing = await mcp('mongo_find', {
    database: 'vendly',
    collection: 'businesses',
    filter: { name: 'LivraisonTotale' },
    limit: 1,
  });

  if (existing.length > 0) {
    const id = existing[0]._id;
    console.log(`✏️  Encontrado (${id}) — atualizando personas e systemPrompt...`);
    const upd = await mcp('mongo_update', {
      database: 'vendly',
      collection: 'businesses',
      filter: { name: 'LivraisonTotale' },
      update: {
        $set: {
          assistantName: businessDoc.assistantName,
          systemPrompt: businessDoc.systemPrompt,
          settings: businessDoc.settings,
          personas: businessDoc.personas,
          updatedAt: new Date().toISOString(),
        },
      },
    });
    console.log('   ', JSON.stringify(upd));
  } else {
    console.log('➕ Não existe — criando...');
    const now = new Date().toISOString();
    const ins = await mcp('mongo_insert', {
      database: 'vendly',
      collection: 'businesses',
      documents: { ...businessDoc, createdAt: now, updatedAt: now },
    });
    console.log('   ', JSON.stringify(ins));
  }

  // Verifica resultado
  const after = await mcp('mongo_find', {
    database: 'vendly',
    collection: 'businesses',
    filter: { name: 'LivraisonTotale' },
    limit: 1,
    projection: { name: 1, instances: 1, personas: 1, contextRoutes: 1 },
  });
  const biz = after[0];
  console.log('\n✅ LivraisonTotale pronto:');
  console.log(`   _id          : ${biz._id}`);
  console.log(`   instances    : ${JSON.stringify(biz.instances)}`);
  console.log(`   personas     : ${biz.personas?.length ?? 0} (${(biz.personas ?? []).map(p => p.key).join(', ')})`);
  console.log(`   contextRoutes: ${biz.contextRoutes?.length ?? 0}`);
  console.log('\n📋 PRÓXIMOS PASSOS NO DASHBOARD:');
  console.log('   1. Abra a aba "Restaurantes" do Delivery');
  console.log('   2. Para cada restaurante: clique "Adicionar", escolha negócio "LivraisonTotale",');
  console.log('      e use o seletor de JID para escolher o grupo de comandos do restaurante');
  console.log('      e o grupo de entregadores (deliverer).');
  console.log('   3. As rotas de contexto são preenchidas automaticamente.');
  console.log('   4. Se a instância "livraisontotale" do Evolution ainda não existe, configure-a primeiro');
  console.log('      em "Negócios" → editar LivraisonTotale → conectar instância.');
}

main().catch(e => { console.error('❌', e); process.exit(1); });

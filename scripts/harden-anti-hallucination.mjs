// Endurece anti-alucinação:
// 1) Reescreve o template de confirmação na persona "restaurant" do business LivraisonTotale
//    (remove linha Code, troca [...] por < > com regras explícitas)
// 2) Adiciona ao Construir Prompt um "template pré-preenchido" com endereço real do restaurante
// 3) Adiciona guard no Parsear Chunks: bloqueia LT-XXX inventado e substitui [Endereço do restaurante]
import 'dotenv/config';

const APP = 'https://app.vendly.chat';
const N8N = 'https://workflows.vendly.chat/api/v1';
const KEY = process.env.N8N_API_KEY;
const WF_ID = 'jleu4RPvSnYDL8Gd';
if (!KEY) { console.error('N8N_API_KEY ausente'); process.exit(1); }
const n8nHeaders = { 'X-N8N-API-KEY': KEY, 'Accept': 'application/json', 'Content-Type': 'application/json' };

// ─── 1. Persona prompt update via mongo_update ──────────────────────────────
const newRestaurantPrompt = `Você é a Carol, do operacional da LivraisonTotale. Trabalha aqui há quase dois anos, conhece o ritmo dos restaurantes parceiros, sabe como cada entregador se vira e tem traquejo pra resolver imprevisto sem fazer drama. Fala português brasileiro num registro profissional e amistoso, sem gírias, mas também sem aquele tom de central de atendimento — você é alguém do time, não um robô.

Neste momento você está no grupo de comandos de UM restaurante parceiro. Tudo que chega aqui vem da equipe deles: pedido novo, pergunta sobre uma entrega em andamento, pedido de acerto, foto de rascunho, áudio, mensagem solta. Não é cliente final.

Sua função é segurar a ponta operacional pra esse restaurante: receber o pedido, organizar os dados, mandar pros entregadores e manter o pessoal do restaurante sabendo o que está acontecendo com cada entrega — sem que eles precisem ficar perguntando.

Quando cai um pedido novo aqui (foto da comanda, texto, áudio), o primeiro reflexo é responder algo curto pra eles saberem que você já viu — "Anotado, já organizo aqui 👀" ou "Montando" funcionam bem. Aí você lê com calma a comanda e extrai TODOS os campos abaixo:

  • Nome do cliente
  • Endereço de entrega completo (rua, número, complemento se houver)
  • Telefone de contato do cliente
  • Valor do pedido (e, se for em dinheiro, o valor com que o cliente vai pagar — pra calcular o troco)
  • Forma de pagamento (dinheiro, cartão na entrega, já pago via Pix/online)
  • Prazo estimado de preparo (quando o pedido fica pronto pra retirada)
  • Código/comanda do pedido, se houver (este é o código INTERNO do restaurante, não o LT-XXX)
  • Observações ou referências adicionais

REGRA CRÍTICA — NUNCA INVENTE DADOS:
Você só pode usar dados que estão LITERALMENTE escritos na comanda enviada pelo restaurante (texto, foto ou áudio transcrito) ou que eles te disseram explicitamente nesta conversa. Não chute valor, não invente prazo de preparo, não invente taxa, não complete telefone que você não viu, não suponha forma de pagamento. Se um campo não está claro — você PERGUNTA, não preenche. Exemplo do que NÃO fazer: a comanda mostra "PRAZO PREPARO (ESTIMADO):" em branco — você não escreve "22:10", você pergunta "qual o prazo de preparo?". Mesma coisa pra forma de pagamento: se não está escrito, NÃO escreva "(já pago via Pix)" — pergunte.

REGRA CRÍTICA DE CONFIRMAÇÃO — leia com atenção:
Antes de chamar delivery_draft_order, você precisa ter TODOS os campos obrigatórios (nome, endereço, telefone, valor, forma de pagamento, prazo). Se faltar QUALQUER coisa essencial, você manda UMA ÚNICA mensagem listando tudo que está faltando de uma vez — não pergunta uma coisa por vez, não fica em pingue-pongue, e NÃO mostra o bloco de confirmação ainda. Exemplo: "Faltou o telefone do cliente, a forma de pagamento e o prazo de preparo — me passa esses três que eu já fecho aqui".

⚠️ FORMATAÇÃO OBRIGATÓRIA DA MENSAGEM DE CONFIRMAÇÃO ⚠️

Só monte o bloco abaixo quando TIVER TODOS os dados reais em mãos. Substitua cada <CAMPO> pelo valor REAL extraído da comanda/conversa. Se algum <CAMPO> não tem valor real, NÃO mande este bloco — pergunte primeiro.

Regras estritas do bloco:
- NUNCA deixe < > ou [ ] na mensagem final. Se você vê isso na sua resposta, é bug — refaça.
- NUNCA inclua linha "🔑 Code" neste bloco. O código LT-XXXXXX é gerado pelo sistema DEPOIS, quando você chamar delivery_confirm_order. Antes disso o código não existe — não invente.
- "Retirada" é o endereço REAL do restaurante (que você já tem no contexto operacional acima, em "Restaurante atual"). NUNCA escreva "[Endereço do restaurante]", "<endereco>" nem o NOME do restaurante — escreva o endereço literal.
- Para essa mensagem chegar como UMA ÚNICA mensagem no WhatsApp, NÃO PODE haver linha em branco (dois \\n seguidos) em lugar nenhum. Use apenas quebra de linha simples entre campos.

Modelo do bloco (substitua os <CAMPOS> por valores reais; quebras simples entre linhas):

Confere antes de eu mandar pros entregadores?
🙋🏻‍♂️ Cliente: <NOME_DO_CLIENTE>
☎️ <TELEFONE_DO_CLIENTE>
🏠 <ENDEREÇO_COMPLETO_DO_CLIENTE>
🍴 Retirada: <ENDEREÇO_REAL_DO_RESTAURANTE>
💰 Pedido: €<VALOR_DO_PEDIDO>
🛵 Taxa de entrega: €<VALOR_DA_TAXA> (<X.X> km via delivery_calc_fee)
💳 Total: €<PEDIDO+TAXA> (<FORMA_DE_PAGAMENTO_LITERAL>)
⏰ Pronto às <HORÁRIO_INFORMADO_PELO_RESTAURANTE>
Mando?

OBRIGATÓRIO antes de montar o bloco: chamar delivery_calc_fee passando o restaurantId do contexto e o clientAddress completo. Use o "feeEur" retornado em "Taxa de entrega" e a soma pedido+taxa em "Total". NUNCA pule essa etapa e NUNCA chute taxa. Se outOfRange=true, avise antes de continuar.

⚠️ ENTRADAS POR ÁUDIO: quando o usuário mandar áudio, a mensagem vem como "[Mensagem de voz]: <transcrição literal>". Leia a transcrição com atenção e extraia TODOS os dados que estiverem ali (prazo, valor, endereço, nome, etc.) antes de perguntar. Se o áudio claramente trouxe o prazo de preparo, NÃO pergunte de novo — use o que foi dito.

Só depois do "manda", "ok", "pode mandar", "fechou" — você chama delivery_confirm_order. A partir daí o pedido cai automaticamente no grupo dos entregadores no formato padrão da LT — você NÃO precisa repassar à mão.

Referência do formato que o pedido toma no grupo dos entregadores (gerado pela integração, não por você):

L.T {NOME_RESTAURANTE}

📍 ENDEREÇO DE ENTREGA
 {endereco_cliente}

📍 ENDEREÇO RETIRADA
 {endereco_restaurante}

🙋🏻‍♂️ CLIENTE: {nome_cliente}
☎️ CONTATO: {telefone_cliente}
🔑 CODE: {codigo_pedido}
💰 VALOR: {valor_pedido}/{valor_pago_em_dinheiro}
⏰ PRAZO PREPARO (ESTIMADO): {prazo}

📍 LINK: {link_maps}

Repare em dois pontos: (1) o endereço de retirada vai EXPLÍCITO no card — o entregador não precisa procurar; (2) o valor aparece como "valor_do_pedido/valor_pago_em_dinheiro" quando o cliente paga em dinheiro (ex.: 23/50 = pedido de 23, cliente vai pagar com 50, troco de 27). Quando não é dinheiro, vai só o valor.

Conforme o entregador for andando (chegou no restaurante, saiu pra entrega, entregou), o status replica sozinho aqui no grupo de comandos. Quando isso acontecer, você formata de jeito natural usando o nome real do entregador — "[nome] chegou aí pra retirar", "saiu pra entrega, chega em uns 15 min", "entregue ✅". Não anuncia microevento — fala o que o restaurante quer saber.

Se perguntarem de um pedido específico (nome do cliente, número do pedido, "o último que saiu"), consulta com delivery_get_order e responde com o que tem de real. Se tem problema, conta o que está acontecendo e o que já está sendo feito — sem enfeitar.

Acerto de valores: se mencionarem dinheiro pendente, você confirma o valor antes de gravar (citando o número real do pedido e o valor exato) e só então registra com delivery_log_settlement. Nunca registra sem confirmar.

Coisas que você NÃO faz: nunca chama delivery_draft_order/delivery_confirm_order sem a confirmação única acima; nunca repassa a foto do rascunho aos entregadores; nunca chuta tempo de entrega sem ouvir do entregador; nunca inventa status — se não sabe, consulta.

WhatsApp: mensagens curtas, uma ideia por vez — EXCETO na hora da confirmação do pedido, que é UMA mensagem com tudo. Emoji com moderação (👀 ✅ 🛵 📍 🙋🏻‍♂️). Sem saudações genéricas tipo "Olá! Como posso ajudar?" — você já está conversando, vai direto.

Ferramentas disponíveis: delivery_draft_order, delivery_update_draft, delivery_confirm_order, delivery_create_order, delivery_update_order_status, delivery_list_orders, delivery_get_order, delivery_log_settlement, delivery_post_to_command_group, delivery_post_to_deliverer_group, delivery_list_restaurants, delivery_get_restaurant, delivery_calc_fee, search_memory.

CÁLCULO DE TAXA: sempre que precisar incluir taxa no resumo do pedido OU se o restaurante perguntar quanto sai a entrega, chame delivery_calc_fee com restaurantId e clientAddress completo. A ferramenta retorna distância em km e taxa em €. Nunca chute. Se outOfRange=true: "esse endereço está a [X] km, fora da nossa área de cobertura (máximo [maxKmTabela] km) — vou precisar de autorização pra rodar isso".`;

console.log('1) Atualizando persona "restaurant" no MongoDB...');
const updRes = await fetch(`${APP}/tool/mongo_update`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    database: 'vendly',
    collection: 'businesses',
    filter: { name: 'LivraisonTotale' },
    update: { $set: { 'personas.0.systemPrompt': newRestaurantPrompt } },
  }),
}).then(r => r.json()).catch(e => ({ ok: false, error: String(e) }));
console.log('   →', updRes.ok ? updRes.result : updRes.error || JSON.stringify(updRes));

// ─── 2. Atualizar nó Parsear Chunks com guards anti-alucinação ──────────────
console.log('\n2) Atualizando nó "Parsear Chunks" no workflow N8N...');
const wf = await (await fetch(`${N8N}/workflows/${WF_ID}`, { headers: n8nHeaders })).json();
const parseNode = wf.nodes.find(n => n.name === 'Parsear Chunks');
if (!parseNode) throw new Error('Parsear Chunks não encontrado');

const guardStart = '/* hallucination-guard-start */';
const guardEnd = '/* hallucination-guard-end */';
const guardBlock = `${guardStart}
// === Guard anti-alucinação: rodado logo após receber resposta do LLM ===
try {
  // 1. Detecta código LT-XXXXXX inventado (só pode existir APÓS delivery_confirm_order)
  //    Como este nó só roda quando NÃO houve tool_call (o fluxo de tool_call vai por outra branch),
  //    qualquer LT- aqui é alucinação. Remove a linha inteira.
  if (/\\bLT-[A-Z0-9][A-Z0-9\\-]{3,}\\b/.test(content)) {
    content = content.replace(/^[^\\n]*\\bLT-[A-Z0-9][A-Z0-9\\-]{3,}\\b[^\\n]*\\n?/gm, '');
  }

  // 2. Detecta placeholders esquecidos como [Endereço do restaurante], <NOME>, etc.
  //    Tenta substituir pelo endereço real do restaurante; se não conseguir, transforma
  //    o bloco inteiro numa pergunta listando o que falta.
  const __restAddr = (() => {
    try {
      const sysMsg = promptData.messages?.find(m => m.role === 'system')?.content || '';
      const m = String(sysMsg).match(/Endere[çc]o de retirada:\\s*([^\\n]+)/i);
      return m ? m[1].trim() : '';
    } catch { return ''; }
  })();
  // Substitui qualquer placeholder de "endereço do restaurante" / "retirada"
  if (__restAddr) {
    content = content.replace(/\\[(?:endere[çc]o\\s+do\\s+restaurante|retirada)[^\\]]*\\]/gi, __restAddr);
    content = content.replace(/<(?:endere[çc]o[^>]*restaurante|endereco_restaurante|RETIRADA)[^>]*>/gi, __restAddr);
  }
  // Demais placeholders sobrando ([algo] ou <ALGO_MAIUSCULO>) → bloqueia bloco inteiro
  const __leftoverRe = /\\[(?:NOME|TELEFONE|VALOR|HOR[ÁA]RIO|PRAZO|FORMA|PAGAMENTO|ENDERE[CÇ]O|CLIENTE|PREPARO)[^\\]]*\\]|<(?:NOME|TELEFONE|VALOR|HOR[ÁA]RIO|PRAZO|FORMA|PAGAMENTO|ENDERE[CÇ]O|CLIENTE|PREPARO)[^>]*>/gi;
  if (__leftoverRe.test(content)) {
    const faltando = [...content.matchAll(__leftoverRe)].map(m => m[0].replace(/[\\[\\]<>]/g, '').toLowerCase().replace(/_/g, ' '));
    const lista = [...new Set(faltando)].slice(0, 5).join(', ');
    content = 'Falta um detalhe pra eu fechar o resumo — me confirma: ' + (lista || 'os campos pendentes') + '.';
  }
} catch(__guardErr) { /* não bloqueia o fluxo */ }
${guardEnd}`;

const oldParse = parseNode.parameters.jsCode;
const re = new RegExp(guardStart.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '[\\s\\S]*?' + guardEnd.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
let newParse;
if (re.test(oldParse)) {
  newParse = oldParse.replace(re, guardBlock);
} else {
  // Inserir logo APÓS a definição de `content` (após o else { content = _choice?... }) — antes do detect "userPediuHumano"
  const anchor = "} else {\n  content = _choice?.message?.content ?? resp.error?.message ?? 'Desculpe, erro interno.';\n}";
  const idx = oldParse.indexOf(anchor);
  if (idx === -1) throw new Error('âncora "content =" não encontrada em Parsear Chunks');
  const insertAt = idx + anchor.length;
  newParse = oldParse.slice(0, insertAt) + '\n\n' + guardBlock + '\n' + oldParse.slice(insertAt);
}
parseNode.parameters.jsCode = newParse;

// Settings filtrados
const allowedSettings = ['saveExecutionProgress','saveManualExecutions','saveDataErrorExecution','saveDataSuccessExecution','executionTimeout','errorWorkflow','timezone','executionOrder'];
const cleanSettings = {};
for (const k of allowedSettings) if (wf.settings && wf.settings[k] !== undefined) cleanSettings[k] = wf.settings[k];
if (!cleanSettings.executionOrder) cleanSettings.executionOrder = 'v1';

const putRes = await fetch(`${N8N}/workflows/${WF_ID}`, {
  method: 'PUT', headers: n8nHeaders,
  body: JSON.stringify({
    name: wf.name,
    nodes: wf.nodes,
    connections: wf.connections,
    settings: cleanSettings,
  }),
});
const putJson = await putRes.json().catch(() => ({}));
if (!putRes.ok) {
  console.error('   ❌ PUT falhou:', putRes.status, JSON.stringify(putJson).slice(0, 400));
  process.exit(1);
}
console.log('   ✅ workflow atualizado (id=' + putJson.id + ')');

console.log('\nDone.');

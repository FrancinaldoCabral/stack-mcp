// Injeta no Construir Prompt: data/hora atual, dados do restaurante (nome+endereço),
// e tabela de preços — para o LLM parar de inventar.
const N8N = 'https://workflows.vendly.chat/api/v1';
const KEY = process.env.N8N_API_KEY;
const WF_ID = 'jleu4RPvSnYDL8Gd';
if (!KEY) { console.error('N8N_API_KEY ausente'); process.exit(1); }
const headers = { 'X-N8N-API-KEY': KEY, 'Accept': 'application/json', 'Content-Type': 'application/json' };

const wf = await (await fetch(`${N8N}/workflows/${WF_ID}`, { headers })).json();
const node = wf.nodes.find(n => n.name === 'Construir Prompt');
if (!node) throw new Error('Construir Prompt não encontrado');

const oldCode = node.parameters.jsCode;

// Bloco LT-CONTEXT (entre marcadores idempotentes). Substitui se já existir.
const startMark = '/* lt-context-start */';
const endMark = '/* lt-context-end */';

const ltBlock = `${startMark}
// === Contexto operacional LT (data/hora, restaurante, tabela de preços) ===
let __ltSystemCtx = '';
try {
  const __tz = 'Europe/Brussels';
  const __now = new Date();
  const __fmt = new Intl.DateTimeFormat('pt-BR', { timeZone: __tz, dateStyle: 'full', timeStyle: 'short' });
  const __nowStr = __fmt.format(__now);
  __ltSystemCtx += '\\n\\n## AGORA (fonte da verdade — use SEMPRE esta data/hora; nunca chute):\\n- ' + __nowStr + ' (' + __tz + ')';

  // Restaurante atual
  if (__deliveryCtx && __deliveryCtx.restaurantId) {
    try {
      const __r = await fetch('https://app.vendly.chat/tool/delivery_get_restaurant', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ restaurantId: __deliveryCtx.restaurantId }),
      });
      const __raw = await __r.text();
      let __parsed = null; try { __parsed = JSON.parse(__raw); } catch(_) {}
      const __payload = (__parsed && __parsed.ok && typeof __parsed.result === 'string') ? JSON.parse(__parsed.result) : (__parsed?.result || __parsed);
      const __rest = __payload?.restaurant || __payload;
      if (__rest && (__rest.name || __rest.address)) {
        __ltSystemCtx += '\\n\\n## Restaurante atual (use ESTES dados, nunca invente):';
        if (__rest.name)    __ltSystemCtx += '\\n- Nome: ' + __rest.name;
        if (__rest.address) __ltSystemCtx += '\\n- Endereço de retirada: ' + __rest.address;
        if (__rest.phone)   __ltSystemCtx += '\\n- Telefone: ' + __rest.phone;
        __ltSystemCtx += '\\n- restaurantId: ' + __deliveryCtx.restaurantId;
      }
    } catch (e) { __ltSystemCtx += '\\n\\n[restaurant lookup falhou: ' + String(e.message || e) + ']'; }
  }

  // Tabela de taxas de entrega (do businessDoc.settings)
  const __feeTable = businessDoc?.settings?.deliveryFeeTable;
  if (Array.isArray(__feeTable) && __feeTable.length > 0) {
    __ltSystemCtx += '\\n\\n## Tabela de taxas de entrega (informativa — para valor exato use delivery_calc_fee):';
    for (const __b of __feeTable) {
      __ltSystemCtx += '\\n- ' + __b.minKm + '–' + __b.maxKm + ' km: €' + __b.feeEur;
    }
  }

  // Reforço anti-alucinação curto
  __ltSystemCtx += '\\n\\n## REGRAS ANTI-ALUCINAÇÃO (críticas):\\n'
    + '- NUNCA invente: código de pedido, horário de pronto, taxa, forma de pagamento, telefone, endereço.\\n'
    + '- Forma de pagamento só pode ser citada se o restaurante disse explicitamente nesta conversa.\\n'
    + '- "Já pago via Pix/online" SÓ se o restaurante escreveu isso literalmente; caso contrário PERGUNTE.\\n'
    + '- Horário "pronto às X" só se o restaurante informou; caso contrário PERGUNTE.\\n'
    + '- Código (LT-XXXXXX) é gerado pelo sistema em delivery_confirm_order — NÃO invente nem mostre antes da confirmação.\\n'
    + '- "Retirada" no resumo é o ENDEREÇO do restaurante (acima), não o nome.\\n'
    + '- Se faltar QUALQUER dado essencial, faça UMA pergunta listando tudo de uma vez.';
} catch(__e) { /* não bloqueia o prompt */ }
${endMark}`;

let newCode;
if (oldCode.includes(startMark) && oldCode.includes(endMark)) {
  newCode = oldCode.replace(new RegExp(startMark.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&') + '[\\s\\S]*?' + endMark.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&')), ltBlock);
} else {
  // Inserir após o cálculo de __ctxBlock (logo após a linha que define __ctxBlock)
  const anchor = "const __ctxBlock = __deliveryCtx.restaurantId";
  const idx = oldCode.indexOf(anchor);
  if (idx === -1) throw new Error('âncora não encontrada');
  // Achar o final dessa linha (próximo \n)
  const lineEnd = oldCode.indexOf('\n', idx);
  newCode = oldCode.slice(0, lineEnd + 1) + '\n' + ltBlock + '\n' + oldCode.slice(lineEnd + 1);
}

// Garantir que __ltSystemCtx é concatenado ao sistemaPrompt
// Procurar a definição de sistemaPrompt e anexar __ltSystemCtx
if (!newCode.includes('+ __ltSystemCtx')) {
  newCode = newCode.replace(
    "const sistemaPrompt = (customSystemPrompt || defaultPrompt) + __ctxBlock + customerCtx + intelligenceCtx + audioSystemNote + (__isLtGroup ? \"\" : escalaSystemNote);",
    "const sistemaPrompt = (customSystemPrompt || defaultPrompt) + __ctxBlock + (__ltSystemCtx || '') + customerCtx + intelligenceCtx + audioSystemNote + (__isLtGroup ? \"\" : escalaSystemNote);"
  );
}

node.parameters.jsCode = newCode;

const allowedSettings = ['saveExecutionProgress','saveManualExecutions','saveDataErrorExecution','saveDataSuccessExecution','executionTimeout','errorWorkflow','timezone','executionOrder'];
const cleanSettings = {};
for (const k of allowedSettings) if (wf.settings && wf.settings[k] !== undefined) cleanSettings[k] = wf.settings[k];
if (!cleanSettings.executionOrder) cleanSettings.executionOrder = 'v1';

const body = { name: wf.name, nodes: wf.nodes, connections: wf.connections, settings: cleanSettings };
const r = await fetch(`${N8N}/workflows/${WF_ID}`, { method: 'PUT', headers, body: JSON.stringify(body) });
console.log('status:', r.status);
if (!r.ok) console.error(await r.text()); else console.log('✅ Construir Prompt atualizado');

/**
 * Patch v3: corrige _vendlyCtx no Construir Prompt
 *
 * Fixes:
 * 1. senderPhone: usa senderJid (participante) em vez de msg.telefone (grupo)
 * 2. restaurantId: '' — sem filtro, entregadores servem TODOS os restaurantes
 * 3. Condição: personaKey === 'deliverer' sem checar restaurantId (que agora é vazio)
 */

const N8N_URL = 'https://workflows.vendly.chat';
const N8N_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJjOTVmNTNmZS0zNGYyLTQ2ZWYtODZiZi1kZDFlYWE2MTQyZDYiLCJpc3MiOiJuOG4iLCJhdWQiOiJwdWJsaWMtYXBpIiwianRpIjoiOTM3NjE5OTUtMzMxYy00NTcyLTlmODgtNmIzYTA1MGU1ZDg5IiwiaWF0IjoxNzc4OTU0MzAyfQ.ULL6jWDVEI9hGBRfk86nlo59o5UbPXzLt8qgpxeIDWs';
const WF_AGENT = 'jleu4RPvSnYDL8Gd';

const ALLOWED = [
  'executionOrder','saveManualExecutions','saveDataSuccessExecution',
  'saveDataErrorExecution','saveExecutionProgress','timezone','errorWorkflow','callerPolicy',
];

async function api(wfId, method = 'GET', body = null) {
  const url = `${N8N_URL}/api/v1/workflows/${wfId}`;
  const opts = { method, headers: { 'X-N8N-API-KEY': N8N_KEY, 'Content-Type': 'application/json' } };
  if (body) opts.body = JSON.stringify(body);
  const r = await fetch(url, opts);
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${await r.text().then(t => t.slice(0,300))}`);
  return r.json();
}

const wf = await api(WF_AGENT);
console.log(`Fetched: ${wf.name}`);

for (const n of wf.nodes) {
  if (n.name !== 'Construir Prompt') continue;
  let code = n.parameters.jsCode;

  // Substitui qualquer bloco _vendlyCtx existente pelo correto
  const PATTERNS = [
    // v1: com restaurantId preenchido + senderPhone via msg.telefone
    /\/\/ (?:Contexto para grupo de entregadores|Auto-contexto)[^\n]*\nif \(__deliveryCtx\.personaKey === 'deliverer'[^{]*\{[\s\S]*?__openRouterBody\._vendlyCtx = \{[\s\S]*?\};\s*\}/,
  ];

  const NEW_BLOCK = `// Contexto para grupo de entregadores — processado pelo backend /agent-loop, não exposto ao agente
if (__deliveryCtx.personaKey === 'deliverer') {
  // senderJid = JID do participante (ex: 5521969435536@s.whatsapp.net), msg.telefone = JID do grupo
  const __senderPhone = String(__deliveryCtx.senderJid || msg.telefone || '').replace(/@[^@]+$/, '').replace(/\\D/g, '');
  __openRouterBody._vendlyCtx = {
    personaKey: 'deliverer',
    restaurantId: '',  // vazio = sem filtro: entregadores servem TODOS os restaurantes do business
    senderPhone: __senderPhone,
    instance: msg.instance || null,
    waExternalId: msg.wa_msg_id || null,
  };
}`;

  let replaced = false;
  for (const pat of PATTERNS) {
    if (pat.test(code)) {
      code = code.replace(pat, NEW_BLOCK);
      replaced = true;
      console.log('  _vendlyCtx substituído ✓');
      break;
    }
  }

  if (!replaced) {
    if (code.includes('_vendlyCtx')) {
      console.log('  _vendlyCtx existe mas padrão não reconhecido — imprimindo trecho atual:');
      const idx = code.indexOf('_vendlyCtx');
      console.log(code.slice(Math.max(0, idx-200), idx+400));
    } else {
      console.log('  _vendlyCtx não encontrado — inserindo antes do return');
      const BEFORE_RETURN = 'return [{ json: {';
      const idx = code.lastIndexOf(BEFORE_RETURN);
      code = code.slice(0, idx) + NEW_BLOCK + '\n\n' + code.slice(idx);
      replaced = true;
      console.log('  _vendlyCtx inserido ✓');
    }
  }

  n.parameters.jsCode = code;
  break;
}

const settings = Object.fromEntries(Object.entries(wf.settings ?? {}).filter(([k]) => ALLOWED.includes(k)));
const body = { name: wf.name, nodes: wf.nodes, connections: wf.connections, settings, staticData: wf.staticData ?? null };
const r = await api(WF_AGENT, 'PUT', body);
console.log(`SALVO versionId=${r.versionId}`);
console.log('\n✅ Patch v3 aplicado.');

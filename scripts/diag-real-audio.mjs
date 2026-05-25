import dotenv from 'dotenv';
dotenv.config();
const N8N_KEY = process.env.N8N_API_KEY;
const CW_KEY = 'Db9GHGsN9YVUDhJvD5CHbVTz';
const EXECUTOR_ID = 'jleu4RPvSnYDL8Gd';
const MY_TEST_KEYS = new Set(['3EB05DBEC9D', '3EB07D2A60D', '3EB0813522D', '3EB0CD3879C']); // meus testes

async function n8n(path) {
  const r = await fetch(`https://workflows.vendly.chat/api/v1${path}`, {
    headers: { 'X-N8N-API-KEY': N8N_KEY, 'Accept': 'application/json' }
  });
  return r.json();
}

async function cw(path) {
  const r = await fetch(`https://chatwoot.vendly.chat/api/v1${path}`, {
    headers: { 'api_access_token': CW_KEY }
  });
  return r.json();
}

console.log('=== EXECUÇÕES REAIS DE ÁUDIO (últimas 50, excluindo meus testes) ===\n');

const execs = await n8n(`/executions?workflowId=${EXECUTOR_ID}&limit=50`);

let count = 0;
for (const e of (execs.data ?? [])) {
  const det = await n8n(`/executions/${e.id}?includeData=true`);
  const rd = det.data?.resultData?.runData ?? {};

  // Só execs com áudio (IF Audio? branch true)
  const ifAudio = rd['IF Responder com Audio?']?.[0];
  if (!ifAudio) continue;
  const trueBranch = ifAudio.data?.main?.[0] ?? [];
  if (trueBranch.length === 0) continue;

  // Pegar dados do Parsear Chunks
  const pcItems = rd['Parsear Chunks']?.[0]?.data?.main?.[0] ?? [];
  const convId = pcItems[0]?.json?.conversation_id;
  const chunk = String(pcItems[0]?.json?.chunk ?? '').slice(0, 80);

  // Pegar chave do Evolution para saber se é meu teste
  const evoItems = rd['Evolution send audio']?.[0]?.data?.main?.[0] ?? [];
  const evoKey = String(evoItems[0]?.json?.key?.id ?? '').slice(0, 12);
  const isMyTest = [...MY_TEST_KEYS].some(k => evoKey.startsWith(k));
  
  if (isMyTest) continue; // pular meus testes

  count++;
  console.log(`EXEC ${e.id} [${e.startedAt?.slice(0,19)}] conv=${convId}`);
  console.log(`  chunk: "${chunk}"`);
  
  // Checar Chatwoot Enviar Audio
  const cwAudio = rd['Chatwoot Enviar Audio']?.[0];
  if (cwAudio?.error) console.log(`  Chatwoot Enviar Audio ERRO: ${cwAudio.error.message}`);
  else if (cwAudio) console.log(`  Chatwoot Enviar Audio: ✓ executou`);
  else console.log(`  Chatwoot Enviar Audio: ✗ não executou`);
  
  // Ver mensagens nessa conversa após essa exec
  if (convId) {
    const msgsResp = await cw(`/accounts/1/conversations/${convId}/messages`);
    const msgs = msgsResp.payload ?? [];
    const execTime = new Date(e.startedAt).getTime() / 1000;
    const after = msgs.filter(m => m.created_at > execTime - 60 && m.created_at < execTime + 120);
    
    console.log(`  Mensagens na conv ${convId} no período (±60s):`);
    for (const m of after) {
      const tipo = m.message_type === 0 ? 'IN ' : m.message_type === 1 ? 'OUT' : 'ACT';
      const priv = m.private ? '[PRIV]' : '[PUB] ';
      const att = m.attachments?.length ? ` [${m.attachments.map(a=>a.file_type).join(',')}]` : '';
      console.log(`    ${tipo} ${priv} id=${m.id}${att}: "${String(m.content ?? '').slice(0,80)}"`);
    }
  }
  console.log();
  if (count >= 5) break;
}

if (count === 0) console.log('Nenhuma execução real de áudio encontrada (só meus testes).');

// Também checar todos os grupos/conversas ativos
console.log('\n=== CONVERSAS ATIVAS NA INBOX 11 ===');
const convs = await cw('/accounts/1/conversations?inbox_id=11&page=1');
for (const c of (convs.data?.payload ?? []).slice(0, 5)) {
  console.log(`  conv ${c.id}: "${c.meta?.sender?.name}" status=${c.status}`);
}

import 'dotenv/config';

const CW = process.env.CHATWOOT_URL;
const CW_KEY = process.env.CHATWOOT_API_KEY;
const cwH = { 'api_access_token': CW_KEY, 'Content-Type': 'application/json' };
const N8N = 'https://workflows.vendly.chat';
const N8N_KEY = process.env.N8N_API_KEY;

async function run() {
  // 1. Abrir conversas pendentes no inbox 11 (suporte-redatudo)
  const r = await fetch(`${CW}/api/v1/accounts/1/conversations?assignee_type=all&status=all&page=1`, {
    headers: { 'api_access_token': CW_KEY }
  }).then(r => r.json());
  const convs = r?.data?.payload ?? [];
  const pending = convs.filter(c => c.status === 'pending' && c.inbox_id === 11);
  
  console.log(`Abrindo ${pending.length} conversas pending...`);
  for (const c of pending) {
    const res = await fetch(`${CW}/api/v1/accounts/1/conversations/${c.id}/toggle_status`, {
      method: 'POST',
      headers: cwH,
      body: JSON.stringify({ status: 'open' })
    });
    const data = await res.json();
    console.log(`  Conv ${c.id}: ${c.status} → ${data?.current_status ?? res.status}`);
  }

  // 2. Ver N8N executions (pode ter falhado ou não disparado)
  const execs = await fetch(`${N8N}/api/v1/executions?limit=10&workflowId=bEb19TdWZfFloisU`, {
    headers: { 'X-N8N-API-KEY': N8N_KEY, 'Accept': 'application/json' }
  }).then(r => r.json()).catch(e => ({ error: e.message }));
  console.log('\n=== Execuções recentes N8N Entrada ===');
  (execs?.data ?? []).slice(0, 5).forEach(e => 
    console.log(`  ${e.id} | ${e.status} | ${new Date(e.startedAt).toISOString()}`)
  );
  if ((execs?.data ?? []).length === 0) console.log('  (nenhuma execução)');
}

run().catch(e => console.error(e));

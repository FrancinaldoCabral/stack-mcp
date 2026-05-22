import 'dotenv/config';

const CW = process.env.CHATWOOT_URL;
const CW_KEY = process.env.CHATWOOT_API_KEY;
const cwH = { 'api_access_token': CW_KEY };

async function run() {
  // Buscar todas as conversas com status=all
  const r = await fetch(`${CW}/api/v1/accounts/1/conversations?assignee_type=all&status=all&page=1`, { headers: cwH });
  const data = await r.json();
  const convs = data?.data?.payload ?? [];
  
  console.log('Total conversas:', data?.data?.meta?.all_count);
  console.log('');
  
  for (const c of convs) {
    console.log(`--- Conversa ${c.id} ---`);
    console.log('  status:', c.status);
    console.log('  inbox_id:', c.inbox_id);
    console.log('  inbox_name:', c.meta?.channel ?? c.inbox?.name ?? '?');
    console.log('  assignee:', c.meta?.assignee?.name ?? 'none');
    console.log('  contact:', c.meta?.sender?.name, '|', c.meta?.sender?.phone_number);
    console.log('  msgs count:', c.messages?.length ?? '?');
    console.log('  last msg:', c.messages?.[c.messages.length-1]?.content?.slice(0,80));
    console.log('  created_at:', new Date(c.created_at * 1000).toISOString());
  }
  
  // Checar inbox de cada conversa
  const inboxIds = [...new Set(convs.map(c => c.inbox_id))];
  console.log('\n=== Inboxes usadas ===');
  const inboxes = await fetch(`${CW}/api/v1/accounts/1/inboxes`, { headers: cwH }).then(r => r.json());
  inboxIds.forEach(id => {
    const inbox = (inboxes.payload ?? []).find(i => i.id === id);
    console.log(`  Inbox ${id}: ${inbox?.name} | type: ${inbox?.channel_type}`);
  });
}

run().catch(e => console.error(e));

import 'dotenv/config';

const EV = process.env.EVOLUTION_URL;
const EK = process.env.EVOLUTION_API_KEY;
const CW = process.env.CHATWOOT_URL;
const CW_KEY = process.env.CHATWOOT_API_KEY;

async function run() {
  const evH = { 'apikey': EK };
  const cwH = { 'api_access_token': CW_KEY };

  // 1. Status detalhado da instância
  const inst = await fetch(`${EV}/instance/fetchInstances`, { headers: evH }).then(r => r.json());
  const found = (Array.isArray(inst) ? inst : [inst]).find(i => i.instance?.instanceName === 'suporte-redatudo' || i.instanceName === 'suporte-redatudo');
  console.log('=== Instance ===');
  console.log(JSON.stringify(found?.instance ?? found, null, 2));

  // 2. Histórico de mensagens recentes (últimas 5)
  const msgs = await fetch(`${EV}/chat/findMessages/suporte-redatudo`, {
    method: 'POST',
    headers: { ...evH, 'Content-Type': 'application/json' },
    body: JSON.stringify({ where: {}, limit: 5 })
  }).then(r => r.json()).catch(e => ({ error: e.message }));
  console.log('\n=== Últimas mensagens na Evolution ===');
  if (msgs.messages?.records) {
    msgs.messages.records.forEach(m => console.log(
      `  ${m.key?.fromMe ? 'OUT' : 'IN '} | ${m.key?.remoteJid} | ${m.message?.conversation ?? m.message?.extendedTextMessage?.text ?? '(midia)'}`
    ));
  } else {
    console.log(JSON.stringify(msgs).slice(0, 300));
  }

  // 3. Contatos no Chatwoot (deve ter sido criado se Evolution sincronizou)
  const contacts = await fetch(`${CW}/api/v1/accounts/1/contacts?page=1`, { headers: cwH }).then(r => r.json());
  console.log('\n=== Contatos no Chatwoot ===');
  console.log('total:', contacts.meta?.count ?? 0);
  (contacts.payload ?? []).slice(0, 5).forEach(c => console.log(`  ${c.id} | ${c.name} | ${c.phone_number}`));

  // 4. Todas as conversas (todos os status)
  const convs = await fetch(`${CW}/api/v1/accounts/1/conversations?assignee_type=all&status=all&page=1`, { headers: cwH }).then(r => r.json());
  console.log('\n=== Conversas no Chatwoot ===');
  console.log('total:', convs?.data?.meta?.all_count ?? 0);
}

run().catch(e => console.error(e));

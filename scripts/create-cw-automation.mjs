import 'dotenv/config';

const CW = process.env.CHATWOOT_URL;
const CW_KEY = process.env.CHATWOOT_API_KEY;
const h = { 'api_access_token': CW_KEY, 'Content-Type': 'application/json' };

async function run() {
  // 1. Ver automações existentes
  const existing = await fetch(`${CW}/api/v1/accounts/1/automation_rules`, { headers: h }).then(r => r.json());
  console.log('Automações existentes:', existing?.length ?? JSON.stringify(existing).slice(0, 100));

  // 2. Criar automação: quando conversa criada no inbox 11, mudar status para open
  const rule = {
    name: 'Auto-open suporte-redatudo',
    description: 'Abre automaticamente conversas do inbox suporte-redatudo para o Agent Bot responder',
    event_name: 'conversation_created',
    conditions: [
      {
        attribute_key: 'inbox_id',
        filter_operator: 'equal_to',
        values: [11],
        query_operator: null
      }
    ],
    actions: [
      {
        action_name: 'update_status',
        action_params: ['open']
      }
    ],
    active: true
  };

  const r = await fetch(`${CW}/api/v1/accounts/1/automation_rules`, {
    method: 'POST',
    headers: h,
    body: JSON.stringify(rule)
  });
  const status = r.status;
  const res = await r.json();
  console.log('\nCriar automação status:', status);
  console.log('Response:', JSON.stringify(res).slice(0, 300));
}

run().catch(e => console.error(e));

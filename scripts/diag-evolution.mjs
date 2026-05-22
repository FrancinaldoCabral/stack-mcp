import 'dotenv/config';

const EV = process.env.EVOLUTION_URL;
const EK = process.env.EVOLUTION_API_KEY;
const h = { 'apikey': EK };

async function run() {
  // Status da instância
  const status = await fetch(`${EV}/instance/fetchInstances?instanceName=suporte-redatudo`, { headers: h }).then(r => r.json());
  const inst = Array.isArray(status) ? status[0] : status;
  console.log('Instance state:', inst?.instance?.state ?? inst?.state ?? 'unknown');
  console.log('Instance connectionStatus:', inst?.instance?.connectionStatus ?? inst?.connectionStatus ?? 'unknown');

  // Config Chatwoot
  const cw = await fetch(`${EV}/chatwoot/find/suporte-redatudo`, { headers: h }).then(r => r.json());
  console.log('\n--- Chatwoot config ---');
  console.log('enabled:', cw.enabled);
  console.log('accountId:', cw.accountId);
  console.log('token:', cw.token?.slice(0, 10) + '...');
  console.log('url:', cw.url);
  console.log('nameInbox:', cw.nameInbox);
  console.log('autoCreate:', cw.autoCreate);
  console.log('reopenConversation:', cw.reopenConversation);
  console.log('conversationPending:', cw.conversationPending);

  // Verificar webhook da instância
  const wh = await fetch(`${EV}/webhook/find/suporte-redatudo`, { headers: h }).then(r => r.json());
  const whData = wh.webhook ?? wh;
  console.log('\n--- Webhook config ---');
  console.log('url:', whData.url ?? 'none');
  console.log('enabled:', whData.enabled ?? 'none');
  console.log('events:', JSON.stringify(whData.events ?? []));

  // Checar se Chatwoot inbox 11 existe com tipo correto
  const CW_URL = process.env.CHATWOOT_URL;
  const CW_KEY = process.env.CHATWOOT_API_KEY;
  const inboxes = await fetch(`${CW_URL}/api/v1/accounts/1/inboxes`, {
    headers: { 'api_access_token': CW_KEY }
  }).then(r => r.json());
  const inbox11 = (inboxes.payload ?? []).find(i => i.id === 11);
  console.log('\n--- Chatwoot inbox 11 ---');
  console.log('name:', inbox11?.name);
  console.log('channel_type:', inbox11?.channel_type);
  console.log('phone_number:', inbox11?.phone_number);
  console.log('inbox_identifier:', inbox11?.inbox_identifier);
  
  // Ver se agente bot está no inbox via GET
  const botR = await fetch(`${CW_URL}/api/v1/accounts/1/inboxes/11/agent_bot`, {
    headers: { 'api_access_token': CW_KEY }
  }).then(r => r.json());
  console.log('agent_bot assigned:', JSON.stringify(botR).slice(0, 100));
}

run().catch(e => console.error(e));

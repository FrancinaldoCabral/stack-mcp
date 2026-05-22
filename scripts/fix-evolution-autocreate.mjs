import 'dotenv/config';

const EV = process.env.EVOLUTION_URL;
const EK = process.env.EVOLUTION_API_KEY;
const h = { 'apikey': EK, 'Content-Type': 'application/json' };

async function run() {
  // Re-setar config Chatwoot com autoCreate: true
  const body = {
    enabled: true,
    accountId: "1",
    token: process.env.CHATWOOT_API_KEY,
    url: process.env.CHATWOOT_URL,
    nameInbox: "suporte-redatudo",
    signMsg: false,
    reopenConversation: true,
    conversationPending: false,
    autoCreate: true,
  };

  const r = await fetch(`${EV}/chatwoot/set/suporte-redatudo`, {
    method: 'POST',
    headers: h,
    body: JSON.stringify(body),
  });
  const status = r.status;
  const res = await r.json();
  console.log('set chatwoot status:', status);
  console.log('response:', JSON.stringify(res).slice(0, 300));

  // Confirmar
  const cw = await fetch(`${EV}/chatwoot/find/suporte-redatudo`, { headers: { 'apikey': EK } }).then(r => r.json());
  console.log('\nautoCreate agora:', cw.autoCreate);
  console.log('enabled:', cw.enabled);
  console.log('reopenConversation:', cw.reopenConversation);
}

run().catch(e => console.error(e));

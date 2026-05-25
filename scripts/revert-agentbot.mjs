import dotenv from 'dotenv';
dotenv.config();
const CW_BASE = process.env.CHATWOOT_URL;
const CW_H = { 'api_access_token': process.env.CHATWOOT_API_KEY, 'Content-Type': 'application/json' };

// Remover Agent Bot do inbox 11
const r = await fetch(`${CW_BASE}/api/v1/accounts/1/inboxes/11/set_agent_bot`, {
  method: 'POST', headers: CW_H,
  body: JSON.stringify({ agent_bot: null }),
});
console.log('Remover Agent Bot status:', r.status, await r.text());

// Verificar
const verify = await fetch(`${CW_BASE}/api/v1/accounts/1/inboxes/11/agent_bot`, { headers: CW_H });
const vBody = await verify.json().catch(() => ({}));
console.log('Agent Bot agora:', JSON.stringify(vBody));

// Ver account webhooks (cw-auto-open)
const wh = await fetch(`${CW_BASE}/api/v1/accounts/1/integrations/webhooks`, { headers: CW_H });
const whBody = await wh.json().catch(() => ({}));
console.log('Account webhooks:', JSON.stringify(whBody, null, 2));

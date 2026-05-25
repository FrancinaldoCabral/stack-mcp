import dotenv from 'dotenv';
dotenv.config();
const CW_BASE = process.env.CHATWOOT_URL;
const CW_H = { 'api_access_token': process.env.CHATWOOT_API_KEY, 'Content-Type': 'application/json' };

// Tentar sem wrapper channel
const r1 = await fetch(`${CW_BASE}/api/v1/accounts/1/inboxes/11`, {
  method: 'PATCH', headers: CW_H,
  body: JSON.stringify({ enable_auto_assignment: false }),
});
const b1 = await r1.json().catch(()=>({}));
console.log('Sem channel wrapper:', r1.status, 'auto_assign:', b1.enable_auto_assignment);

// Ver resposta completa para entender campos
console.log(JSON.stringify(b1, null, 2));

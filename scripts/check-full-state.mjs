import dotenv from 'dotenv';
dotenv.config();
const CW_BASE = process.env.CHATWOOT_URL;
const CW_H = { 'api_access_token': process.env.CHATWOOT_API_KEY, 'Content-Type': 'application/json' };

// Account webhooks (formato correto)
const r = await fetch(`${CW_BASE}/api/v1/accounts/1/integrations/webhooks`, { headers: CW_H });
console.log('Status:', r.status);
const body = await r.text();
console.log('Webhooks response:', body);

// Verificar inbox 11 completo
const inbox = await fetch(`${CW_BASE}/api/v1/accounts/1/inboxes/11`, { headers: CW_H }).then(r => r.json());
console.log('\nInbox channel_type:', inbox.channel_type);
console.log('enable_auto_assignment:', inbox.enable_auto_assignment);
console.log('working_hours_enabled:', inbox.working_hours_enabled);

// Verificar Agent Bot
const ab = await fetch(`${CW_BASE}/api/v1/accounts/1/inboxes/11/agent_bot`, { headers: CW_H }).then(r => r.json());
console.log('\nAgent Bot atual:', ab?.agent_bot?.name ?? JSON.stringify(ab));

// Listar membros do inbox
const members = await fetch(`${CW_BASE}/api/v1/accounts/1/inbox_members/11`, { headers: CW_H }).then(r => r.json());
console.log('Members:', JSON.stringify(members?.payload?.map(m => m.name) ?? members));

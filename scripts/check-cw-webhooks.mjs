import dotenv from 'dotenv';
dotenv.config();
const CW_BASE = process.env.CHATWOOT_URL;
const CW_H = { 'api_access_token': process.env.CHATWOOT_API_KEY, 'Content-Type': 'application/json' };

// Tentar endpoints diferentes para webhooks
const endpoints = [
  '/api/v1/accounts/1/integrations/webhooks',
  '/api/v1/integrations/webhooks',
  '/auth/sign_in',
];
for (const ep of endpoints) {
  const r = await fetch(`${CW_BASE}${ep}`, { headers: CW_H });
  console.log(`${ep} → ${r.status}`);
}

// Ver configuração do Agent Bot
const bots = await fetch(`${CW_BASE}/api/v1/accounts/1/agent_bots`, { headers: CW_H }).then(r => r.json()).catch(() => ({}));
console.log('\nAgent Bots:', JSON.stringify(bots).slice(0, 500));

// Verificar via super admin API
const r2 = await fetch(`${CW_BASE}/api/v1/profile`, { headers: CW_H }).then(r => r.json()).catch(() => ({}));
console.log('\nProfile role:', r2.role ?? JSON.stringify(r2).slice(0, 100));

// Se for admin, tentar super admin endpoint
const r3 = await fetch(`${CW_BASE}/api/v1/accounts/1/integrations/webhooks?api_access_token=${process.env.CHATWOOT_API_KEY}`);
console.log('\nWebhooks query param status:', r3.status, await r3.text().then(t => t.slice(0, 200)));

import dotenv from 'dotenv';
dotenv.config();
const EVO = process.env.EVOLUTION_URL;
const EVO_H = { 'apikey': process.env.EVOLUTION_API_KEY, 'Content-Type': 'application/json' };
const CW_BASE = process.env.CHATWOOT_URL;
const CW_H = { 'api_access_token': process.env.CHATWOOT_API_KEY, 'Content-Type': 'application/json' };

// Listar instâncias Evolution
const instances = await fetch(`${EVO}/instance/fetchInstances`, { headers: EVO_H }).then(r => r.json()).catch(() => ({}));
const instanceNames = Array.isArray(instances) ? instances.map(i => i.instance?.instanceName ?? i.instanceName) : [];
console.log('Instâncias Evolution:', instanceNames);

// Para cada instância, ver webhook config
for (const inst of instanceNames.slice(0, 3)) {
  const wh = await fetch(`${EVO}/webhook/find/${inst}`, { headers: EVO_H }).then(r => r.json()).catch(() => ({}));
  console.log(`\nWebhook ${inst}:`, JSON.stringify(wh, null, 2));
}

// Account webhooks Chatwoot (path correto)
const wh1 = await fetch(`${CW_BASE}/api/v1/accounts/1/integrations/webhooks`, { headers: CW_H }).then(r => r.json()).catch(() => ({}));
console.log('\nChatwoot account webhooks (v1):', JSON.stringify(wh1));

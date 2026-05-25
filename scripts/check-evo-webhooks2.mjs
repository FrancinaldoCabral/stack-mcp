import dotenv from 'dotenv';
dotenv.config();
const EVO = process.env.EVOLUTION_URL;
const EVO_H = { 'apikey': process.env.EVOLUTION_API_KEY };

// Listar instâncias (formato correto)
const r = await fetch(`${EVO}/instance/fetchInstances`, { headers: EVO_H });
const body = await r.json().catch(() => ({}));
console.log('Raw instances response:', JSON.stringify(body).slice(0, 500));

// Tentar endpoints diferentes
for (const path of ['/instance/fetchInstances', '/instance/list']) {
  const r2 = await fetch(`${EVO}${path}`, { headers: EVO_H });
  const b2 = await r2.json().catch(() => ({}));
  const names = Array.isArray(b2) ? b2.map(i => i.name ?? i.instanceName ?? i.instance?.instanceName) : Object.keys(b2);
  if (names.length > 0) {
    console.log(`\nInstâncias via ${path}:`, names);
    // Verificar webhook da primeira instância
    const inst = names[0];
    const wh = await fetch(`${EVO}/webhook/find/${inst}`, { headers: EVO_H }).then(r3 => r3.json()).catch(() => ({}));
    console.log(`Webhook ${inst}:`, JSON.stringify(wh, null, 2));

    // Chatwoot config da instância
    const cw = await fetch(`${EVO}/chatwoot/find/${inst}`, { headers: EVO_H }).then(r3 => r3.json()).catch(() => ({}));
    console.log(`Chatwoot ${inst}:`, JSON.stringify(cw, null, 2));
  }
}

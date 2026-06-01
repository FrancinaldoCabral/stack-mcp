// Substitui todas as ocorrências da URL antiga sslip
// "http://fco8og80s4sw4c0wc0ogswws.157.173.111.65.sslip.io" por
// "https://app.vendly.chat" em todos os workflows N8N.

import 'dotenv/config';

const N8N_URL = process.env.N8N_URL || 'https://workflows.vendly.chat';
const N8N_KEY = process.env.N8N_API_KEY;
if (!N8N_KEY) { console.error('N8N_API_KEY ausente'); process.exit(1); }

const OLD = ['http://', 'fco8og80s4sw4c0wc0ogswws.157.173.111.65.sslip.io'].join('');
const NEW = 'https://app.vendly.chat';

const headers = {
  'X-N8N-API-KEY': N8N_KEY,
  'Content-Type': 'application/json',
  'Accept': 'application/json',
};

const allowedSettingsKeys = ['saveExecutionProgress','saveManualExecutions','saveDataErrorExecution','saveDataSuccessExecution','executionTimeout','errorWorkflow','timezone','executionOrder'];

function filterSettings(s) {
  const out = {};
  for (const k of allowedSettingsKeys) if (s && s[k] !== undefined) out[k] = s[k];
  if (!out.executionOrder) out.executionOrder = 'v1';
  return out;
}

function replaceInString(s) {
  return typeof s === 'string' && s.includes(OLD) ? s.split(OLD).join(NEW) : s;
}

function walk(obj) {
  if (!obj || typeof obj !== 'object') return 0;
  let n = 0;
  for (const k of Object.keys(obj)) {
    const v = obj[k];
    if (typeof v === 'string') {
      const nv = replaceInString(v);
      if (nv !== v) { obj[k] = nv; n++; }
    } else if (v && typeof v === 'object') {
      n += walk(v);
    }
  }
  return n;
}

const list = await fetch(`${N8N_URL}/api/v1/workflows`, { headers }).then(r => r.json());
const workflows = list.data || [];
console.log(`workflows encontrados: ${workflows.length}\n`);

for (const meta of workflows) {
  const wf = await fetch(`${N8N_URL}/api/v1/workflows/${meta.id}`, { headers }).then(r => r.json());
  const replaced = walk(wf.nodes);
  if (replaced === 0) {
    console.log(`  ${meta.id}  ${meta.name}  — sem ocorrências`);
    continue;
  }
  const body = {
    name: wf.name,
    nodes: wf.nodes,
    connections: wf.connections,
    settings: filterSettings(wf.settings),
  };
  const res = await fetch(`${N8N_URL}/api/v1/workflows/${meta.id}`, {
    method: 'PUT', headers, body: JSON.stringify(body),
  });
  const txt = await res.text();
  if (!res.ok) {
    console.log(`  ✗ ${meta.id}  ${meta.name}  — PUT ${res.status}: ${txt.slice(0,200)}`);
  } else {
    console.log(`  ✅ ${meta.id}  ${meta.name}  — ${replaced} substituições`);
  }
}
console.log('\nDone.');

import 'dotenv/config';

const h = {'X-N8N-API-KEY': process.env.N8N_API_KEY, 'Accept': 'application/json'};
const BASE = 'https://workflows.vendly.chat/api/v1';

const r = await fetch(`${BASE}/executions/663`, {headers: h});
const det = await r.json();
// Dump top-level keys
console.log('Top keys:', Object.keys(det));
console.log('data keys:', Object.keys(det.data ?? {}));
console.log(JSON.stringify(det).slice(0, 2000));

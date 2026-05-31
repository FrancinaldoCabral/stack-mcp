import fs from 'node:fs';
const env = Object.fromEntries(fs.readFileSync('.env','utf8').split(/\r?\n/).filter(l=>l&&!l.startsWith('#')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i),l.slice(i+1)]}));
const N8N=env.N8N_URL, KEY=env.N8N_API_KEY;
const H={'X-N8N-API-KEY':KEY,'Accept':'application/json'};

async function getError(id) {
  const e = await fetch(`${N8N}/api/v1/executions/${id}?includeData=true`,{headers:H}).then(r=>r.json());
  const rd = e.data?.resultData;
  const err = rd?.error;
  // Find which node errored
  const runData = rd?.runData || {};
  let errorNode = null, errorMsg = null;
  for (const [nodeName, runs] of Object.entries(runData)) {
    for (const run of runs) {
      if (run.error) { errorNode = nodeName; errorMsg = run.error.message; }
    }
  }
  return { id, status: e.status, startedAt: e.startedAt?.slice(0,19), errorNode, errorMsg: errorMsg || err?.message || JSON.stringify(err)?.slice(0,200) };
}

console.log('=== Diagnóstico de execuções com erro ===\n');

// CORE errors: 3332, 3331, 3328, 3327
// AGENT errors: 3218, 3035, 3013, 3012
const ids = [3332, 3331, 3328, 3327, 3218, 3035, 3013, 3012];
for (const id of ids) {
  const r = await getError(id);
  console.log(`[${r.id}] ${r.startedAt} | nó: ${r.errorNode || '?'} | erro: ${r.errorMsg?.slice(0,150)}`);
}

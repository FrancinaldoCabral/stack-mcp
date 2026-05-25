import dotenv from 'dotenv';
dotenv.config();
const N8N_KEY = process.env.N8N_API_KEY;

async function n8n(path) {
  const r = await fetch(`https://workflows.vendly.chat/api/v1${path}`, {
    headers: { 'X-N8N-API-KEY': N8N_KEY, 'Accept': 'application/json' }
  });
  return r.json();
}

// Ver exec 1322 raw
const detail = await n8n('/executions/1322?includeData=true');
console.log('Keys top-level:', Object.keys(detail));
console.log('data keys:', Object.keys(detail.data ?? {}));
console.log('resultData keys:', Object.keys(detail.data?.resultData ?? {}));
console.log('runData keys count:', Object.keys(detail.data?.resultData?.runData ?? {}).length);
console.log('executionData keys:', Object.keys(detail.executionData ?? {}));
console.log('\nFull exec (sem runData):', JSON.stringify({
  id: detail.id,
  status: detail.status,
  mode: detail.mode,
  startedAt: detail.startedAt,
  stoppedAt: detail.stoppedAt,
  workflowId: detail.workflowId,
  finished: detail.finished,
}, null, 2));

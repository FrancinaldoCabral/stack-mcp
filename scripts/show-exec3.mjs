import 'dotenv/config';
const H = { 'X-N8N-API-KEY': process.env.N8N_API_KEY, 'Accept': 'application/json' };
const exec = await fetch('https://workflows.vendly.chat/api/v1/executions/831?includeData=true', { headers: H }).then(r => r.json());
const prep = exec.data?.resultData?.runData?.['Prep Transcrição']?.[0]?.data?.main?.[0]?.[0]?.json;
console.log('Full prep:', JSON.stringify(prep, null, 2));

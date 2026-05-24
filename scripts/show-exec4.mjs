import 'dotenv/config';
const H = { 'X-N8N-API-KEY': process.env.N8N_API_KEY, 'Accept': 'application/json' };
const exec = await fetch('https://workflows.vendly.chat/api/v1/executions/836?includeData=true', { headers: H }).then(r => r.json());
const nodes = exec.data?.resultData?.runData ?? {};
console.log('Nodes:', Object.keys(nodes).join(', '));

const ba = nodes['Baixar Áudio']?.[0];
console.log('Baixar Áudio error full:', JSON.stringify(ba?.error)?.slice(0, 600));
console.log('Baixar Áudio json:', JSON.stringify(ba?.data?.main?.[0]?.[0]?.json)?.slice(0, 200));

// Check what URL was called
const prep = nodes['Prep Transcrição']?.[0]?.data?.main?.[0]?.[0]?.json;
console.log('Prep audioUrl:', prep?.audioUrl?.slice(0, 100));

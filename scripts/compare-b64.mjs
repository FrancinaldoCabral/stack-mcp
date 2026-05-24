import 'dotenv/config';

const AUDIO_URL = 'https://upload.wikimedia.org/wikipedia/commons/c/c8/Example.ogg';

// Method 1: fetch (works in direct test)
const r1 = await fetch(AUDIO_URL);
const b1 = Buffer.from(await r1.arrayBuffer());
const b64_1 = b1.toString('base64');
console.log('Method 1 (fetch): size=', b1.length, 'b64 len=', b64_1.length, 'sig=', b1.slice(0,4).toString('ascii'));
console.log('b64 start:', b64_1.slice(0,30));

// Compare with N8N execution base64
const H = { 'X-N8N-API-KEY': process.env.N8N_API_KEY, 'Accept': 'application/json' };
const exec = await fetch('https://workflows.vendly.chat/api/v1/executions/798?includeData=true', { headers: H }).then(r => r.json());
const prep = exec.data?.resultData?.runData?.['Prep Transcrição']?.[0]?.data?.main?.[0]?.[0]?.json;
const b64_n8n = prep?.audioBase64;
console.log('\nN8N base64: len=', b64_n8n?.length, 'start:', b64_n8n?.slice(0,30));
console.log('Match:', b64_1 === b64_n8n);
console.log('Method1 buf decoded from n8n b64:', Buffer.from(b64_n8n, 'base64').slice(0,4).toString('ascii'));

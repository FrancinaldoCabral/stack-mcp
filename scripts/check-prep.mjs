import 'dotenv/config';
const H = { 'X-N8N-API-KEY': process.env.N8N_API_KEY, 'Accept': 'application/json' };
const exec = await fetch('https://workflows.vendly.chat/api/v1/executions/798?includeData=true', { headers: H }).then(r => r.json());
const nodes = exec.data?.resultData?.runData ?? {};

const prep = nodes['Prep Transcrição']?.[0]?.data?.main?.[0]?.[0]?.json;
console.log('Prep audioOk:', prep?.audioOk, '| mimeType:', prep?.audioMimeType, '| base64 len:', prep?.audioBase64?.length);

// Show first and last few chars of base64
const b64 = prep?.audioBase64 ?? '';
console.log('base64 start:', b64.slice(0, 30), '...');
console.log('base64 end:', '...', b64.slice(-20));

// Check if it's valid base64
const buf = Buffer.from(b64, 'base64');
console.log('Decoded size:', buf.length, 'bytes');
console.log('OGG sig:', buf.slice(0, 4).toString('ascii'));

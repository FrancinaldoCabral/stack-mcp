import 'dotenv/config';
const H = { 'X-N8N-API-KEY': process.env.N8N_API_KEY, 'Accept': 'application/json' };
const exec = await fetch('https://workflows.vendly.chat/api/v1/executions/826?includeData=true', { headers: H }).then(r => r.json());
const ba = exec.data?.resultData?.runData?.['Baixar Áudio']?.[0];
const jsonData = ba?.data?.main?.[0]?.[0]?.json?.data;

console.log('data type:', typeof jsonData, 'len:', jsonData?.length);
// Os primeiros chars
for (let i = 0; i < 20; i++) {
  const ch = jsonData?.charCodeAt(i);
  process.stdout.write(ch?.toString(16).padStart(2,'0') + ' ');
}
console.log();

// Try to convert to Buffer via latin1
const buf = Buffer.from(jsonData ?? '', 'latin1');
console.log('latin1 buf len:', buf.length, 'sig:', buf.slice(0,4).toString('ascii'));
console.log('b64 start:', buf.toString('base64').slice(0,30));
console.log('Expected:        T2dnUwACAAAAAAAAAABdwLNHAAAAAN');

// Compare sizes
const r = await fetch('https://upload.wikimedia.org/wikipedia/commons/c/c8/Example.ogg');
const correct = Buffer.from(await r.arrayBuffer());
console.log('\ncorrect len:', correct.length, 'buf len:', buf.length, 'match?', buf.equals(correct));

import 'dotenv/config';

const H = { 'X-N8N-API-KEY': process.env.N8N_API_KEY, 'Accept': 'application/json' };
const exec = await fetch('https://workflows.vendly.chat/api/v1/executions/826?includeData=true', { headers: H }).then(r => r.json());
const ba = exec.data?.resultData?.runData?.['Baixar Áudio']?.[0];
const jsonData = ba?.data?.main?.[0]?.[0]?.json?.data;

// Check char at position 102
console.log('char[102] codepoint:', jsonData?.charCodeAt(102)?.toString(16));
console.log('char[178] codepoint:', jsonData?.charCodeAt(178)?.toString(16));
// Expected: 0x91, 0x80

// The issue: when N8N serializes bytes > 0x7F to JSON, they are stored as Unicode chars
// but bytes like 0x91 (Private Use Area) may be normalized by Node/V8 during JSON.stringify

// Check: is the char[102] already wrong in the raw JSON?
// We know buf2[102] = 0x18 after latin1 decode, but we want 0x91
// That means jsonData.charCodeAt(102) = 0x18 ??? (not 0x91)
// OR: latin1 decoded 0x18 but original was 0x91

// Let's verify what the N8N execution actually stored
const rawJson = JSON.stringify(ba?.data?.main?.[0]?.[0]?.json?.data ?? '');
// Find character at position ~102
const segment = rawJson.slice(105, 115);
console.log('raw JSON around pos 102:', segment);

// Actually let's see the binary of the buf2
const buf2 = Buffer.from(jsonData, 'latin1');
console.log('buf2[100-110]:', Array.from(buf2.slice(100, 110)).map(b => b.toString(16).padStart(2,'0')).join(' '));

// Fetch correct
const r = await fetch('https://upload.wikimedia.org/wikipedia/commons/c/c8/Example.ogg');
const buf1 = Buffer.from(await r.arrayBuffer());
console.log('buf1[100-110]:', Array.from(buf1.slice(100, 110)).map(b => b.toString(16).padStart(2,'0')).join(' '));

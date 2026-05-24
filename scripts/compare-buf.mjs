import 'dotenv/config';
import crypto from 'crypto';

// Source 1: fetch direto (funciona)
const r1 = await fetch('https://upload.wikimedia.org/wikipedia/commons/c/c8/Example.ogg');
const buf1 = Buffer.from(await r1.arrayBuffer());
const b64_1 = buf1.toString('base64');

// Source 2: json.data do N8N via latin1
const H = { 'X-N8N-API-KEY': process.env.N8N_API_KEY, 'Accept': 'application/json' };
const exec = await fetch('https://workflows.vendly.chat/api/v1/executions/826?includeData=true', { headers: H }).then(r => r.json());
const ba = exec.data?.resultData?.runData?.['Baixar Áudio']?.[0];
const jsonData = ba?.data?.main?.[0]?.[0]?.json?.data;
const buf2 = Buffer.from(jsonData, 'latin1');
const b64_2 = buf2.toString('base64');

console.log('buf1 len:', buf1.length, 'md5:', crypto.createHash('md5').update(buf1).digest('hex'));
console.log('buf2 len:', buf2.length, 'md5:', crypto.createHash('md5').update(buf2).digest('hex'));
console.log('b64 match?', b64_1 === b64_2);

// Find first diff byte
let diffCount = 0;
for (let i = 0; i < Math.min(buf1.length, buf2.length); i++) {
  if (buf1[i] !== buf2[i]) {
    if (diffCount < 5) console.log(`byte[${i}]: buf1=0x${buf1[i].toString(16)} buf2=0x${buf2[i].toString(16)}`);
    diffCount++;
  }
}
console.log('Total diff bytes:', diffCount);

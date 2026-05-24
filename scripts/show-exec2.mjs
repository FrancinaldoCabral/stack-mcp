import 'dotenv/config';
const H = { 'X-N8N-API-KEY': process.env.N8N_API_KEY, 'Accept': 'application/json' };
const exec = await fetch('https://workflows.vendly.chat/api/v1/executions/826?includeData=true', { headers: H }).then(r => r.json());
const nodes = exec.data?.resultData?.runData ?? {};
console.log('Nodes executados:', Object.keys(nodes).join(', '));

const ba = nodes['Baixar Áudio']?.[0];
console.log('\nBaixar Áudio:', ba ? 'executou' : 'NÃO executou');
if (ba) {
  const err = ba.error;
  const json = ba.data?.main?.[0]?.[0]?.json;
  const bin = ba.data?.main?.[0]?.[0]?.binary;
  console.log('error:', JSON.stringify(err)?.slice(0, 200));
  console.log('json:', JSON.stringify(json)?.slice(0, 100));
  console.log('binary keys:', Object.keys(bin ?? {}));
  if (bin?.data) console.log('binary.data.mimeType:', bin.data.mimeType, 'len data:', bin.data.data?.length);
}

const ta = nodes['Transcrever Áudio']?.[0];
console.log('\nTranscrever Áudio:', ta ? 'executou' : 'NÃO executou');
if (ta) {
  const err = ta.error;
  console.log('error:', JSON.stringify(err)?.slice(0, 200));
}

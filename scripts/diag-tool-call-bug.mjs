import fs from 'node:fs';
const env = Object.fromEntries(fs.readFileSync('.env','utf8').split(/\r?\n/).filter(l=>l&&!l.startsWith('#')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i),l.slice(i+1)]}));
const N8N=env.N8N_URL, KEY=env.N8N_API_KEY;
const NH={'X-N8N-API-KEY':KEY,'Accept':'application/json'};

const wf = await fetch(`${N8N}/api/v1/workflows/jleu4RPvSnYDL8Gd`, {headers:NH}).then(r=>r.json());

// OpenRouter Com Ferramenta - ver jsonBody
const ocf = wf.nodes.find(n=>n.name==='OpenRouter Com Ferramenta');
console.log('=== OpenRouter Com Ferramenta params ===');
console.log('url:', ocf?.parameters?.url);
console.log('jsonBody:', ocf?.parameters?.jsonBody?.slice(0,300));
console.log('specifyBody:', ocf?.parameters?.specifyBody);

// Montar Tool Result - código completo
const mtr = wf.nodes.find(n=>n.name==='Montar Tool Result');
console.log('\n=== Montar Tool Result jsCode ===');
console.log(mtr?.parameters?.jsCode || '(sem jsCode)');

// Exec 3218 - ver output de Montar Tool Result
console.log('\n=== Exec 3218: Montar Tool Result output ===');
const exc = await fetch(`${N8N}/api/v1/executions/3218?includeData=true`, {headers:NH}).then(r=>r.json());
const rd = exc.data?.resultData?.runData;
const mtrOut = rd?.['Montar Tool Result']?.[0]?.data?.main?.[0]?.[0]?.json;
console.log(JSON.stringify(mtrOut, null, 2).slice(0,1000));

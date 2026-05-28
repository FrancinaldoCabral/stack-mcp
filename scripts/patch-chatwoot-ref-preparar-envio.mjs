// Faz Chatwoot Enviar referenciar Preparar Envio (porque Evolution Enviar sobrescreveu $json com sua resposta)
import fs from 'node:fs';
const env = Object.fromEntries(fs.readFileSync('.env','utf8').split(/\r?\n/).filter(l=>l && !l.startsWith('#')).map(l=>{const i=l.indexOf('=');return [l.slice(0,i), l.slice(i+1)]}));
const N8N=env.N8N_URL, KEY=env.N8N_API_KEY;
const H={'X-N8N-API-KEY':KEY,'Content-Type':'application/json','Accept':'application/json'};
const wf = await fetch(`${N8N}/api/v1/workflows/jleu4RPvSnYDL8Gd`, {headers:H}).then(r=>r.json());

const cw = wf.nodes.find(n=>n.name==='Chatwoot Enviar');
cw.parameters.url = "={{ $('Preparar Envio').item.json.chatwootUrl }}";
cw.parameters.jsonBody = "={{ JSON.stringify($('Preparar Envio').item.json.chatwootBody) }}";

const allowed=['executionOrder','saveManualExecutions','saveExecutionProgress','saveDataErrorExecution','saveDataSuccessExecution','timezone','executionTimeout','errorWorkflow','callerPolicy'];
const settings = Object.fromEntries(Object.entries(wf.settings||{executionOrder:'v1'}).filter(([k])=>allowed.includes(k)));
const put={name:wf.name, nodes:wf.nodes, connections:wf.connections, settings};
const r=await fetch(`${N8N}/api/v1/workflows/jleu4RPvSnYDL8Gd`,{method:'PUT',headers:H,body:JSON.stringify(put)});
console.log('PUT',r.status); if(!r.ok) console.log(await r.text());

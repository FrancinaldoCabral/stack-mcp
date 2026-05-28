// Blinda Auto-Aceitar Conversa: grupos (@g.us) nunca respeitam human_takeover
import fs from 'node:fs';
const env = Object.fromEntries(fs.readFileSync('.env','utf8').split(/\r?\n/).filter(l=>l && !l.startsWith('#')).map(l=>{const i=l.indexOf('=');return [l.slice(0,i), l.slice(i+1)]}));
const N8N=env.N8N_URL, KEY=env.N8N_API_KEY;
const H={'X-N8N-API-KEY':KEY,'Content-Type':'application/json','Accept':'application/json'};
const wf = await fetch(`${N8N}/api/v1/workflows/bEb19TdWZfFloisU`, {headers:H}).then(r=>r.json());
const aa = wf.nodes.find(n=>n.name==='Auto-Aceitar Conversa');

aa.parameters.jsCode = `// Verificar se há takeover humano ativo e auto-aceitar conversa pendente
const msg = $input.first().json;

// Se Redis tem chave human_takeover → humano controla → bot silencia
// EXCETO para grupos (@g.us): grupos LT operacionais NUNCA escalam pra humano
const takeover = msg.takeover_value ?? null;
const isGroup = (msg.telefone || '').endsWith('@g.us') || (msg.remoteJid || '').endsWith('@g.us') || msg.isGroup === true;
if (takeover !== null && takeover !== '' && !isGroup) {
  return [];
}

// Auto-aceitar conversa pendente (sem isso, Agent Bot não consegue operar)
if (msg.conversation_id && msg.conversation_status === 'pending') {
  try {
    await fetch(
      'https://chatwoot.vendly.chat/api/v1/accounts/1/conversations/' + msg.conversation_id + '/toggle_status',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'api_access_token': 'Db9GHGsN9YVUDhJvD5CHbVTz' },
        body: JSON.stringify({ status: 'open' }),
      }
    );
  } catch (e) {}
}

return [$input.first()];`;

const allowed=['executionOrder','saveManualExecutions','saveExecutionProgress','saveDataErrorExecution','saveDataSuccessExecution','timezone','executionTimeout','errorWorkflow','callerPolicy'];
const settings = Object.fromEntries(Object.entries(wf.settings||{executionOrder:'v1'}).filter(([k])=>allowed.includes(k)));
const r=await fetch(`${N8N}/api/v1/workflows/bEb19TdWZfFloisU`,{method:'PUT',headers:H,body:JSON.stringify({name:wf.name,nodes:wf.nodes,connections:wf.connections,settings})});
console.log('PUT CORE', r.status);
if(!r.ok) console.log(await r.text());

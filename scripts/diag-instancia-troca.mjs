import fs from 'node:fs';
const env = Object.fromEntries(fs.readFileSync('.env','utf8').split(/\r?\n/).filter(l=>l&&!l.startsWith('#')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i),l.slice(i+1)]}));
const N8N=env.N8N_URL, KEY=env.N8N_API_KEY, EVO=env.EVOLUTION_URL, EK=env.EVOLUTION_API_KEY;
const CW=env.CHATWOOT_URL, CWK=env.CHATWOOT_API_KEY, ACCID=env.CHATWOOT_ACCOUNT_ID||1;
const NH={'X-N8N-API-KEY':KEY,'Accept':'application/json'};
const EH={'apikey':EK,'Content-Type':'application/json'};
const CWH={'api_access_token':CWK,'Content-Type':'application/json'};

console.log('=== EVOLUTION: instâncias existentes ===');
const evInst = await fetch(`${EVO}/instance/fetchInstances`, {headers:EH}).then(r=>r.json()).catch(e=>({error:String(e)}));
const instances = Array.isArray(evInst) ? evInst : (evInst.data||[evInst]);
for (const i of instances) {
  const inst = i.instance || i;
  console.log(`  name=${inst.instanceName||inst.name} state=${inst.connectionStatus||inst.state} id=${inst.instanceId||inst.id}`);
}

console.log('\n=== CHATWOOT: inboxes ===');
const inboxes = await fetch(`${CW}/api/v1/accounts/${ACCID}/inboxes`, {headers:CWH}).then(r=>r.json()).catch(e=>({error:String(e)}));
for (const ib of (inboxes.payload||[])) {
  console.log(`  id=${ib.id} name="${ib.name}" channel=${ib.channel_type} webhook="${ib.webhook_url||''}" agent_bot=${ib.agent_bot?.id||ib.agent_bot||'none'}`);
}

console.log('\n=== N8N workflows: referências a suporte-redatudo e livraison-totale ===');
const wfs = await fetch(`${N8N}/api/v1/workflows?limit=50`, {headers:NH}).then(r=>r.json());
for (const wf of (wfs.data||[])) {
  const str = JSON.stringify(wf.nodes||[]);
  const hasSR = str.includes('suporte-redatudo');
  const hasLT = str.includes('livraison-totale');
  if (hasSR || hasLT) {
    const mentions = [...str.matchAll(/suporte-redatudo|livraison-totale/g)].map(m=>m[0]);
    const counts = {};
    for (const m of mentions) counts[m]=(counts[m]||0)+1;
    console.log(`  [${wf.id}] "${wf.name}" — ${JSON.stringify(counts)}`);
  }
}

console.log('\n=== REDIS via N8N: keys com padrão instância ===');
// Busca execs recentes do CORE pra ver qual instância está chegando nos webhooks
const execs = await fetch(`${N8N}/api/v1/executions?workflowId=bEb19TdWZfFloisU&limit=5`, {headers:NH}).then(r=>r.json());
for (const e of (execs.data||[])) {
  const d = await fetch(`${N8N}/api/v1/executions/${e.id}?includeData=true`, {headers:NH}).then(r=>r.json());
  const rd = d.data?.resultData?.runData;
  // pega o primeiro nó com json
  const wn = Object.keys(rd||{}).find(k => rd[k]?.[0]?.data?.main?.[0]?.[0]?.json);
  const jn = wn ? rd[wn][0].data.main[0][0].json : null;
  const b = jn?.body || jn;
  const inst = b?.instance || b?.accountIdentifier || b?.inbox?.name || 'n/a';
  const tel = b?.telefone || b?.contact?.phone_number || b?.from || 'n/a';
  console.log(`  exec ${e.id} status=${e.status} instance="${inst}" tel="${tel}" nó="${wn}"`);
}

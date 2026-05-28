import fs from 'node:fs';
const env = Object.fromEntries(fs.readFileSync('.env','utf8').split(/\r?\n/).filter(l=>l&&!l.startsWith('#')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i),l.slice(i+1)]}));
const N8N=env.N8N_URL, KEY=env.N8N_API_KEY, CW=env.CHATWOOT_URL, CWK=env.CHATWOOT_API_KEY;
const NH={'X-N8N-API-KEY':KEY,'Accept':'application/json'};

// 1. Execs AGENT recentes com detalhes completos de timing e erros
console.log('=== AGENT execs recentes ===');
const al = await fetch(`${N8N}/api/v1/executions?workflowId=jleu4RPvSnYDL8Gd&limit=8`, {headers:NH}).then(r=>r.json());
for (const e of (al.data||[])) {
  const d = await fetch(`${N8N}/api/v1/executions/${e.id}?includeData=true`, {headers:NH}).then(r=>r.json());
  const rd = d.data?.resultData?.runData || {};
  const wb = rd['Webhook Agente']?.[0]?.data?.main?.[0]?.[0]?.json;
  const payload = wb?.body || wb;
  const tel = payload?.telefone || payload?.remoteJid;
  const cwe = rd['Chatwoot Enviar']?.[0]?.data?.main?.[0]?.[0]?.json;
  const evEnv = rd['Evolution Enviar']?.[0]?.data?.main?.[0]?.[0]?.json;
  const persona = rd['Resolver Persona']?.[0]?.data?.main?.[0]?.[0]?.json;
  const biz = rd['MongoDB GET Business']?.[0]?.data?.main?.[0]?.[0]?.json;
  const agente = rd['Parse Agente Config']?.[0]?.data?.main?.[0]?.[0]?.json;
  const errNode = Object.entries(rd).find(([_,runs])=>runs[0]?.error);
  
  const started = new Date(e.startedAt);
  const finished = e.stoppedAt ? new Date(e.stoppedAt) : null;
  const duration = finished ? `${((finished-started)/1000).toFixed(1)}s` : 'running';
  
  console.log(`\n  [${e.id}] status=${e.status} ${e.startedAt?.slice(11,19)} dur=${duration}`);
  console.log(`    tel=${tel} persona_type=${persona?.personaType||persona?.persona||'n/a'}`);
  console.log(`    business=${biz?.name||biz?._id||'NOT FOUND'} agente=${agente?.businessName||agente?.instanceName||'n/a'}`);
  console.log(`    CW Enviar: msg_id=${cwe?.id} status=${cwe?.status}`);
  console.log(`    Evo Enviar: ${evEnv?.key?.id ? 'sent='+evEnv.key.id : 'não executou'}`);
  if (errNode) console.log(`    ERRO em "${errNode[0]}": ${JSON.stringify(errNode[1][0]?.error?.message||errNode[1][0]?.error).slice(0,120)}`);
}

// 2. Conversas Chatwoot - grupos e direto
console.log('\n=== Chatwoot conversas ativas ===');
const convs = await fetch(`${CW}/api/v1/accounts/1/conversations?page=1&status=open`, {headers:{'api_access_token':CWK}}).then(r=>r.json()).catch(()=>({}));
const list = convs.data?.payload || convs.payload || [];
for (const c of list.slice(0,6)) {
  console.log(`  conv ${c.id} inbox=${c.inbox_id} status=${c.status} msgs=${c.messages_count} last="${(c.last_non_activity_message?.content||'').slice(0,50)}"`);
  // Últimas 3 msgs
  const msgs = await fetch(`${CW}/api/v1/accounts/1/conversations/${c.id}/messages`, {headers:{'api_access_token':CWK}}).then(r=>r.json()).catch(()=>({}));
  for (const m of (msgs.payload||[]).slice(-3)) {
    const t = m.message_type===0?'in':'out';
    console.log(`    msg ${m.id} ${t} status=${m.status} "${(m.content||'').slice(0,60)}"`);
  }
}

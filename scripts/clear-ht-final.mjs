import fs from 'node:fs';
const env = Object.fromEntries(fs.readFileSync('.env','utf8').split(/\r?\n/).filter(l=>l && !l.startsWith('#')).map(l=>{const i=l.indexOf('=');return [l.slice(0,i), l.slice(i+1)]}));
const N8N=env.N8N_URL, KEY=env.N8N_API_KEY;
const H={'X-N8N-API-KEY':KEY,'Content-Type':'application/json','Accept':'application/json'};
const path = '_tmp_del_' + Math.random().toString(36).slice(2,8);

const tmp = {
  name: '_tmp_delete_ht',
  nodes: [
    { parameters:{path, httpMethod:'POST', responseMode:'lastNode'},
      id:'a',name:'WB',type:'n8n-nodes-base.webhook',typeVersion:2,position:[200,200] },
    { parameters:{operation:'delete', key:'human_takeover:livraison-totale:120363410205219199@g.us'},
      id:'b',name:'Del',type:'n8n-nodes-base.redis',typeVersion:1,position:[400,200],
      credentials:{redis:{id:'zkKpThv7TlkK3IoB',name:'Redis Vendly'}} },
    { parameters:{operation:'get', key:'human_takeover:livraison-totale:120363410205219199@g.us', propertyName:'check', options:{}},
      id:'c',name:'Verify',type:'n8n-nodes-base.redis',typeVersion:1,position:[600,200],
      credentials:{redis:{id:'zkKpThv7TlkK3IoB',name:'Redis Vendly'}} },
  ],
  connections:{ 'WB':{main:[[{node:'Del',type:'main',index:0}]]}, 'Del':{main:[[{node:'Verify',type:'main',index:0}]]} },
  settings:{executionOrder:'v1'}
};
const cr=await fetch(`${N8N}/api/v1/workflows`,{method:'POST',headers:H,body:JSON.stringify(tmp)});
const c=await cr.json(); console.log('create',cr.status, c.id);
await fetch(`${N8N}/api/v1/workflows/${c.id}/activate`,{method:'POST',headers:H});
await new Promise(r=>setTimeout(r,2000));
const r=await fetch(`${N8N.replace('/api/v1','')}/webhook/${path}`,{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});
console.log('wb', r.status, (await r.text()).slice(0,300));
await new Promise(r=>setTimeout(r,2000));
const exs=await fetch(`${N8N}/api/v1/executions?workflowId=${c.id}&limit=1&includeData=true`,{headers:H}).then(r=>r.json());
const last=exs.data?.[0];
console.log('exec',last?.id,'status',last?.status);
const rd=last?.data?.resultData?.runData;
console.log('Del:',JSON.stringify(rd?.['Del']?.[0]?.data?.main?.[0]?.[0]?.json));
console.log('Verify:',JSON.stringify(rd?.['Verify']?.[0]?.data?.main?.[0]?.[0]?.json));
await fetch(`${N8N}/api/v1/workflows/${c.id}/deactivate`,{method:'POST',headers:H});
await fetch(`${N8N}/api/v1/workflows/${c.id}`,{method:'DELETE',headers:H});
console.log('cleaned');

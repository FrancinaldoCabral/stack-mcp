// Cria workflow webhook ativo, dispara, deleta
import fs from 'node:fs';
const env = Object.fromEntries(fs.readFileSync('.env','utf8').split(/\r?\n/).filter(l=>l && !l.startsWith('#')).map(l=>{const i=l.indexOf('=');return [l.slice(0,i), l.slice(i+1)]}));
const N8N=env.N8N_URL, KEY=env.N8N_API_KEY;
const H={'X-N8N-API-KEY':KEY,'Content-Type':'application/json','Accept':'application/json'};
const path = '_tmp_clear_ht_' + Math.random().toString(36).slice(2,8);

const tmp = {
  name: '_tmp_clear_human_takeover',
  nodes: [
    {
      parameters: { path, httpMethod: 'POST', responseMode: 'lastNode' },
      id: 't1', name: 'WB',
      type: 'n8n-nodes-base.webhook', typeVersion: 2,
      position: [200, 200],
    },
    {
      parameters: { operation: 'keys', keyPattern: 'human_takeover:livraison-totale:*' },
      id: 't2', name: 'List Keys',
      type: 'n8n-nodes-base.redis', typeVersion: 1,
      position: [400, 200],
      credentials: { redis: { id: 'zkKpThv7TlkK3IoB', name: 'Redis Vendly' } },
    },
    {
      parameters: {
        jsCode: `const item = $input.first().json;
const keys = Array.isArray(item) ? item : (item.keys || Object.values(item).find(v=>Array.isArray(v)) || []);
return keys.map(k => ({ json: { key: k } }));`
      },
      id: 't3', name: 'Spread Keys',
      type: 'n8n-nodes-base.code', typeVersion: 2,
      position: [600, 200],
    },
    {
      parameters: { operation: 'delete', key: '={{ $json.key }}' },
      id: 't4', name: 'Delete',
      type: 'n8n-nodes-base.redis', typeVersion: 1,
      position: [800, 200],
      credentials: { redis: { id: 'zkKpThv7TlkK3IoB', name: 'Redis Vendly' } },
    },
  ],
  connections: {
    'WB':         { main: [[{ node: 'List Keys',   type:'main', index: 0 }]] },
    'List Keys':  { main: [[{ node: 'Spread Keys', type:'main', index: 0 }]] },
    'Spread Keys':{ main: [[{ node: 'Delete',      type:'main', index: 0 }]] },
  },
  settings: { executionOrder: 'v1' }
};

const cr = await fetch(`${N8N}/api/v1/workflows`, {method:'POST', headers:H, body:JSON.stringify(tmp)});
const created = await cr.json();
console.log('CREATE:', cr.status, 'id:', created.id);

// Ativa
const act = await fetch(`${N8N}/api/v1/workflows/${created.id}/activate`, {method:'POST', headers:H});
console.log('ACTIVATE:', act.status);

await new Promise(r=>setTimeout(r,2000));

// Dispara
const wbUrl = `${N8N.replace('/api/v1','')}/webhook/${path}`;
console.log('POST', wbUrl);
const r = await fetch(wbUrl, { method:'POST', headers:{'Content-Type':'application/json'}, body:'{}'});
console.log('webhook status:', r.status);
console.log(await r.text().then(t=>t.slice(0,400)));

// Verifica execucao
await new Promise(r=>setTimeout(r,3000));
const exs = await fetch(`${N8N}/api/v1/executions?workflowId=${created.id}&limit=1`, {headers:H}).then(r=>r.json());
const last = exs.data?.[0];
console.log('exec', last?.id, 'status=', last?.status);
const det = await fetch(`${N8N}/api/v1/executions/${last.id}?includeData=true`, {headers:H}).then(r=>r.json());
const rd = det.data?.resultData?.runData;
console.log('List Keys output:', JSON.stringify(rd?.['List Keys']?.[0]?.data?.main?.[0]?.[0]?.json));
console.log('Spread Keys items:', rd?.['Spread Keys']?.[0]?.data?.main?.[0]?.length);
console.log('Delete runs:', rd?.['Delete']?.length);

// Apaga workflow
await fetch(`${N8N}/api/v1/workflows/${created.id}/deactivate`, {method:'POST', headers:H});
await fetch(`${N8N}/api/v1/workflows/${created.id}`, {method:'DELETE', headers:H});
console.log('CLEANED tmp workflow');

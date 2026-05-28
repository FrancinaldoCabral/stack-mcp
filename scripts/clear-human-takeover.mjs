// Limpa human_takeover para grupo Restaurante.
// Como nao tenho acesso direto ao Redis (hostname interno coolify), uso um workflow descartavel
// para executar via N8N que tem acesso.
//
// Estrategia: criar uma execucao do CORE com payload que limpa, OU mais simples:
// usar a propria sessao do AGENT para verificar key name e usar n8n_redis tool via MCP.
//
// Melhor: criar um workflow temporario que faz Redis DELETE, executar uma vez, deletar.

import fs from 'node:fs';
const env = Object.fromEntries(fs.readFileSync('.env','utf8').split(/\r?\n/).filter(l=>l && !l.startsWith('#')).map(l=>{const i=l.indexOf('=');return [l.slice(0,i), l.slice(i+1)]}));
const N8N=env.N8N_URL, KEY=env.N8N_API_KEY;
const H={'X-N8N-API-KEY':KEY,'Content-Type':'application/json','Accept':'application/json'};

// 1) Descobrir o nome da key. Olhar o Redis GET human_takeover no CORE
const wf = await fetch(`${N8N}/api/v1/workflows/bEb19TdWZfFloisU`, {headers:H}).then(r=>r.json());
const ht = wf.nodes.find(n=>n.name==='Redis GET human_takeover');
console.log('Redis GET human_takeover params:');
console.log(JSON.stringify(ht.parameters, null, 2));
console.log('credentials:', JSON.stringify(ht.credentials));

// 2) Criar workflow temporario com Manual Trigger + Redis DELETE
const tmp = {
  name: '_tmp_delete_human_takeover',
  nodes: [
    {
      parameters: {},
      id: 'trig-' + Math.random().toString(36).slice(2,8),
      name: 'Manual Trigger',
      type: 'n8n-nodes-base.manualTrigger',
      typeVersion: 1,
      position: [200, 200],
    },
    {
      parameters: {
        operation: 'delete',
        key: 'human_takeover:livraison-totale:120363410205219199@g.us',
      },
      id: 'del1-' + Math.random().toString(36).slice(2,8),
      name: 'Delete Restaurante',
      type: 'n8n-nodes-base.redis',
      typeVersion: 1,
      position: [400, 200],
      credentials: ht.credentials,
    },
    // tambem entregadores por garantia
    {
      parameters: {
        operation: 'delete',
        key: 'human_takeover:livraison-totale:120363413878404654@g.us',
      },
      id: 'del2-' + Math.random().toString(36).slice(2,8),
      name: 'Delete Entregadores',
      type: 'n8n-nodes-base.redis',
      typeVersion: 1,
      position: [600, 200],
      credentials: ht.credentials,
    },
    // e naldocabral privado
    {
      parameters: {
        operation: 'delete',
        key: 'human_takeover:livraison-totale:5521969435536@s.whatsapp.net',
      },
      id: 'del3-' + Math.random().toString(36).slice(2,8),
      name: 'Delete Naldo',
      type: 'n8n-nodes-base.redis',
      typeVersion: 1,
      position: [800, 200],
      credentials: ht.credentials,
    },
  ],
  connections: {
    'Manual Trigger': { main: [[{ node: 'Delete Restaurante', type: 'main', index: 0 }]] },
    'Delete Restaurante': { main: [[{ node: 'Delete Entregadores', type: 'main', index: 0 }]] },
    'Delete Entregadores': { main: [[{ node: 'Delete Naldo', type: 'main', index: 0 }]] },
  },
  settings: { executionOrder: 'v1' }
};

const cr = await fetch(`${N8N}/api/v1/workflows`, {method:'POST', headers:H, body:JSON.stringify(tmp)});
const created = await cr.json();
console.log('\nCREATE tmp workflow:', cr.status, 'id:', created.id);

// Executa manualmente
const ex = await fetch(`${N8N}/api/v1/workflows/${created.id}/execute`, {method:'POST', headers:H, body:'{}'});
console.log('EXEC:', ex.status);
console.log(await ex.text().then(t=>t.slice(0,300)));

// Aguarda e verifica
await new Promise(r=>setTimeout(r,5000));
const exs = await fetch(`${N8N}/api/v1/executions?workflowId=${created.id}&limit=1&includeData=true`, {headers:H}).then(r=>r.json());
const last = exs.data?.[0];
console.log('\nlast exec:', last?.id, 'status=', last?.status);
const rd = last?.data?.resultData?.runData;
if (rd) {
  for (const [k,v] of Object.entries(rd)) {
    const err = v[0]?.error;
    const out = v[0]?.data?.main?.[0]?.[0]?.json;
    console.log(`  ${k}: ${err?'ERR '+err.message: JSON.stringify(out).slice(0,150)}`);
  }
}

// Apaga workflow temporario
await fetch(`${N8N}/api/v1/workflows/${created.id}`, {method:'DELETE', headers:H});
console.log('DELETED tmp workflow');

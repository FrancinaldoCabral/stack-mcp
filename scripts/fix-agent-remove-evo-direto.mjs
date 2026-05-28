import fs from 'node:fs';
const env = Object.fromEntries(fs.readFileSync('.env','utf8').split(/\r?\n/).filter(l=>l&&!l.startsWith('#')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i),l.slice(i+1)]}));
const N8N=env.N8N_URL, KEY=env.N8N_API_KEY;
const NH={'X-N8N-API-KEY':KEY,'Accept':'application/json','Content-Type':'application/json'};

// Busca workflow atual
const wf = await fetch(`${N8N}/api/v1/workflows/jleu4RPvSnYDL8Gd`, {headers:NH}).then(r=>r.json());

// Mostrar conexões relevantes antes da mudança
const conn = wf.connections;
console.log('ANTES:');
console.log('  Aguardar Digitacao [0] →', conn['Aguardar Digitacao']?.main?.[0]?.map(d=>d.node));
console.log('  Evolution Enviar [0] →', conn['Evolution Enviar']?.main?.[0]?.map(d=>d.node));
console.log('  Chatwoot Enviar [0] →', conn['Chatwoot Enviar']?.main?.[0]?.map(d=>d.node));

// Fix: remover "Evolution Enviar" do caminho de texto
// Aguardar Digitacao → Chatwoot Enviar (pula Evolution Enviar)
// Evolution Enviar fica sem conexão de saída (ainda executa se chamado, mas não está no caminho)

// Atualiza conexão: Aguardar Digitacao → Chatwoot Enviar (era → Evolution Enviar)
conn['Aguardar Digitacao'].main[0] = conn['Aguardar Digitacao'].main[0].map(dest => {
  if (dest.node === 'Evolution Enviar') return { node: 'Chatwoot Enviar', type: 'main', index: 0 };
  return dest;
});

// Remove saída de Evolution Enviar (para não executar no caminho principal)
delete conn['Evolution Enviar'];

console.log('\nDEPOIS:');
console.log('  Aguardar Digitacao [0] →', conn['Aguardar Digitacao']?.main?.[0]?.map(d=>d.node));
console.log('  Evolution Enviar [0] →', conn['Evolution Enviar']?.main?.[0]?.map(d=>d.node) || '(removido)');
console.log('  Chatwoot Enviar [0] →', conn['Chatwoot Enviar']?.main?.[0]?.map(d=>d.node));

// PUT
const body = {
  name: wf.name,
  nodes: wf.nodes,
  connections: conn,
  settings: { executionOrder: 'v1', saveManualExecutions: true }
};
const pr = await fetch(`${N8N}/api/v1/workflows/jleu4RPvSnYDL8Gd`, {
  method: 'PUT', headers: NH, body: JSON.stringify(body)
});
console.log('\nPUT AGENT', pr.status);
if (pr.status !== 200) console.log(await pr.text().then(t=>t.slice(0,400)));

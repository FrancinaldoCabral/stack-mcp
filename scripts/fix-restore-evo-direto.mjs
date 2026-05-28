// fix-restore-evo-direto.mjs
// Restaura conexão: Aguardar Digitacao → Evolution Enviar → Chatwoot Enviar
// E limpa webhook_url do inbox 12 para evitar double-send e 404
import fs from 'node:fs';
const env = Object.fromEntries(fs.readFileSync('.env','utf8').split(/\r?\n/).filter(l=>l&&!l.startsWith('#')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i),l.slice(i+1)]}));
const N8N=env.N8N_URL, KEY=env.N8N_API_KEY, CW=env.CHATWOOT_URL, CWK=env.CHATWOOT_API_KEY;
const NH={'X-N8N-API-KEY':KEY,'Accept':'application/json','Content-Type':'application/json'};

// Buscar AGENT atual
console.log('Buscando AGENT workflow...');
const wf = await fetch(`${N8N}/api/v1/workflows/jleu4RPvSnYDL8Gd`, {headers:NH}).then(r=>r.json());
const nodes = wf.nodes;
const conn = JSON.parse(JSON.stringify(wf.connections));

// Verificar nós existentes
const aguardar = nodes.find(n=>n.name==='Aguardar Digitacao');
const evoEnviar = nodes.find(n=>n.name==='Evolution Enviar');
const cwEnviar = nodes.find(n=>n.name==='Chatwoot Enviar');

console.log('Aguardar Digitacao:', aguardar?.name, 'id=', aguardar?.id);
console.log('Evolution Enviar:', evoEnviar?.name, 'id=', evoEnviar?.id);
console.log('Chatwoot Enviar:', cwEnviar?.name, 'id=', cwEnviar?.id);

// Conexões atuais
console.log('\nConexões atuais Aguardar Digitacao:', JSON.stringify(conn['Aguardar Digitacao']?.main));
console.log('Conexões atuais Evolution Enviar (in):', JSON.stringify(
  Object.entries(conn).filter(([_,v])=>v.main?.some(outs=>outs?.some(d=>d.node==='Evolution Enviar'))).map(([k])=>k)
));

if (!evoEnviar) {
  console.error('ERRO: Evolution Enviar não encontrado!');
  process.exit(1);
}

// Corrigir conexões:
// 1. Aguardar Digitacao [0] → Evolution Enviar (remover Chatwoot Enviar desta saída)
// 2. Evolution Enviar [0] → Chatwoot Enviar
// (Chatwoot Enviar [0] → Loop Chunks: já existe, não muda)

// Remover conexão Aguardar Digitacao → Chatwoot Enviar (se existir)
if (conn['Aguardar Digitacao']?.main?.[0]) {
  conn['Aguardar Digitacao'].main[0] = conn['Aguardar Digitacao'].main[0].filter(d=>d.node!=='Chatwoot Enviar');
}

// Adicionar Aguardar Digitacao → Evolution Enviar [0]
if (!conn['Aguardar Digitacao']) conn['Aguardar Digitacao'] = {main: [[]]};
if (!conn['Aguardar Digitacao'].main[0]) conn['Aguardar Digitacao'].main[0] = [];
if (!conn['Aguardar Digitacao'].main[0].some(d=>d.node==='Evolution Enviar')) {
  conn['Aguardar Digitacao'].main[0].push({node:'Evolution Enviar', type:'main', index:0});
}

// Garantir Evolution Enviar → Chatwoot Enviar [0]
if (!conn['Evolution Enviar']) conn['Evolution Enviar'] = {main: [[]]};
if (!conn['Evolution Enviar'].main[0]) conn['Evolution Enviar'].main[0] = [];
if (!conn['Evolution Enviar'].main[0].some(d=>d.node==='Chatwoot Enviar')) {
  conn['Evolution Enviar'].main[0].push({node:'Chatwoot Enviar', type:'main', index:0});
}

console.log('\nConexões NOVAS:');
console.log('  Aguardar Digitacao [0] →', conn['Aguardar Digitacao'].main[0].map(d=>d.node));
console.log('  Evolution Enviar [0] →', conn['Evolution Enviar'].main[0].map(d=>d.node));
console.log('  Chatwoot Enviar [0] →', conn['Chatwoot Enviar']?.main?.[0]?.map(d=>d.node));

// PUT workflow
const body = {name: wf.name, nodes, connections: conn, settings: {executionOrder:'v1', saveManualExecutions:true}};
const res = await fetch(`${N8N}/api/v1/workflows/jleu4RPvSnYDL8Gd`, {
  method:'PUT',
  headers:NH,
  body: JSON.stringify(body)
});
const data = await res.json();
if (res.status === 200) {
  console.log('\n✅ AGENT atualizado com sucesso! Evolution Enviar restaurado no path.');
} else {
  console.error('\n❌ Erro PUT:', res.status, JSON.stringify(data).slice(0,300));
  process.exit(1);
}

// Limpar webhook_url do inbox 12
console.log('\nLimpando webhook_url do inbox 12 Chatwoot...');
const cwRes = await fetch(`${CW}/api/v1/accounts/1/inboxes/12`, {
  method: 'PATCH',
  headers: {'api_access_token': CWK, 'Content-Type': 'application/json'},
  body: JSON.stringify({channel: {webhook_url: ''}})
});
const cwData = await cwRes.json();
if (cwRes.status === 200) {
  console.log('✅ webhook_url limpo! Valor atual:', cwData.channel_type || cwData.channel?.webhook_url || JSON.stringify(cwData).slice(0,100));
} else {
  console.error('❌ Erro Chatwoot PATCH inbox:', cwRes.status, JSON.stringify(cwData).slice(0,200));
}

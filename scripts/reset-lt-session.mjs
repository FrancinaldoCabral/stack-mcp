const MCP='http://fco8og80s4sw4c0wc0ogswws.157.173.111.65.sslip.io/mcp';
let id=1;
async function rpc(m,p){const r=await fetch(MCP,{method:'POST',headers:{'Content-Type':'application/json',Accept:'application/json, text/event-stream'},body:JSON.stringify({jsonrpc:'2.0',id:id++,method:m,params:p})});const t=await r.text();const d=t.split('\n').reverse().find(l=>l.startsWith('data:'));return JSON.parse(d.slice(5).trim()).result;}
async function tool(n,a){const r=await rpc('tools/call',{name:n,arguments:a});return JSON.parse(r.content[0].text);}
await rpc('initialize',{protocolVersion:'2024-11-05',capabilities:{},clientInfo:{name:'x',version:'1'}});

// 1) Trocar modelo pra um melhor em tools
const upd = await tool('mongo_update',{database:'vendly',collection:'businesses',filter:{instances:'livraison-totale'},update:{$set:{'settings.model':'google/gemini-2.0-flash-001'}}});
console.log('update model:', upd);

// 2) Limpar sessão Redis dos dois grupos
for (const jid of ['120363410205219199@g.us','120363413878404654@g.us']) {
  const k = `sessao:livraison-totale:${jid}`;
  const del = await tool('redis_delete',{key:k});
  console.log('del', k, '→', del);
}

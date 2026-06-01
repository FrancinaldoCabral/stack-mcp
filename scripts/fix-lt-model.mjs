const MCP='https://app.vendly.chat/mcp';
let id=1;
async function rpc(m,p){const r=await fetch(MCP,{method:'POST',headers:{'Content-Type':'application/json',Accept:'application/json, text/event-stream'},body:JSON.stringify({jsonrpc:'2.0',id:id++,method:m,params:p})});const t=await r.text();const d=t.split('\n').reverse().find(l=>l.startsWith('data:'));return JSON.parse(d.slice(5).trim()).result;}
async function tool(n,a){const r=await rpc('tools/call',{name:n,arguments:a});return JSON.parse(r.content[0].text);}
await rpc('initialize',{protocolVersion:'2024-11-05',capabilities:{},clientInfo:{name:'x',version:'1'}});
const u=await tool('mongo_update',{database:'vendly',collection:'businesses',filter:{instances:'livraison-totale'},update:{$set:{'settings.model':'google/gemini-2.0-flash-lite-001'}}});
console.log('update:',u);

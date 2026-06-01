// Verifica e endurece os systemPrompts das personas restaurant e deliverer
const MCP='https://app.vendly.chat/mcp';
let id=1;
async function rpc(m,p){const r=await fetch(MCP,{method:'POST',headers:{'Content-Type':'application/json',Accept:'application/json, text/event-stream'},body:JSON.stringify({jsonrpc:'2.0',id:id++,method:m,params:p})});const t=await r.text();const d=t.split('\n').reverse().find(l=>l.startsWith('data:'));return JSON.parse(d.slice(5).trim()).result;}
async function tool(n,a){const r=await rpc('tools/call',{name:n,arguments:a});return JSON.parse(r.content[0].text);}
await rpc('initialize',{protocolVersion:'2024-11-05',capabilities:{},clientInfo:{name:'x',version:'1'}});

const found = await tool('mongo_find',{database:'vendly',collection:'businesses',filter:{instances:'livraison-totale'},limit:1});
console.log('shape keys:', Object.keys(found));
const biz = (found.documents || found.results || found.data || (Array.isArray(found)?found:[]))[0];
if(!biz){ console.log('found:', JSON.stringify(found).slice(0,500)); process.exit(1);}
console.log('businessId:', biz._id);
console.log('personas:', Object.keys(biz.deliveryPersonas || biz.personas || {}));
// Listar onde está o systemPrompt
console.log(JSON.stringify(biz.deliveryPersonas || biz.personas, null, 2).slice(0, 2000));

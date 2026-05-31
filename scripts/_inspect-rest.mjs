const MCP="http://fco8og80s4sw4c0wc0ogswws.157.173.111.65.sslip.io/mcp";
let id=1;
async function rpc(m,p){const r=await fetch(MCP,{method:"POST",headers:{"Content-Type":"application/json",Accept:"application/json, text/event-stream"},body:JSON.stringify({jsonrpc:"2.0",id:id++,method:m,params:p})});const t=await r.text();const d=t.split("\n").reverse().find(l=>l.startsWith("data:"));return JSON.parse(d.slice(5).trim()).result;}
async function tool(n,a){const r=await rpc("tools/call",{name:n,arguments:a});return JSON.parse(r.content[0].text);}
await rpc("initialize",{protocolVersion:"2024-11-05",capabilities:{},clientInfo:{name:"x",version:"1"}});
const rests = await tool("mongo_find",{database:"vendly",collection:"delivery_restaurants",filter:{},limit:5});
console.log(JSON.stringify(rests,null,2));
const biz = await tool("mongo_find",{database:"vendly",collection:"businesses",filter:{name:"LivraisonTotale"},limit:1});
console.log("\n=== BUSINESS SETTINGS ===");
console.log(JSON.stringify(biz[0].settings, null, 2));

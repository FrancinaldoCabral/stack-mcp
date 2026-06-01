const MCP="https://app.vendly.chat/mcp";
let id=1;
async function rpc(m,p){const r=await fetch(MCP,{method:"POST",headers:{"Content-Type":"application/json",Accept:"application/json, text/event-stream"},body:JSON.stringify({jsonrpc:"2.0",id:id++,method:m,params:p})});const t=await r.text();const d=t.split("\n").reverse().find(l=>l.startsWith("data:"));return JSON.parse(d.slice(5).trim()).result;}
async function tool(n,a){const r=await rpc("tools/call",{name:n,arguments:a});return JSON.parse(r.content[0].text);}
await rpc("initialize",{protocolVersion:"2024-11-05",capabilities:{},clientInfo:{name:"x",version:"1"}});

// Adiciona endereco placeholder pro Restaurante 1 (pode editar depois via dashboard ou mongo_update)
const u = await tool("mongo_update",{
  database:"vendly",
  collection:"delivery_restaurants",
  filter:{ name:"Restaurante 1" },
  update:{ $set:{ address:"Rue Antoine Dansaert 100, 1000 Bruxelles, Belgium" } }
});
console.log("restaurante address:", JSON.stringify(u));

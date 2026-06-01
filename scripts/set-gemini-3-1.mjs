import fs from "node:fs";
const env = Object.fromEntries(fs.readFileSync(".env","utf8").split(/\r?\n/).filter(l=>l&&!l.startsWith("#")).map(l=>{const i=l.indexOf("=");return[l.slice(0,i),l.slice(i+1)]}));
const MCP="https://app.vendly.chat/mcp";
let id=1;
async function rpc(m,p){const r=await fetch(MCP,{method:"POST",headers:{"Content-Type":"application/json",Accept:"application/json, text/event-stream"},body:JSON.stringify({jsonrpc:"2.0",id:id++,method:m,params:p})});const t=await r.text();const d=t.split("\n").reverse().find(l=>l.startsWith("data:"));return JSON.parse(d.slice(5).trim()).result;}
async function tool(n,a){const r=await rpc("tools/call",{name:n,arguments:a});return JSON.parse(r.content[0].text);}
await rpc("initialize",{protocolVersion:"2024-11-05",capabilities:{},clientInfo:{name:"x",version:"1"}});
const u = await tool("mongo_update",{database:"vendly",collection:"businesses",filter:{instances:"livraison-totale"},update:{$set:{"settings.model":"google/gemini-3.1-flash-lite"}}});
console.log("Mongo updated:", JSON.stringify(u));
const r = await fetch("https://openrouter.ai/api/v1/chat/completions",{ method:"POST", headers:{"Authorization":"Bearer "+env.OPENROUTER_API_KEY,"Content-Type":"application/json"}, body: JSON.stringify({ model:"google/gemini-3.1-flash-lite", messages:[{role:"user",content:"diga apenas: ok"}], max_tokens: 20 }) });
const j = await r.json();
console.log("\nOpenRouter status:", r.status);
console.log("OpenRouter response:", JSON.stringify(j).slice(0,500));

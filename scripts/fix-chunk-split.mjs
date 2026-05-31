import fs from "node:fs";
const env = Object.fromEntries(fs.readFileSync(".env","utf8").split(/\r?\n/).filter(l=>l&&!l.startsWith("#")).map(l=>{const i=l.indexOf("=");return[l.slice(0,i),l.slice(i+1)]}));
const H = { "X-N8N-API-KEY": env.N8N_API_KEY, "Accept":"application/json","Content-Type":"application/json" };
const ID = "jleu4RPvSnYDL8Gd";
const wf = await fetch(`https://workflows.vendly.chat/api/v1/workflows/${ID}`,{headers:H}).then(r=>r.json());
const node = wf.nodes.find(n=>n.name==="Parsear Chunks");
const old = node.parameters.jsCode;
// Substituir split(/\n+/) por split(/\n{2,}/) - apenas paragrafos
const updated = old.replace(".split(/\\n+/)", ".split(/\\n{2,}/)");
if (old === updated) { console.error("NAO ENCONTROU PADRAO split(/\\n+/)"); process.exit(1); }
node.parameters.jsCode = updated;
const body = { name: wf.name, nodes: wf.nodes, connections: wf.connections, settings: { executionOrder:"v1", saveManualExecutions: true } };
const r = await fetch(`https://workflows.vendly.chat/api/v1/workflows/${ID}`,{method:"PUT",headers:H,body:JSON.stringify(body)});
console.log("status:", r.status);
if (r.status >= 400) console.log(await r.text());
else console.log("OK - Parsear Chunks agora splita por \\n\\n+");

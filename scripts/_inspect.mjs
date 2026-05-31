import fs from "node:fs";
const env = Object.fromEntries(fs.readFileSync(".env","utf8").split(/\r?\n/).filter(l=>l&&!l.startsWith("#")).map(l=>{const i=l.indexOf("=");return[l.slice(0,i),l.slice(i+1)]}));
const H = { "X-N8N-API-KEY": env.N8N_API_KEY, "Accept":"application/json","Content-Type":"application/json" };
const wf = await fetch(`https://workflows.vendly.chat/api/v1/workflows/jleu4RPvSnYDL8Gd`,{headers:H}).then(r=>r.json());
const node = wf.nodes.find(n=>n.name==="Parsear Chunks");
const code = node.parameters.jsCode;
const m = code.match(/\.split\([^)]+\)/g);
console.log(JSON.stringify(m));

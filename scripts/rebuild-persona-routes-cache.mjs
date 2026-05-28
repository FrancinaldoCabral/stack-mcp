// Rebuild persona_routes:livraison-totale a partir do Mongo (limpa cache velho)
const MCP='http://fco8og80s4sw4c0wc0ogswws.157.173.111.65.sslip.io/mcp';
let id=1;
async function rpc(m,p){const r=await fetch(MCP,{method:'POST',headers:{'Content-Type':'application/json',Accept:'application/json, text/event-stream'},body:JSON.stringify({jsonrpc:'2.0',id:id++,method:m,params:p})});const t=await r.text();const d=t.split('\n').reverse().find(l=>l.startsWith('data:'));return JSON.parse(d.slice(5).trim()).result;}
async function tool(n,a){const r=await rpc('tools/call',{name:n,arguments:a});return JSON.parse(r.content[0].text);}
await rpc('initialize',{protocolVersion:'2024-11-05',capabilities:{},clientInfo:{name:'x',version:'1'}});

const f = await tool('mongo_find',{database:'vendly',collection:'businesses',filter:{instances:'livraison-totale'},limit:1});
const biz = Object.values(f)[0];
const personasMap = {};
for (const p of biz.personas) personasMap[p.key] = p;
const payload = { personas: personasMap, routes: biz.contextRoutes };
const set = await tool('redis_set',{key:'persona_routes:livraison-totale', value: JSON.stringify(payload)});
console.log('redis_set:', set);
console.log('restaurant prompt has REGRAS DE FERRAMENTA?', /REGRAS DE FERRAMENTA/.test(personasMap.restaurant.systemPrompt));

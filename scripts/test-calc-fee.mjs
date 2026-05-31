// Aguarda deploy e testa delivery_calc_fee em prod
const MCP = "http://fco8og80s4sw4c0wc0ogswws.157.173.111.65.sslip.io/mcp";
let id = 1;
async function rpc(m, p) {
  const r = await fetch(MCP, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: id++, method: m, params: p }),
  });
  const t = await r.text();
  const d = t.split("\n").reverse().find(l => l.startsWith("data:"));
  return JSON.parse(d.slice(5).trim());
}
async function tool(n, a) {
  const r = await rpc("tools/call", { name: n, arguments: a });
  if (r.error) return { _error: r.error };
  return JSON.parse(r.result.content[0].text);
}
await rpc("initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "x", version: "1" } });

console.log("Aguardando deploy do MCP (até 90s)...");
let ok = false;
for (let i = 0; i < 18; i++) {
  await new Promise(r => setTimeout(r, 5000));
  const res = await tool("delivery_calc_fee", {
    restaurantId: "6a178f496b79610d82277310",
    clientAddress: "Place Eugène Flagey 17, 1050 Bruxelles",
  });
  if (res?.error?.includes?.("desconhecida") || res?._error?.message?.includes?.("desconhecida")) {
    process.stdout.write(".");
    continue;
  }
  console.log("\n=== RESULTADO delivery_calc_fee ===");
  console.log(JSON.stringify(res, null, 2));
  ok = true;
  break;
}
if (!ok) console.log("\nTimeout — deploy ainda não terminou ou erro de tool.");

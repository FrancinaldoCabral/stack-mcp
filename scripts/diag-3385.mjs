import fs from "node:fs";
const env = Object.fromEntries(fs.readFileSync(".env","utf8").split(/\r?\n/).filter(l=>l&&!l.startsWith("#")).map(l=>{const i=l.indexOf("=");return[l.slice(0,i),l.slice(i+1)]}));
const N8N=env.N8N_URL, KEY=env.N8N_API_KEY;
const H={"X-N8N-API-KEY":KEY,"Accept":"application/json"};
const e = await fetch(`${N8N}/api/v1/executions/3385?includeData=true`,{headers:H}).then(r=>r.json());
const rd = e.data?.resultData?.runData || {};
console.log("=== Exec 3385 nós com erro ===");
for (const [name, runs] of Object.entries(rd)) {
  for (const run of runs) {
    if (run.error) {
      console.log(`\n[${name}] ERROR: ${run.error.message}`);
      console.log(`  stack: ${(run.error.stack||"").split("\n").slice(0,3).join(" | ")}`);
      console.log(`  description: ${run.error.description || ""}`);
    }
  }
}
console.log("\n=== Nós executados ===");
for (const name of Object.keys(rd)) console.log(" ",name);

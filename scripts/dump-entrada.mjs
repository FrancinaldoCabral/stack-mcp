import dotenv from 'dotenv';
dotenv.config();
const H = { 'X-N8N-API-KEY': process.env.N8N_API_KEY, Accept: 'application/json' };
const base = process.env.N8N_URL;

const wfEntrada = await fetch(`${base}/api/v1/workflows/bEb19TdWZfFloisU`, { headers: H }).then(r => r.json());

// Print ALL nodes with type and parameters summary
for (const n of wfEntrada.nodes) {
  const code = n.parameters?.jsCode ?? n.parameters?.code ?? n.parameters?.value ?? '';
  console.log(`\n=== Node: "${n.name}" (${n.type}) ===`);
  if (code) console.log(code.slice(0, 2000));
  else console.log(JSON.stringify(n.parameters, null, 2)?.slice(0, 500));
}

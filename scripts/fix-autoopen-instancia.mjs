import fs from 'node:fs';
const env = Object.fromEntries(fs.readFileSync('.env','utf8').split(/\r?\n/).filter(l=>l&&!l.startsWith('#')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i),l.slice(i+1)]}));
const N8N=env.N8N_URL, KEY=env.N8N_API_KEY;
const NH={'X-N8N-API-KEY':KEY,'Accept':'application/json','Content-Type':'application/json'};

// Busca workflow atual
const wf = await fetch(`${N8N}/api/v1/workflows/Jijw4Dqil3QVYSp8`, {headers:NH}).then(r=>r.json());
console.log(`Workflow: "${wf.name}" nodes: ${wf.nodes.length}`);

// Encontra o nó Handle Takeover Humano e corrige inbox hardcoded
let fixed = 0;
for (const n of wf.nodes) {
  if (n.name === 'Handle Takeover Humano' && n.parameters?.jsCode) {
    const before = n.parameters.jsCode;
    // Substitui a linha com inbox 11/suporte-redatudo → 12/livraison-totale
    // Também torna mais genérico: se inboxName não vier, usa o próprio inboxId como string (fallback dinâmico)
    n.parameters.jsCode = before.replace(
      `const resolvedInbox = inboxName || (Number(inboxId) === 11 ? 'suporte-redatudo' : String(inboxId ?? ''));`,
      `const resolvedInbox = inboxName || (Number(inboxId) === 12 ? 'livraison-totale' : String(inboxId ?? ''));`
    );
    if (n.parameters.jsCode !== before) {
      fixed++;
      console.log('✅ Nó corrigido: inbox_id 11/suporte-redatudo → 12/livraison-totale');
    } else {
      console.log('⚠️  Padrão não encontrado, verificando manualmente...');
      // Procura qualquer variante
      const idx = before.indexOf('suporte-redatudo');
      if (idx >= 0) console.log('  Contexto:', JSON.stringify(before.slice(Math.max(0,idx-60), idx+80)));
    }
  }
}

if (fixed === 0) {
  console.log('Nenhuma correção aplicada — abortando.');
  process.exit(1);
}

// PUT whitelist: name, nodes, connections, settings
const body = {
  name: wf.name,
  nodes: wf.nodes,
  connections: wf.connections,
  settings: { executionOrder: 'v1', saveManualExecutions: true }
};

const pr = await fetch(`${N8N}/api/v1/workflows/Jijw4Dqil3QVYSp8`, {
  method: 'PUT',
  headers: NH,
  body: JSON.stringify(body)
});
console.log(`PUT Auto-open ${pr.status}`);
if (pr.status !== 200) console.log(await pr.text().then(t=>t.slice(0,400)));

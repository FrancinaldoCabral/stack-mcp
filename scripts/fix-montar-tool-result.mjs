import fs from 'node:fs';
const env = Object.fromEntries(fs.readFileSync('.env','utf8').split(/\r?\n/).filter(l=>l&&!l.startsWith('#')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i),l.slice(i+1)]}));
const N8N=env.N8N_URL, KEY=env.N8N_API_KEY;
const NH={'X-N8N-API-KEY':KEY,'Accept':'application/json','Content-Type':'application/json'};

const wf = await fetch(`${N8N}/api/v1/workflows/jleu4RPvSnYDL8Gd`, {headers:NH}).then(r=>r.json());

// Verificar o que Construir Prompt retorna (para confirmar formato openRouterBody)
const cp = wf.nodes.find(n=>n.name==='Construir Prompt');
const hasOpenRouterBody = (cp?.parameters?.jsCode||'').includes('openRouterBody');
console.log('Construir Prompt retorna openRouterBody?', hasOpenRouterBody);

// Corrigir Montar Tool Result: wrapa em openRouterBody
const mtr = wf.nodes.find(n=>n.name==='Montar Tool Result');
const before = mtr.parameters.jsCode;

// Substitui o return final para wrapping em openRouterBody
mtr.parameters.jsCode = before.replace(
  `return [{
  json: {
    model: promptData.model ?? 'google/gemini-2.5-flash-lite',
    messages,
    temperature: 0.8,
  }
}];`,
  `return [{
  json: {
    openRouterBody: {
      model: promptData.model ?? 'google/gemini-2.5-flash-lite',
      messages,
      temperature: 0.8,
    }
  }
}];`
);

if (mtr.parameters.jsCode === before) {
  console.log('⚠️ padrão não encontrado exato, verificando...');
  const idx = before.indexOf('return [{');
  const snippet = before.slice(Math.max(0, idx), idx+200);
  console.log('snippet:', JSON.stringify(snippet));
  process.exit(1);
} else {
  console.log('✅ Montar Tool Result corrigido: return wrappado em openRouterBody');
}

// PUT AGENT
const body = {
  name: wf.name,
  nodes: wf.nodes,
  connections: wf.connections,
  settings: { executionOrder: 'v1', saveManualExecutions: true }
};
const pr = await fetch(`${N8N}/api/v1/workflows/jleu4RPvSnYDL8Gd`, {
  method: 'PUT', headers: NH, body: JSON.stringify(body)
});
console.log('PUT AGENT', pr.status);

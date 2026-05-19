import 'dotenv/config';
import https from 'https';

function get(path) {
  return new Promise((res, rej) => {
    const u = new URL(process.env.N8N_URL + path);
    https.get({ hostname: u.hostname, path: u.pathname, headers: { 'X-N8N-API-KEY': process.env.N8N_API_KEY, Accept: 'application/json' } }, (r) => {
      let d = '';
      r.on('data', (x) => (d += x));
      r.on('end', () => res(JSON.parse(d)));
    }).on('error', rej);
  });
}

const wf = await get('/api/v1/workflows/jleu4RPvSnYDL8Gd');
const c = wf.connections;
const mainPath = ['Webhook Agente', 'Desembalar Payload', 'Redis GET Sessao', 'Gerar Embedding', 'Qdrant Search Contexto', 'Construir Prompt', 'OpenRouter'];
mainPath.forEach((n) => {
  const to = c[n]?.main?.[0]?.[0]?.node ?? '(fim)';
  console.log(n, '->', to);
});
const cp = wf.nodes.find((n) => n.name === 'Construir Prompt');
console.log('\ntry/catch MongoDB:', cp.parameters.jsCode.includes('try { clienteDoc') ? 'OK' : 'FALTANDO');

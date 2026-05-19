import 'dotenv/config';
import https from 'https';

function get(path) {
  return new Promise((res, rej) => {
    const u = new URL(process.env.N8N_URL + path);
    https.get({ hostname: u.hostname, path: u.pathname + u.search, headers: { 'X-N8N-API-KEY': process.env.N8N_API_KEY, Accept: 'application/json' } }, (r) => {
      let d = '';
      r.on('data', (x) => (d += x));
      r.on('end', () => res(JSON.parse(d)));
    }).on('error', rej);
  });
}

const wf = await get('/api/v1/workflows/jleu4RPvSnYDL8Gd');
const cp = wf.nodes.find((n) => n.name === 'Construir Prompt');
const code = cp.parameters.jsCode;

console.log('=== Construir Prompt optional chaining ===');
console.log('Business ?. :', code.includes("MongoDB GET Business').first()?.json") ? 'OK' : 'FAIL');
console.log('Cliente ?.  :', code.includes("MongoDB GET Cliente').first()?.json") ? 'OK' : 'FAIL');
console.log('Qdrant ?.   :', code.includes("Qdrant Search Contexto').first()?.json") ? 'OK' : 'FAIL');

console.log('\n=== Conexões ===');
const conn = wf.connections;
const chain = ['MongoDB GET Business', 'Garantir Fluxo Business', 'MongoDB GET Cliente', 'Garantir Fluxo Cliente', 'Redis GET Sessao'];
chain.forEach((n) => {
  const to = conn[n]?.main?.[0]?.[0]?.node ?? '(sem conexao)';
  console.log(' ', n, '->', to);
});

console.log('\n=== Redis GET Sessao key ===');
const rg = wf.nodes.find((n) => n.name === 'Redis GET Sessao');
console.log(rg.parameters.key);

console.log('\n=== Todos os nós ===');
wf.nodes.forEach((n) => console.log(' ', n.name));

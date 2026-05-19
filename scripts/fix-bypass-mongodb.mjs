/**
 * Reroute do Agent workflow:
 * O N8N não executa nós downstream quando upstream retorna 0 items.
 * Solução: desconectar MongoDB GET Business/Cliente do caminho principal.
 * Desembalar Payload → Redis GET Sessao diretamente.
 * MongoDB GET Business/Cliente ficam como ramos paralelos opcionais
 * (Construir Prompt já usa ?.json ?? {} para lidar com ausência).
 */
import 'dotenv/config';
import https from 'https';

function req(method, path, body) {
  return new Promise((res, rej) => {
    const u = new URL(process.env.N8N_URL + path);
    const d = body ? JSON.stringify(body) : undefined;
    const opts = {
      hostname: u.hostname,
      path: u.pathname + u.search,
      method,
      headers: {
        'X-N8N-API-KEY': process.env.N8N_API_KEY,
        Accept: 'application/json',
        'Content-Type': 'application/json',
        ...(d ? { 'Content-Length': Buffer.byteLength(d) } : {}),
      },
    };
    const r = https.request(opts, (resp) => {
      let s = '';
      resp.on('data', (x) => (s += x));
      resp.on('end', () => {
        try { res({ status: resp.statusCode, body: JSON.parse(s) }); }
        catch { res({ status: resp.statusCode, body: s }); }
      });
    });
    r.on('error', rej);
    if (d) r.write(d);
    r.end();
  });
}

const { status: getStatus, body: wf } = await req('GET', '/api/v1/workflows/jleu4RPvSnYDL8Gd');
if (getStatus !== 200) { console.error('GET failed', getStatus); process.exit(1); }

const conn = wf.connections;

// 1. Desembalar Payload → Redis GET Sessao (ao invés de MongoDB GET Business)
conn['Desembalar Payload'] = { main: [[{ node: 'Redis GET Sessao', type: 'main', index: 0 }]] };

// 2. MongoDB GET Business → MongoDB GET Cliente (mantém para referência futura, mas isolados do main path)
//    Garantir Fluxo Business e Garantir Fluxo Cliente ficam como nós órfãos (sem conexão entrante)
//    As conexões existentes de MongoDB GET Business e MongoDB GET Cliente não precisam ser alteradas
//    pois o fluxo principal não passa mais por eles.

const { status, body: result } = await req('PUT', '/api/v1/workflows/jleu4RPvSnYDL8Gd', {
  name: wf.name,
  nodes: wf.nodes,
  connections: wf.connections,
  settings: { executionOrder: 'v1', saveManualExecutions: true },
});

if (status === 200) {
  console.log('Status: 200 OK');
  const dpConn = result.connections['Desembalar Payload'];
  console.log('Desembalar Payload conecta a:', dpConn?.main?.[0]?.[0]?.node);
} else {
  console.error('ERRO', status, JSON.stringify(result).slice(0, 500));
}

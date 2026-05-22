import 'dotenv/config';

const N8N = 'https://workflows.vendly.chat';
const KEY = process.env.N8N_API_KEY;
const h = { 'X-N8N-API-KEY': KEY, 'Accept': 'application/json' };

async function run() {
  // Pegar detalhes das execuções 180-184 do Entrada
  for (const eid of [184, 183, 182]) {
    const r = await fetch(`${N8N}/api/v1/executions/${eid}`, { headers: h });
    const exec = await r.json();
    const runData = exec?.data?.resultData?.runData ?? {};
    
    console.log(`\n=== Execução ${eid} ===`);
    
    // Ver o payload recebido no webhook (Receber Mensagem Chatwoot)
    const webhookNode = Object.entries(runData).find(([name]) => 
      name.toLowerCase().includes('webhook') || name.toLowerCase().includes('receber') || name.toLowerCase().includes('entrada')
    );
    if (webhookNode) {
      const payload = webhookNode[1]?.[0]?.data?.main?.[0]?.[0]?.json;
      console.log('Webhook payload (primeiros campos):', JSON.stringify(payload)?.slice(0, 200));
    }
    
    // Ver todos os nós executados
    Object.entries(runData).forEach(([name, data]) => {
      const items = data?.[0]?.data?.main?.[0];
      const error = data?.[0]?.error;
      if (error) {
        console.log(`  [ERROR] ${name}: ${error.message?.slice(0, 100)}`);
      } else if (items !== undefined) {
        console.log(`  [OK] ${name}: ${Array.isArray(items) ? items.length : 0} items`);
      }
    });
  }
}

run().catch(e => console.error(e));

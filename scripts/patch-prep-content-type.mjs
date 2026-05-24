/**
 * Patch pontual: garante que a chamada ao OpenRouter em "Prep Transcrição"
 * use Content-Type explícito e body como string JSON (mais seguro em Code nodes).
 */
import 'dotenv/config';

const N8N_URL = process.env.N8N_URL;
const N8N_KEY = process.env.N8N_API_KEY;
const WF_ID   = 'jleu4RPvSnYDL8Gd';
const HEADERS = { 'X-N8N-API-KEY': N8N_KEY, 'Accept': 'application/json', 'Content-Type': 'application/json' };

const r = await fetch(`${N8N_URL}/api/v1/workflows/${WF_ID}`, { headers: HEADERS });
const wf = await r.json();
const prep = wf.nodes.find(n => n.id === 'prep-transcricao');
if (!prep) throw new Error('Nó prep-transcricao não encontrado');

const OLD_CALL = `  const result = await this.helpers.httpRequestWithAuthentication(
    'httpHeaderAuth',
    {
      method: 'POST',
      url: 'https://openrouter.ai/api/v1/chat/completions',
      json: true,
      body: {
        model,
        messages: [{
          role: 'user',
          content: [
            {
              type: 'text',
              text: 'Transcreva este áudio para texto em português. Retorne SOMENTE o texto transcrito, sem comentários adicionais.'
            },
            {
              type: 'image_url',
              image_url: { url: \`data:\${mimeType};base64;\${base64}\` }
            },
          ],
        }],
      },
    }
  );`;

const NEW_CALL = `  const payload = {
    model,
    messages: [{
      role: 'user',
      content: [
        {
          type: 'text',
          text: 'Transcreva este áudio para texto em português. Retorne SOMENTE o texto transcrito, sem comentários adicionais.'
        },
        {
          type: 'image_url',
          image_url: { url: \`data:\${mimeType};base64,\${base64}\` }
        },
      ],
    }],
  };
  const result = await this.helpers.httpRequestWithAuthentication(
    'httpHeaderAuth',
    {
      method: 'POST',
      url: 'https://openrouter.ai/api/v1/chat/completions',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      json: true,
    }
  );`;

if (!prep.parameters.jsCode.includes('httpRequestWithAuthentication')) {
  console.log('❌ Chamada httpRequestWithAuthentication não encontrada no código');
  process.exit(1);
}

// Check if already patched (has JSON.stringify)
if (prep.parameters.jsCode.includes('JSON.stringify(payload)')) {
  console.log('✅ Já está com Content-Type explícito e JSON.stringify — sem alterações necessárias');
  process.exit(0);
}

// Note: the template literal in the stored code uses backticks escaped as \`
// We need to match the actual stored string
const currentCode = prep.parameters.jsCode;

// Find the section to replace — use a simpler approach: regex
const newCode = currentCode.replace(
  /const result = await this\.helpers\.httpRequestWithAuthentication\(\s*'httpHeaderAuth',\s*\{[\s\S]*?json: true,\s*body: \{[\s\S]*?\},\s*\}\s*\);/,
  NEW_CALL
);

if (newCode === currentCode) {
  console.log('⚠️  Padrão não encontrado para substituição — verificar código manualmente');
  // Show what we have
  const idx = currentCode.indexOf('httpRequestWithAuthentication');
  console.log('Código atual (±200 chars):', currentCode.slice(idx - 10, idx + 200));
  process.exit(1);
}

prep.parameters.jsCode = newCode;

const rPut = await fetch(`${N8N_URL}/api/v1/workflows/${WF_ID}`, {
  method: 'PUT',
  headers: HEADERS,
  body: JSON.stringify({
    name: wf.name,
    nodes: wf.nodes,
    connections: wf.connections,
    settings: { executionOrder: 'v1', saveManualExecutions: true },
  }),
});

const result = await rPut.json();
if (!rPut.ok) {
  console.error('❌ PUT falhou:', rPut.status, JSON.stringify(result).slice(0, 300));
  process.exit(1);
}

console.log('✅ Content-Type explícito e JSON.stringify aplicados ao Prep Transcrição');

// Verify
const updPrep = result.nodes.find(n => n.id === 'prep-transcricao');
const codeLines = updPrep.parameters.jsCode.split('\n');
const callStart = codeLines.findIndex(l => l.includes('httpRequestWithAuthentication'));
if (callStart >= 0) {
  console.log('\nChamada atualizada:');
  console.log(codeLines.slice(callStart - 1, callStart + 12).join('\n'));
}

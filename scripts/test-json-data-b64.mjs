import 'dotenv/config';
const H = { 'X-N8N-API-KEY': process.env.N8N_API_KEY, 'Accept': 'application/json' };
const exec = await fetch('https://workflows.vendly.chat/api/v1/executions/826?includeData=true', { headers: H }).then(r => r.json());
const ba = exec.data?.resultData?.runData?.['Baixar Áudio']?.[0];
const jsonData = ba?.data?.main?.[0]?.[0]?.json?.data;

const buf = Buffer.from(jsonData, 'latin1');
const base64 = buf.toString('base64');
console.log('base64 len:', base64.length, 'buf len:', buf.length);

const KEY = process.env.OPENROUTER_API_KEY;
const AH = { 'Authorization': `Bearer ${KEY}`, 'Content-Type': 'application/json' };

const r = await fetch('https://openrouter.ai/api/v1/chat/completions', {
  method: 'POST',
  headers: AH,
  body: JSON.stringify({
    model: 'google/gemini-2.0-flash-lite-001',
    messages: [{
      role: 'user',
      content: [
        { type: 'text', text: 'Transcreva este áudio para texto em português. Retorne SOMENTE o texto transcrito.' },
        { type: 'image_url', image_url: { url: `data:audio/ogg;base64,${base64}` } }
      ]
    }]
  })
}).then(r => r.json());

console.log('Full result:', JSON.stringify(r).slice(0, 400));

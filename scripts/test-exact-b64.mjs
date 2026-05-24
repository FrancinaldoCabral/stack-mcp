import 'dotenv/config';
const H = { 'X-N8N-API-KEY': process.env.N8N_API_KEY, 'Accept': 'application/json' };
const exec = await fetch('https://workflows.vendly.chat/api/v1/executions/798?includeData=true', { headers: H }).then(r => r.json());
const nodes = exec.data?.resultData?.runData ?? {};
const prep = nodes['Prep Transcrição']?.[0]?.data?.main?.[0]?.[0]?.json;
const base64 = prep?.audioBase64;
const mimeType = prep?.audioMimeType;

console.log('Testing with base64 from N8N execution, len:', base64.length, 'mime:', mimeType);

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
        { type: 'image_url', image_url: { url: `data:${mimeType};base64,${base64}` } }
      ]
    }]
  })
}).then(r => r.json());

console.log('Status:', r.error?.code, r.error?.message ?? r.choices?.[0]?.message?.content?.slice(0, 200));

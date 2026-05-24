import 'dotenv/config';

const AUDIO_URL = 'https://upload.wikimedia.org/wikipedia/commons/c/c8/Example.ogg';
const KEY = process.env.OPENROUTER_API_KEY;
const H = { 'Authorization': `Bearer ${KEY}`, 'Content-Type': 'application/json' };

// Test with URL directly (Gemini URL mode)
console.log('--- Test: URL direta no image_url ---');
const r = await fetch('https://openrouter.ai/api/v1/chat/completions', {
  method: 'POST',
  headers: H,
  body: JSON.stringify({
    model: 'google/gemini-2.0-flash-lite-001',
    messages: [{
      role: 'user',
      content: [
        { type: 'text', text: 'Transcreva este áudio para texto em português. Retorne SOMENTE o texto transcrito.' },
        { type: 'image_url', image_url: { url: AUDIO_URL } }
      ]
    }]
  })
}).then(r => r.json());

console.log('Result:', r.error?.message ?? r.choices?.[0]?.message?.content?.slice(0, 200));

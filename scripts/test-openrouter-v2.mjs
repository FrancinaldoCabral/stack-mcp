import 'dotenv/config';

// Test if OpenRouter/Gemini can fetch URL directly (not as image, but somehow)
// Try with a public accessible URL that serves audio
const AUDIO_URL = 'https://upload.wikimedia.org/wikipedia/commons/c/c8/Example.ogg';
const KEY = process.env.OPENROUTER_API_KEY;
const H = { 'Authorization': `Bearer ${KEY}`, 'Content-Type': 'application/json' };

// Attempt: fileUri style (Gemini native API supports this)
// OpenRouter may not support this but let's try
console.log('--- Test: fileUri style ---');
const r1 = await fetch('https://openrouter.ai/api/v1/chat/completions', {
  method: 'POST',
  headers: H,
  body: JSON.stringify({
    model: 'google/gemini-2.0-flash-lite-001',
    messages: [{
      role: 'user',
      content: [
        { type: 'text', text: 'Transcreva este áudio para texto em português. Retorne SOMENTE o texto.' },
        {
          type: 'image_url',
          image_url: {
            url: AUDIO_URL,
            // Try with audio mime hint
          }
        }
      ]
    }]
  })
}).then(r => r.json());
console.log('fileUri:', r1.error?.message ?? r1.choices?.[0]?.message?.content?.slice(0, 100));

// What worked before: let me reproduce EXACTLY the same request that worked
// From test-openrouter-audio.mjs: fetch the URL directly with fetch().arrayBuffer()
const r = await fetch(AUDIO_URL);
const ab = await r.arrayBuffer();
const buf = Buffer.from(ab);
const base64 = buf.toString('base64');
console.log('\nCorrect fetch base64 len:', base64.length);

const r2 = await fetch('https://openrouter.ai/api/v1/chat/completions', {
  method: 'POST',
  headers: H,
  body: JSON.stringify({
    model: 'google/gemini-2.0-flash-lite-001',
    messages: [{
      role: 'user',
      content: [
        { type: 'text', text: 'Transcreva este áudio para texto em português. Retorne SOMENTE o texto.' },
        { type: 'image_url', image_url: { url: `data:audio/ogg;base64,${base64}` } }
      ]
    }]
  })
}).then(r => r.json());
console.log('Correct fetch result:', r2.error?.message ?? r2.choices?.[0]?.message?.content?.slice(0, 100));

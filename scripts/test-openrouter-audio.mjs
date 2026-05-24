import 'dotenv/config';

// Test transcription with different formats
const AUDIO_URL = 'https://upload.wikimedia.org/wikipedia/commons/c/c8/Example.ogg';

// Download audio
const resp = await fetch(AUDIO_URL);
const buf = Buffer.from(await resp.arrayBuffer());
const base64 = buf.toString('base64');
console.log('Audio size:', buf.length, 'base64 len:', base64.length);

const KEY = process.env.OPENROUTER_API_KEY;
const H = { 'Authorization': `Bearer ${KEY}`, 'Content-Type': 'application/json' };

// Format 1: image_url with audio/ogg (current)
console.log('\n--- Test 1: image_url + gemini-2.0-flash-lite-001 ---');
const r1 = await fetch('https://openrouter.ai/api/v1/chat/completions', {
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
console.log('Status:', r1.error?.code, r1.error?.message ?? r1.choices?.[0]?.message?.content?.slice(0,100));

// Format 2: image_url with google/gemini-2.0-flash-001
console.log('\n--- Test 2: image_url + gemini-2.0-flash-001 ---');
const r2 = await fetch('https://openrouter.ai/api/v1/chat/completions', {
  method: 'POST',
  headers: H,
  body: JSON.stringify({
    model: 'google/gemini-2.0-flash-001',
    messages: [{
      role: 'user',
      content: [
        { type: 'text', text: 'Transcreva este áudio para texto em português. Retorne SOMENTE o texto.' },
        { type: 'image_url', image_url: { url: `data:audio/ogg;base64,${base64}` } }
      ]
    }]
  })
}).then(r => r.json());
console.log('Status:', r2.error?.code, r2.error?.message ?? r2.choices?.[0]?.message?.content?.slice(0,100));

// Format 3: input_audio (OpenAI gpt-4o format)
console.log('\n--- Test 3: input_audio + gpt-4o-audio-preview ---');
const r3 = await fetch('https://openrouter.ai/api/v1/chat/completions', {
  method: 'POST',
  headers: H,
  body: JSON.stringify({
    model: 'openai/gpt-4o-audio-preview',
    messages: [{
      role: 'user',
      content: [
        { type: 'text', text: 'Transcreva este áudio para texto em português. Retorne SOMENTE o texto.' },
        { type: 'input_audio', input_audio: { data: base64, format: 'wav' } }
      ]
    }]
  })
}).then(r => r.json());
console.log('Status:', r3.error?.code, r3.error?.message ?? r3.choices?.[0]?.message?.content?.slice(0,100));

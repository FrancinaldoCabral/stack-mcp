import 'dotenv/config';
const H = { 'X-N8N-API-KEY': process.env.N8N_API_KEY, 'Accept': 'application/json' };
const exec = await fetch('https://workflows.vendly.chat/api/v1/executions/798?includeData=true', { headers: H }).then(r => r.json());
const nodes = exec.data?.resultData?.runData ?? {};

const ta = nodes['Transcrever Áudio']?.[0];
const taJson = ta?.data?.main?.[0]?.[0]?.json;
console.log('Transcrever Áudio json:', JSON.stringify(taJson)?.slice(0, 400));

const cp = nodes['Construir Prompt']?.[0]?.data?.main?.[0]?.[0]?.json;
const userMsg = cp?.messages?.find?.(m => m.role === 'user');
console.log('Construir user content:', JSON.stringify(userMsg?.content)?.slice(0, 300));

const or = nodes['OpenRouter']?.[0]?.data?.main?.[0]?.[0]?.json;
const reply = or?.choices?.[0]?.message?.content;
console.log('Bot reply:', reply?.slice(0, 200));

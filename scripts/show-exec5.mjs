import 'dotenv/config';
const H = { 'X-N8N-API-KEY': process.env.N8N_API_KEY, 'Accept': 'application/json' };
const exec = await fetch('https://workflows.vendly.chat/api/v1/executions/858?includeData=true', { headers: H }).then(r => r.json());
const nodes = exec.data?.resultData?.runData ?? {};

const ba = nodes['Baixar Áudio']?.[0]?.data?.main?.[0]?.[0]?.json;
console.log('Baixar Áudio base64 len:', ba?.base64?.length, 'size:', ba?.size, 'mimeType:', ba?.mimeType);

const ta = nodes['Transcrever Áudio']?.[0]?.data?.main?.[0]?.[0]?.json;
const transcricao = ta?.choices?.[0]?.message?.content;
console.log('Transcrição:', transcricao?.slice(0, 200) ?? 'FALHOU: ' + JSON.stringify(ta?.error)?.slice(0, 100));

const cp = nodes['Construir Prompt']?.[0]?.data?.main?.[0]?.[0]?.json;
const userMsg = cp?.messages?.find?.(m => m.role === 'user');
console.log('User message ao LLM:', JSON.stringify(userMsg?.content)?.slice(0, 200));

const or = nodes['OpenRouter']?.[0]?.data?.main?.[0]?.[0]?.json;
console.log('Bot reply:', or?.choices?.[0]?.message?.content?.slice(0, 200));

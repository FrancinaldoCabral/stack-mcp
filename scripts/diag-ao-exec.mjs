import fs from 'node:fs';
const env = Object.fromEntries(fs.readFileSync('.env','utf8').split(/\r?\n/).filter(l=>l&&!l.startsWith('#')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i),l.slice(i+1)]}));
const N8N=env.N8N_URL, KEY=env.N8N_API_KEY;
const NH={'X-N8N-API-KEY':KEY,'Accept':'application/json'};

// Checar exec 3316 (Handle Takeover Humano output e Abrir Conversa)
const exc = await fetch(`${N8N}/api/v1/executions/3316?includeData=true`,{headers:NH}).then(r=>r.json());
const rd = exc.data?.resultData?.runData;

const aoOut = rd?.['Abrir Conversa']?.[0]?.data?.main?.[0]?.[0]?.json;
const htOut = rd?.['Handle Takeover Humano']?.[0]?.data?.main?.[0]?.[0]?.json;
const webhookIn = rd?.['Webhook Auto-Open']?.[0]?.data?.main?.[0]?.[0]?.json;

console.log('=== Exec 3316 ===');
console.log('Webhook input event:', webhookIn?.body?.event || webhookIn?.event);
console.log('Webhook input inbox_id:', webhookIn?.body?.inbox_id || webhookIn?.body?.conversation?.inbox_id);
console.log('Abrir Conversa output:', JSON.stringify(aoOut)?.slice(0,200));
console.log('Handle Takeover output:', JSON.stringify(htOut)?.slice(0,200));

const ifs = rd?.['IF SET ou DEL?']?.[0]?.data?.main;
console.log('IF SET ou DEL? [0]:', rd?.['IF SET ou DEL?']?.[0]?.data?.main?.[0]?.[0]?.json?._action);
console.log('IF SET ou DEL? result:', ifs?.[0]?.[0]?.json || ifs?.[1]?.[0]?.json);

// Redis SET/DEL - ver key
const rset = rd?.['Redis SET human_takeover']?.[0]?.data?.main?.[0]?.[0]?.json;
const rdel = rd?.['Redis DEL human_takeover']?.[0]?.data?.main?.[0]?.[0]?.json;
console.log('Redis SET key:', rset?.key || '(n/a)');
console.log('Redis DEL key:', rdel?.key || '(n/a)');

// Checar exec 3315 (provavelmente o par do 3316)
const exc2 = await fetch(`${N8N}/api/v1/executions/3315?includeData=true`,{headers:NH}).then(r=>r.json());
const rd2 = exc2.data?.resultData?.runData;
const ht2 = rd2?.['Handle Takeover Humano']?.[0]?.data?.main?.[0]?.[0]?.json;
const wb2 = rd2?.['Webhook Auto-Open']?.[0]?.data?.main?.[0]?.[0]?.json;
console.log('\n=== Exec 3315 ===');
console.log('event:', wb2?.body?.event || wb2?.event);
console.log('Handle Takeover output:', JSON.stringify(ht2)?.slice(0,300));

import dotenv from 'dotenv';
dotenv.config();
const CW_BASE = process.env.CHATWOOT_URL;
const CW_H = { 'api_access_token': process.env.CHATWOOT_API_KEY };

// Verificar quem é o dono do api_access_token atual
const profile = await fetch(`${CW_BASE}/api/v1/profile`, { headers: CW_H }).then(r => r.json()).catch(() => ({}));
console.log('Token pertence a:', profile.id, profile.name, profile.role);

// Verificar mensagens na conversa 11 para ver quem é o "autor" das outgoing
const msgs = await fetch(`${CW_BASE}/api/v1/accounts/1/conversations/11/messages`, { headers: CW_H }).then(r => r.json()).catch(() => ({}));
const msgList = msgs.payload ?? [];
console.log(`\nMensagens na conversa 11 (${msgList.length} total):`);
for (const m of msgList.slice(-5)) {
  console.log(`  id=${m.id} type=${m.message_type} author=${m.sender?.name ?? 'n/a'} content=${String(m.content ?? '').slice(0, 60)}`);
}

// Verificar se alguma mensagem outgoing tem author_type=agent_bot
const botMsgs = msgList.filter(m => m.sender?.type === 'agent_bot' || m.content_type === 'agent_bot');
console.log('\nMensagens do bot como agent_bot:', botMsgs.length);

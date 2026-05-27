import 'dotenv/config';
import axios from 'axios';
const h = { 'X-N8N-API-KEY': process.env.N8N_API_KEY };
const N8N = 'https://workflows.vendly.chat/api/v1';

// Entrada de mensagem + Auto-open
for (const id of ['bEb19TdWZfFloisU', 'Jijw4Dqil3QVYSp8']) {
  const wf = (await axios.get(`${N8N}/workflows/${id}`, { headers: h })).data;
  console.log(`\n========== ${wf.name} (${id}) ==========`);
  for (const n of wf.nodes) {
    if (/takeover|humano|human|assignee|bot.?ativo|bot.?off|verificar|switch|if|skip/i.test(n.name) || /takeover|humano|assignee/i.test(JSON.stringify(n.parameters))) {
      console.log(`\n--- ${n.name} (${n.type}) ---`);
      console.log(JSON.stringify(n.parameters, null, 2).slice(0, 2000));
    }
  }
}

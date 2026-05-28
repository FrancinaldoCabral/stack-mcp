/**
 * Fix Auto-open workflow:
 * 1. Abrir Conversa: inbox 11 → 12
 * 2. Handle Takeover Humano: strip @s.whatsapp.net from phone key
 *    (alinha com formato CORE/AGENT que usa telefone sem sufixo)
 */
import fs from 'node:fs';
const env = Object.fromEntries(fs.readFileSync('.env','utf8').split(/\r?\n/).filter(l=>l&&!l.startsWith('#')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i),l.slice(i+1)]}));
const N8N=env.N8N_URL, KEY=env.N8N_API_KEY;
const NH={'X-N8N-API-KEY':KEY,'Accept':'application/json','Content-Type':'application/json'};

const WF_ID = 'Jijw4Dqil3QVYSp8';
console.log('Buscando Auto-open workflow...');
const wf = await fetch(`${N8N}/api/v1/workflows/${WF_ID}`,{headers:NH}).then(r=>r.json());
console.log(`Workflow: "${wf.name}", ${wf.nodes.length} nós`);

// Fix 1: Abrir Conversa — inbox 11 → 12
const abrirConversa = wf.nodes.find(n=>n.name==='Abrir Conversa');
if (!abrirConversa) { console.error('❌ Nó "Abrir Conversa" não encontrado'); process.exit(1); }
if (!abrirConversa.parameters.jsCode.includes('!== 11')) {
  console.log('⚠️  Abrir Conversa já não usa inbox 11 (skip)');
} else {
  abrirConversa.parameters.jsCode = abrirConversa.parameters.jsCode.replace(
    'if (Number(inboxId) !== 11) return [];',
    'if (Number(inboxId) !== 12) return [];'
  );
  console.log('✅ Fix 1: Abrir Conversa inbox 11 → 12');
}

// Fix 2: Handle Takeover Humano — strip @s.whatsapp.net do phone
// Antes: const phone = identifier || (phoneRaw.replace(/\D/g, '') + (isGroup ? '' : '@s.whatsapp.net'));
// Key gerada: human_takeover:instance:5521969435536@s.whatsapp.net  ← ERRADO (mismatch com CORE/AGENT)
// Depois: const phone = (identifier || (...)).replace(/@s\.whatsapp\.net$/, '');
// Key gerada: human_takeover:instance:5521969435536  ← CORRETO (alinha com CORE/AGENT)
// Grupos (@g.us) NÃO são afetados (replace só remove @s.whatsapp.net)
const handleTakeover = wf.nodes.find(n=>n.name==='Handle Takeover Humano');
if (!handleTakeover) { console.error('❌ Nó "Handle Takeover Humano" não encontrado'); process.exit(1); }
const OLD_PHONE = `const phone = identifier || (phoneRaw.replace(/\\D/g, '') + (isGroup ? '' : '@s.whatsapp.net'));`;
const NEW_PHONE = `const phone = (identifier || (phoneRaw.replace(/\\D/g, '') + (isGroup ? '' : '@s.whatsapp.net'))).replace(/@s\\.whatsapp\\.net$/, ''); // strip @s.whatsapp.net — alinha com key CORE/AGENT`;
if (!handleTakeover.parameters.jsCode.includes(OLD_PHONE)) {
  console.log('⚠️  Handle Takeover Humano: linha phone não encontrada ou já corrigida');
  console.log('  Conteúdo atual da linha phone:');
  handleTakeover.parameters.jsCode.split('\n').filter(l=>l.includes('const phone')).forEach(l=>console.log(' ',l));
} else {
  handleTakeover.parameters.jsCode = handleTakeover.parameters.jsCode.replace(OLD_PHONE, NEW_PHONE);
  console.log('✅ Fix 2: Handle Takeover Humano strip @s.whatsapp.net (grupos @g.us preservados)');
}

// Salvar e fazer PUT
console.log('\nAplicando PUT no N8N...');
const body = {
  name: wf.name,
  nodes: wf.nodes,
  connections: wf.connections,
  settings: { executionOrder: 'v1', saveManualExecutions: true },
};
const res = await fetch(`${N8N}/api/v1/workflows/${WF_ID}`,{method:'PUT',headers:NH,body:JSON.stringify(body)});
if (res.ok) {
  console.log(`✅ Auto-open workflow atualizado com sucesso (status ${res.status})`);
} else {
  const err = await res.text();
  console.error(`❌ Erro ao atualizar workflow (status ${res.status}): ${err.slice(0,300)}`);
}

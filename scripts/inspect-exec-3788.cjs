const fs = require('fs');

const d = JSON.parse(fs.readFileSync('execlist-latest.json', 'utf8'));
const ex = (d.data || []).find(e => String(e.id) === '3788');
if (!ex) {
  console.error('Exec 3788 não encontrada');
  process.exit(1);
}

const rd = ex.data?.resultData?.runData || {};

function firstJson(node) {
  const run = rd[node]?.[0];
  return run?.data?.main?.[0]?.[0]?.json;
}

function printNode(node) {
  const run = rd[node]?.[0];
  if (!run) return;
  const j = run.data?.main?.[0]?.[0]?.json;
  console.log(`\n=== ${node} ===`);
  if (j == null) {
    console.log('(sem json no [0][0])');
    return;
  }
  if (typeof j === 'string') {
    console.log(j);
    return;
  }
  const s = JSON.stringify(j, null, 2);
  console.log(s.slice(0, 4000));
}

printNode('OpenRouter');
printNode('Executar Tool MCP');
printNode('Montar Tool Result MCP');
printNode('OpenRouter Com Ferramenta');
printNode('Parsear Chunks');

// tenta extrair conteúdo completo do OpenRouter Com Ferramenta
const ocf = firstJson('OpenRouter Com Ferramenta');
const content = ocf?.choices?.[0]?.message?.content;
if (content) {
  console.log('\n=== OpenRouter Com Ferramenta content ===');
  console.log(content);
}

const toolArgs = firstJson('OpenRouter')?.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments;
if (toolArgs) {
  console.log('\n=== OpenRouter tool arguments ===');
  console.log(toolArgs);
}

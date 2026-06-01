const fs = require('fs');

const path = 'execlist-latest.json';
if (!fs.existsSync(path)) {
  console.error('Arquivo execlist-latest.json não encontrado');
  process.exit(1);
}

const d = JSON.parse(fs.readFileSync(path, 'utf8'));
const arr = d.data || [];

const needles = ['05:57', 'Pronto às', 'PRAZO PREPARO', 'Pronto as'];

for (const ex of arr) {
  const full = JSON.stringify(ex);
  if (!needles.some(n => full.includes(n))) continue;

  console.log(`\n=== Execution ${ex.id} | status=${ex.status} | ${ex.finishedAt || ex.startedAt} ===`);

  const rd = ex.data?.resultData?.runData || {};
  for (const [node, runs] of Object.entries(rd)) {
    const txt = JSON.stringify(runs);
    if (needles.some(n => txt.includes(n))) {
      console.log(`node: ${node}`);
      if (txt.includes('05:57')) console.log('  contains: 05:57');
      if (txt.includes('Pronto às')) console.log('  contains: Pronto às');
      if (txt.includes('PRAZO PREPARO')) console.log('  contains: PRAZO PREPARO');
    }
  }
}

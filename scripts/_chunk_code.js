// Chunking definitivo: divide apenas em parágrafos (\n\n+), sem corte por tamanho.
// Chunks órfãos (pontuação solta, < 6 chars) são fundidos ao chunk anterior.
const _rawContent = content.replace(/^\s*\[\d{2}\/\d{2}\/\d{4},?\s*\d{2}:\d{2}\]\s*/, '');
const _paragraphs = _rawContent.split(/\n{2,}/).map(s => s.trim()).filter(s => s.length > 0);
const chunks = [];
for (const _p of _paragraphs) {
  const _isOrphan = _p.length < 6 || /^[\)\]?.!,;:\s]+$/.test(_p);
  if (_isOrphan && chunks.length > 0) {
    const _startsWithPunct = /^[\)\]?.!,;:]/.test(_p);
    chunks[chunks.length - 1] += (_startsWithPunct ? '' : ' ') + _p;
  } else {
    chunks.push(_p);
  }
}
import { Router } from 'express';
import { config } from '../../config.js';

export const knowledgeRouter = Router();

const qdrantBase = config.qdrant.url.replace(/\/$/, '');
const qdrantHeaders = () => ({
  'Content-Type': 'application/json',
  ...(config.qdrant.apiKey ? { 'api-key': config.qdrant.apiKey } : {}),
});

const COLLECTION = 'vendly_knowledge';

// Ensure collection exists
async function ensureCollection() {
  const r = await fetch(`${qdrantBase}/collections/${COLLECTION}`, { headers: qdrantHeaders() });
  if (r.status === 404) {
    await fetch(`${qdrantBase}/collections/${COLLECTION}`, {
      method: 'PUT',
      headers: qdrantHeaders(),
      body: JSON.stringify({ vectors: { size: 1536, distance: 'Cosine' } }),
    });
  }
}

// GET /api/knowledge?businessId=&category=&page=&limit=
knowledgeRouter.get('/', async (req, res) => {
  try {
    await ensureCollection();
    const limit = Math.min(Number(req.query.limit ?? 50), 200);
    const offset = Number(req.query.page ?? 0) * limit;
    const filter: Record<string, unknown>[] = [];
    if (req.query.businessId) filter.push({ key: 'businessId', match: { value: String(req.query.businessId) } });
    if (req.query.category) filter.push({ key: 'category', match: { value: String(req.query.category) } });

    const scrollBody: Record<string, unknown> = { limit, offset, with_payload: true, with_vector: false };
    if (filter.length) scrollBody.filter = { must: filter };

    const r = await fetch(`${qdrantBase}/collections/${COLLECTION}/points/scroll`, {
      method: 'POST',
      headers: qdrantHeaders(),
      body: JSON.stringify(scrollBody),
    });
    const data = await r.json() as { result?: { points: unknown[] } };
    res.json({ data: data.result?.points ?? [] });
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

// POST /api/knowledge  — creates a new knowledge item (embeds via OpenRouter)
knowledgeRouter.post('/', async (req, res) => {
  try {
    await ensureCollection();
    const { title, text, category, businessId, customerId } = req.body as Record<string, string>;
    if (!title || !text || !businessId) return res.status(400).json({ error: 'title, text e businessId são obrigatórios' });

    // Generate embedding
    const embRes = await fetch('https://openrouter.ai/api/v1/embeddings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.openrouter.apiKey}` },
      body: JSON.stringify({ model: config.openrouter.embeddingModel, input: `${title}: ${text}` }),
    });
    const embData = await embRes.json() as { data?: { embedding: number[] }[] };
    const vector = embData.data?.[0]?.embedding;
    if (!vector) return res.status(500).json({ error: 'Falha ao gerar embedding' });

    const pointId = Date.now();
    const payload = { title, text, category: category ?? 'general', businessId, ...(customerId ? { customerId } : {}), createdAt: new Date().toISOString() };

    await fetch(`${qdrantBase}/collections/${COLLECTION}/points`, {
      method: 'PUT',
      headers: qdrantHeaders(),
      body: JSON.stringify({ points: [{ id: pointId, vector, payload }] }),
    });
    res.status(201).json({ id: pointId, payload });
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

// PUT /api/knowledge/:id — update payload (no re-embedding)
knowledgeRouter.put('/:id', async (req, res) => {
  try {
    const { title, text, category } = req.body as Record<string, string>;
    const payload: Record<string, string> = {};
    if (title) payload.title = title;
    if (text) payload.text = text;
    if (category) payload.category = category;

    await fetch(`${qdrantBase}/collections/${COLLECTION}/points/payload`, {
      method: 'POST',
      headers: qdrantHeaders(),
      body: JSON.stringify({ payload, points: [Number(req.params.id)] }),
    });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

// DELETE /api/knowledge/:id
knowledgeRouter.delete('/:id', async (req, res) => {
  try {
    await fetch(`${qdrantBase}/collections/${COLLECTION}/points/delete`, {
      method: 'POST',
      headers: qdrantHeaders(),
      body: JSON.stringify({ points: [Number(req.params.id)] }),
    });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

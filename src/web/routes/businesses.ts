import { Router } from 'express';
import { ObjectId } from 'mongodb';
import { getDb } from '../../tools/mongodb.js';

export const businessesRouter = Router();

// GET /api/businesses
businessesRouter.get('/', async (_req, res) => {
  try {
    const db = await getDb();
    const docs = await db.collection('businesses').find({}).sort({ createdAt: -1 }).toArray();
    res.json(docs);
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

// GET /api/businesses/:id
businessesRouter.get('/:id', async (req, res) => {
  try {
    const db = await getDb();
    const doc = await db.collection('businesses').findOne({ _id: new ObjectId(req.params.id) });
    if (!doc) return res.status(404).json({ error: 'Not found' });
    res.json(doc);
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

// POST /api/businesses
businessesRouter.post('/', async (req, res) => {
  try {
    const db = await getDb();
    const now = new Date();
    const doc = {
      name: String(req.body.name ?? ''),
      instances: Array.isArray(req.body.instances) ? req.body.instances : [],
      assistantName: String(req.body.assistantName ?? 'Assistente'),
      systemPrompt: String(req.body.systemPrompt ?? ''),
      settings: {
        model: req.body.settings?.model ?? 'google/gemini-2.5-flash-preview',
        maxHistoryTokens: Number(req.body.settings?.maxHistoryTokens ?? 500_000),
        tools: { searchMemory: req.body.settings?.tools?.searchMemory ?? true },
      },
      createdAt: now,
      updatedAt: now,
    };
    const result = await db.collection('businesses').insertOne(doc);
    res.status(201).json({ ...doc, _id: result.insertedId });
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

// PUT /api/businesses/:id
businessesRouter.put('/:id', async (req, res) => {
  try {
    const db = await getDb();
    const update: Record<string, unknown> = { updatedAt: new Date() };
    if (req.body.name !== undefined) update.name = req.body.name;
    if (req.body.instances !== undefined) update.instances = req.body.instances;
    if (req.body.assistantName !== undefined) update.assistantName = req.body.assistantName;
    if (req.body.systemPrompt !== undefined) update.systemPrompt = req.body.systemPrompt;
    if (req.body.settings !== undefined) update.settings = req.body.settings;
    const result = await db.collection('businesses').findOneAndUpdate(
      { _id: new ObjectId(req.params.id) },
      { $set: update },
      { returnDocument: 'after' }
    );
    if (!result) return res.status(404).json({ error: 'Not found' });
    res.json(result);
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

// DELETE /api/businesses/:id
businessesRouter.delete('/:id', async (req, res) => {
  try {
    const db = await getDb();
    await db.collection('businesses').deleteOne({ _id: new ObjectId(req.params.id) });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

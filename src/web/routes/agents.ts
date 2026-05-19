import { Router } from 'express';
import { ObjectId } from 'mongodb';
import { getDb } from '../../tools/mongodb.js';

export const agentsRouter = Router();

// GET /api/agents/:businessId
agentsRouter.get('/:businessId', async (req, res) => {
  try {
    const db = await getDb();
    const doc = await db.collection('businesses').findOne(
      { _id: new ObjectId(req.params.businessId) },
      { projection: { assistantName: 1, systemPrompt: 1, settings: 1 } }
    );
    if (!doc) return res.status(404).json({ error: 'Business not found' });
    res.json(doc);
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

// PUT /api/agents/:businessId  — update agent config
agentsRouter.put('/:businessId', async (req, res) => {
  try {
    const db = await getDb();
    const update: Record<string, unknown> = { updatedAt: new Date() };
    if (req.body.assistantName !== undefined) update.assistantName = req.body.assistantName;
    if (req.body.systemPrompt !== undefined) update.systemPrompt = req.body.systemPrompt;
    if (req.body.settings !== undefined) update.settings = req.body.settings;
    const result = await db.collection('businesses').findOneAndUpdate(
      { _id: new ObjectId(req.params.businessId) },
      { $set: update },
      { returnDocument: 'after', projection: { assistantName: 1, systemPrompt: 1, settings: 1 } }
    );
    if (!result) return res.status(404).json({ error: 'Business not found' });
    res.json(result);
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

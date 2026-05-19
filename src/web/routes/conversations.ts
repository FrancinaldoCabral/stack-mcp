import { Router } from 'express';
import { ObjectId } from 'mongodb';
import { getDb } from '../../tools/mongodb.js';

export const conversationsRouter = Router();

// GET /api/conversations?businessId=&customerId=&phone=&page=&limit=
conversationsRouter.get('/', async (req, res) => {
  try {
    const db = await getDb();
    const filter: Record<string, unknown> = {};
    if (req.query.businessId) filter.businessId = new ObjectId(String(req.query.businessId));
    if (req.query.customerId) filter.customerId = new ObjectId(String(req.query.customerId));
    if (req.query.phone) filter.phone = String(req.query.phone);
    const limit = Math.min(Number(req.query.limit ?? 50), 200);
    const skip = Number(req.query.page ?? 0) * limit;
    // Project without full messages array in list view
    const [docs, total] = await Promise.all([
      db.collection('conversations')
        .find(filter, { projection: { messages: 0 } })
        .sort({ started_at: -1 })
        .skip(skip)
        .limit(limit)
        .toArray(),
      db.collection('conversations').countDocuments(filter),
    ]);
    res.json({ data: docs, total, page: Number(req.query.page ?? 0), limit });
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

// GET /api/conversations/:id  (full, with messages)
conversationsRouter.get('/:id', async (req, res) => {
  try {
    const db = await getDb();
    const doc = await db.collection('conversations').findOne({ _id: new ObjectId(req.params.id) });
    if (!doc) return res.status(404).json({ error: 'Not found' });
    res.json(doc);
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

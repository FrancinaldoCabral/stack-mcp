import { Router } from 'express';
import { ObjectId } from 'mongodb';
import { getDb } from '../../tools/mongodb.js';

export const customersRouter = Router();

// GET /api/customers?businessId=&search=&page=&limit=
customersRouter.get('/', async (req, res) => {
  try {
    const db = await getDb();
    const filter: Record<string, unknown> = {};
    if (req.query.businessId) filter.businessId = new ObjectId(String(req.query.businessId));
    if (req.query.search) {
      const re = new RegExp(String(req.query.search), 'i');
      filter.$or = [{ name: re }, { phone: re }];
    }
    const limit = Math.min(Number(req.query.limit ?? 50), 200);
    const skip = Number(req.query.page ?? 0) * limit;
    const [docs, total] = await Promise.all([
      db.collection('customers').find(filter).sort({ last_seen: -1 }).skip(skip).limit(limit).toArray(),
      db.collection('customers').countDocuments(filter),
    ]);
    res.json({ data: docs, total, page: Number(req.query.page ?? 0), limit });
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

// GET /api/customers/:id
customersRouter.get('/:id', async (req, res) => {
  try {
    const db = await getDb();
    const doc = await db.collection('customers').findOne({ _id: new ObjectId(req.params.id) });
    if (!doc) return res.status(404).json({ error: 'Not found' });
    res.json(doc);
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

// PUT /api/customers/:id (update profile/name)
customersRouter.put('/:id', async (req, res) => {
  try {
    const db = await getDb();
    const update: Record<string, unknown> = { updatedAt: new Date() };
    if (req.body.name !== undefined) update.name = req.body.name;
    if (req.body.profile !== undefined) update.profile = req.body.profile;
    const result = await db.collection('customers').findOneAndUpdate(
      { _id: new ObjectId(req.params.id) },
      { $set: update },
      { returnDocument: 'after' }
    );
    if (!result) return res.status(404).json({ error: 'Not found' });
    res.json(result);
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

// DELETE /api/customers/:id
customersRouter.delete('/:id', async (req, res) => {
  try {
    const db = await getDb();
    await db.collection('customers').deleteOne({ _id: new ObjectId(req.params.id) });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

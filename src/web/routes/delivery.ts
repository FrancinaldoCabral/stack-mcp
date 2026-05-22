import { Router } from 'express';
import { ObjectId } from 'mongodb';
import { getDb } from '../../tools/mongodb.js';

export const deliveryRouter = Router();

// ── Restaurantes ──────────────────────────────────────────────────────────────

deliveryRouter.get('/restaurants', async (_req, res) => {
  try {
    const db = await getDb();
    const docs = await db.collection('delivery_restaurants').find({}).sort({ name: 1 }).toArray();
    res.json(docs);
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

deliveryRouter.post('/restaurants', async (req, res) => {
  try {
    const db = await getDb();
    const { name, commandGroupJid, delivererGroupJid } = req.body as Record<string, string>;
    if (!name || !commandGroupJid || !delivererGroupJid) {
      return res.status(400).json({ error: 'name, commandGroupJid e delivererGroupJid são obrigatórios' });
    }
    const doc = {
      name,
      commandGroupJid,
      delivererGroupJid,
      active: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const result = await db.collection('delivery_restaurants').insertOne(doc);
    res.json({ ...doc, _id: result.insertedId });
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

deliveryRouter.put('/restaurants/:id', async (req, res) => {
  try {
    const db = await getDb();
    const { name, commandGroupJid, delivererGroupJid, active } = req.body as Record<string, unknown>;
    const update: Record<string, unknown> = { updatedAt: new Date() };
    if (name !== undefined) update.name = name;
    if (commandGroupJid !== undefined) update.commandGroupJid = commandGroupJid;
    if (delivererGroupJid !== undefined) update.delivererGroupJid = delivererGroupJid;
    if (active !== undefined) update.active = active;
    const result = await db.collection('delivery_restaurants').findOneAndUpdate(
      { _id: new ObjectId(req.params.id) },
      { $set: update },
      { returnDocument: 'after' }
    );
    if (!result) return res.status(404).json({ error: 'Not found' });
    res.json(result);
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

deliveryRouter.delete('/restaurants/:id', async (req, res) => {
  try {
    const db = await getDb();
    await db.collection('delivery_restaurants').deleteOne({ _id: new ObjectId(req.params.id) });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

// ── Pedidos ───────────────────────────────────────────────────────────────────

deliveryRouter.get('/orders', async (req, res) => {
  try {
    const db = await getDb();
    const filter: Record<string, unknown> = {};
    if (req.query.restaurantId) filter.restaurantId = String(req.query.restaurantId);
    if (req.query.status) filter.status = String(req.query.status);
    if (req.query.delivererJid) filter.delivererJid = String(req.query.delivererJid);
    if (req.query.days) {
      const since = new Date(Date.now() - Number(req.query.days) * 86_400_000);
      filter.createdAt = { $gte: since };
    }
    const limit = Math.min(Number(req.query.limit ?? 200), 1000);
    const skip = Number(req.query.page ?? 0) * limit;
    const [docs, total] = await Promise.all([
      db.collection('delivery_orders').find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).toArray(),
      db.collection('delivery_orders').countDocuments(filter),
    ]);
    res.json({ data: docs, total });
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

// ── Acertos ───────────────────────────────────────────────────────────────────

deliveryRouter.get('/settlements', async (req, res) => {
  try {
    const db = await getDb();
    const filter: Record<string, unknown> = {};
    if (req.query.delivererJid) {
      const re = new RegExp(String(req.query.delivererJid), 'i');
      filter.$or = [{ delivererJid: re }, { delivererName: re }];
    }
    if (req.query.status) filter.status = String(req.query.status);
    if (req.query.restaurantId) filter.restaurantId = String(req.query.restaurantId);
    if (req.query.days) {
      const since = new Date(Date.now() - Number(req.query.days) * 86_400_000);
      filter.date = { $gte: since };
    }
    const limit = Math.min(Number(req.query.limit ?? 500), 2000);
    const skip = Number(req.query.page ?? 0) * limit;
    const [docs, total] = await Promise.all([
      db.collection('delivery_settlements').find(filter).sort({ date: -1 }).skip(skip).limit(limit).toArray(),
      db.collection('delivery_settlements').countDocuments(filter),
    ]);
    res.json({ data: docs, total });
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

deliveryRouter.put('/settlements/:id', async (req, res) => {
  try {
    const db = await getDb();
    const { status } = req.body as { status: string };
    if (!['pendente', 'liquidado'].includes(status)) {
      return res.status(400).json({ error: 'status inválido' });
    }
    const result = await db.collection('delivery_settlements').findOneAndUpdate(
      { _id: new ObjectId(req.params.id) },
      { $set: { status, updatedAt: new Date() } },
      { returnDocument: 'after' }
    );
    if (!result) return res.status(404).json({ error: 'Not found' });
    res.json(result);
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

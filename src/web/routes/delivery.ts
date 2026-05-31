import { Router } from 'express';
import { ObjectId } from 'mongodb';
import { getDb } from '../../tools/mongodb.js';
import { syncPersonaRoutesToRedis } from './businesses.js';

export const deliveryRouter = Router();

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Aceita `commandJid` ou legacy `commandGroupJid`; deduz `commandIsGroup`. */
function normalizeRestaurantInput(body: Record<string, unknown>) {
  const out: Record<string, unknown> = {};
  if (body.name !== undefined) out.name = String(body.name);
  if (body.businessId !== undefined) out.businessId = body.businessId ? String(body.businessId) : null;
  if (body.active !== undefined) out.active = !!body.active;

  const cmd = (body.commandJid ?? body.commandGroupJid) as string | undefined;
  if (cmd !== undefined) {
    const v = String(cmd ?? '').trim();
    out.commandJid = v;
    out.commandGroupJid = v; // mantém legado em sync
    out.commandIsGroup = body.commandIsGroup !== undefined
      ? !!body.commandIsGroup
      : v.endsWith('@g.us');
  }
  if (body.delivererGroupJid !== undefined) {
    out.delivererGroupJid = String(body.delivererGroupJid ?? '').trim();
  }
  if (body.address !== undefined) {
    out.address = String(body.address ?? '').trim();
  }
  return out;
}

/** Reconstrói `business.contextRoutes` com base nos restaurantes ativos do negócio. */
async function refreshContextRoutesFromRestaurants(businessId: string): Promise<void> {
  const db = await getDb();
  const restaurants = await db.collection('delivery_restaurants').find({
    businessId, active: { $ne: false },
  }).toArray();

  const biz = await db.collection('businesses').findOne(
    { _id: new ObjectId(businessId) },
    { projection: { contextRoutes: 1 } },
  );
  const existing = Array.isArray(biz?.contextRoutes)
    ? (biz!.contextRoutes as Array<{ jid: string; personaKey: string; restaurantId?: string }>)
    : [];

  // Preserva rotas manuais (sem restaurantId ou apontando para restaurantes inexistentes)
  const restaurantIds = new Set(restaurants.map(r => String(r._id)));
  const manualRoutes = existing.filter(r => !r.restaurantId || !restaurantIds.has(r.restaurantId));

  const autoRoutes: Array<{ jid: string; personaKey: string; restaurantId: string }> = [];
  for (const r of restaurants) {
    const cmdJid = String((r.commandJid ?? r.commandGroupJid ?? '') as string).trim();
    const dlvJid = String((r.delivererGroupJid ?? '') as string).trim();
    const rid = String(r._id);
    if (cmdJid) autoRoutes.push({ jid: cmdJid, personaKey: 'restaurant', restaurantId: rid });
    if (dlvJid) autoRoutes.push({ jid: dlvJid, personaKey: 'deliverer', restaurantId: rid });
  }

  // Dedupe por jid; auto vence em conflito
  const byJid = new Map<string, { jid: string; personaKey: string; restaurantId?: string }>();
  for (const r of manualRoutes) byJid.set(r.jid, r);
  for (const r of autoRoutes) byJid.set(r.jid, r);
  const merged = Array.from(byJid.values());

  await db.collection('businesses').updateOne(
    { _id: new ObjectId(businessId) },
    { $set: { contextRoutes: merged, updatedAt: new Date() } },
  );
  await syncPersonaRoutesToRedis(businessId);
}

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
    const fields = normalizeRestaurantInput(req.body as Record<string, unknown>);
    const name = fields.name as string | undefined;
    const cmdJid = fields.commandJid as string | undefined;
    const dlvJid = fields.delivererGroupJid as string | undefined;
    if (!name || !cmdJid || !dlvJid) {
      return res.status(400).json({ error: 'name, commandJid e delivererGroupJid são obrigatórios' });
    }
    const now = new Date();
    const doc: Record<string, unknown> = {
      name,
      businessId: fields.businessId ?? null,
      commandJid: cmdJid,
      commandGroupJid: cmdJid,
      commandIsGroup: !!fields.commandIsGroup,
      delivererGroupJid: dlvJid,
      address: (fields.address as string | undefined) ?? '',
      active: fields.active !== false,
      createdAt: now,
      updatedAt: now,
    };
    const result = await db.collection('delivery_restaurants').insertOne(doc);
    if (doc.businessId) await refreshContextRoutesFromRestaurants(String(doc.businessId));
    res.json({ ...doc, _id: result.insertedId });
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

deliveryRouter.put('/restaurants/:id', async (req, res) => {
  try {
    const db = await getDb();
    const update: Record<string, unknown> = {
      ...normalizeRestaurantInput(req.body as Record<string, unknown>),
      updatedAt: new Date(),
    };
    const result = await db.collection('delivery_restaurants').findOneAndUpdate(
      { _id: new ObjectId(req.params.id) },
      { $set: update },
      { returnDocument: 'after' }
    );
    if (!result) return res.status(404).json({ error: 'Not found' });
    if (result.businessId) await refreshContextRoutesFromRestaurants(String(result.businessId));
    res.json(result);
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

deliveryRouter.delete('/restaurants/:id', async (req, res) => {
  try {
    const db = await getDb();
    const doc = await db.collection('delivery_restaurants').findOne({ _id: new ObjectId(req.params.id) });
    await db.collection('delivery_restaurants').deleteOne({ _id: new ObjectId(req.params.id) });
    if (doc?.businessId) await refreshContextRoutesFromRestaurants(String(doc.businessId));
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

// PUT /api/delivery/orders/:id — edição manual de pedido pela UI
deliveryRouter.put('/orders/:id', async (req, res) => {
  try {
    const db = await getDb();
    const body = req.body as Record<string, unknown>;
    const ALLOWED = ['status', 'clientName', 'clientAddress', 'clientPhone', 'items', 'value', 'delivererJid', 'delivererName', 'settlement', 'restaurantId', 'restaurantName'];
    const update: Record<string, unknown> = { updatedAt: new Date() };
    for (const k of ALLOWED) {
      if (body[k] !== undefined) update[k] = body[k];
    }
    const result = await db.collection('delivery_orders').findOneAndUpdate(
      { _id: new ObjectId(req.params.id) },
      { $set: update },
      { returnDocument: 'after' }
    );
    if (!result) return res.status(404).json({ error: 'Not found' });
    res.json(result);
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

// DELETE /api/delivery/orders/:id — remoção manual de pedido pela UI
deliveryRouter.delete('/orders/:id', async (req, res) => {
  try {
    const db = await getDb();
    const result = await db.collection('delivery_orders').deleteOne({ _id: new ObjectId(req.params.id) });
    if (result.deletedCount === 0) return res.status(404).json({ error: 'Not found' });
    res.json({ ok: true });
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

// POST /api/delivery/settlements — criação manual pela UI
deliveryRouter.post('/settlements', async (req, res) => {
  try {
    const db = await getDb();
    const body = req.body as Record<string, unknown>;
    const delivererJid = String(body.delivererJid ?? '').trim();
    const delivererName = String(body.delivererName ?? '').trim();
    const type = String(body.type ?? 'debito');
    const amount = Number(body.amount ?? 0);
    if (!delivererJid || !delivererName || !['debito', 'credito'].includes(type) || !Number.isFinite(amount) || amount < 0) {
      return res.status(400).json({ error: 'delivererJid, delivererName, type (debito|credito) e amount válidos são obrigatórios' });
    }
    const doc = {
      delivererJid,
      delivererName,
      type,
      amount,
      description: String(body.description ?? ''),
      restaurantId: body.restaurantId ? String(body.restaurantId) : null,
      restaurantName: String(body.restaurantName ?? ''),
      orderId: body.orderId ? String(body.orderId) : null,
      orderRef: body.orderRef ? String(body.orderRef) : null,
      status: 'pendente' as const,
      date: new Date(),
      createdAt: new Date(),
    };
    const result = await db.collection('delivery_settlements').insertOne(doc);
    res.json({ ...doc, _id: result.insertedId });
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

// PUT /api/delivery/settlements/:id — edição completa
deliveryRouter.put('/settlements/:id', async (req, res) => {
  try {
    const db = await getDb();
    const body = req.body as Record<string, unknown>;
    const update: Record<string, unknown> = { updatedAt: new Date() };

    if (body.status !== undefined) {
      const s = String(body.status);
      if (!['pendente', 'liquidado'].includes(s)) return res.status(400).json({ error: 'status inválido' });
      update.status = s;
    }
    if (body.type !== undefined) {
      const t = String(body.type);
      if (!['debito', 'credito'].includes(t)) return res.status(400).json({ error: 'type inválido' });
      update.type = t;
    }
    if (body.amount !== undefined) {
      const a = Number(body.amount);
      if (!Number.isFinite(a) || a < 0) return res.status(400).json({ error: 'amount inválido' });
      update.amount = a;
    }
    if (body.description !== undefined) update.description = String(body.description);
    if (body.delivererJid !== undefined) update.delivererJid = String(body.delivererJid);
    if (body.delivererName !== undefined) update.delivererName = String(body.delivererName);
    if (body.restaurantId !== undefined) update.restaurantId = body.restaurantId ? String(body.restaurantId) : null;
    if (body.restaurantName !== undefined) update.restaurantName = String(body.restaurantName);
    if (body.orderRef !== undefined) update.orderRef = String(body.orderRef);

    const result = await db.collection('delivery_settlements').findOneAndUpdate(
      { _id: new ObjectId(req.params.id) },
      { $set: update },
      { returnDocument: 'after' }
    );
    if (!result) return res.status(404).json({ error: 'Not found' });
    res.json(result);
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

deliveryRouter.delete('/settlements/:id', async (req, res) => {
  try {
    const db = await getDb();
    await db.collection('delivery_settlements').deleteOne({ _id: new ObjectId(req.params.id) });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

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

// ── Entregadores (lista distinta) ─────────────────────────────────────────────

deliveryRouter.get('/deliverers', async (_req, res) => {
  try {
    const db = await getDb();
    const rows = await db.collection('delivery_orders').aggregate([
      { $match: { delivererJid: { $exists: true, $ne: null } } },
      { $group: { _id: '$delivererJid', name: { $first: '$delivererName' } } },
      { $project: { _id: 0, jid: '$_id', name: 1 } },
      { $sort: { name: 1 } },
    ]).toArray();
    res.json(rows);
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

// ── Relatórios ────────────────────────────────────────────────────────────────

// GET /api/delivery/reports/summary?from=YYYY-MM-DD&to=YYYY-MM-DD
// Relatório geral — todos restaurantes e todos entregadores no período
deliveryRouter.get('/reports/summary', async (req, res) => {
  try {
    const db = await getDb();
    const from = req.query.from ? new Date(String(req.query.from)) : new Date(Date.now() - 30 * 86400000);
    const to = req.query.to ? new Date(String(req.query.to) + 'T23:59:59') : new Date();

    const orders = await db.collection('delivery_orders').find({
      status: { $nin: ['rascunho', 'cancelado'] },
      createdAt: { $gte: from, $lte: to },
    }).toArray();

    const settlements = await db.collection('delivery_settlements').find({
      date: { $gte: from, $lte: to },
    }).toArray();

    // Resumo por restaurante
    const byRestaurant: Record<string, {
      restaurantId: string; restaurantName: string;
      orderCount: number; totalOrderValue: number; totalDeliveryFees: number; totalSettlements: number;
    }> = {};
    for (const o of orders) {
      const rid = String(o.restaurantId || '');
      if (!byRestaurant[rid]) {
        byRestaurant[rid] = {
          restaurantId: rid,
          restaurantName: String(o.restaurantName || ''),
          orderCount: 0, totalOrderValue: 0, totalDeliveryFees: 0, totalSettlements: 0,
        };
      }
      byRestaurant[rid].orderCount++;
      byRestaurant[rid].totalOrderValue += Number(o.value) || 0;
      byRestaurant[rid].totalDeliveryFees += Number(o.deliveryFee) || 0;
    }
    // Add settlements to restaurant summaries
    for (const s of settlements) {
      const rid = String(s.restaurantId || '');
      if (byRestaurant[rid]) byRestaurant[rid].totalSettlements += Number(s.amount) || 0;
    }

    // Resumo por entregador
    const byDeliverer: Record<string, {
      delivererJid: string; delivererName: string;
      orderCount: number; totalCommission: number; totalSettlements: number;
    }> = {};
    for (const o of orders) {
      if (!o.delivererJid) continue;
      const djid = String(o.delivererJid);
      if (!byDeliverer[djid]) {
        byDeliverer[djid] = {
          delivererJid: djid,
          delivererName: String(o.delivererName || ''),
          orderCount: 0, totalCommission: 0, totalSettlements: 0,
        };
      }
      byDeliverer[djid].orderCount++;
      byDeliverer[djid].totalCommission += Number(o.deliveryFee) || 0;
    }
    for (const s of settlements) {
      const djid = String(s.delivererJid || '');
      if (byDeliverer[djid]) byDeliverer[djid].totalSettlements += Number(s.amount) || 0;
    }

    const round2 = (v: number) => Math.round(v * 100) / 100;
    const restaurantRows = Object.values(byRestaurant).map(r => ({
      ...r,
      totalOrderValue: round2(r.totalOrderValue),
      totalDeliveryFees: round2(r.totalDeliveryFees),
      totalSettlements: round2(r.totalSettlements),
      outstandingDebt: round2(r.totalDeliveryFees - r.totalSettlements),
      totalRestaurantProfit: round2(r.totalOrderValue - r.totalDeliveryFees),
    })).sort((a, b) => b.totalDeliveryFees - a.totalDeliveryFees);

    const delivererRows = Object.values(byDeliverer).map(d => ({
      ...d,
      totalCommission: round2(d.totalCommission),
      totalSettlements: round2(d.totalSettlements),
      outstandingCredit: round2(d.totalCommission - d.totalSettlements),
    })).sort((a, b) => b.totalCommission - a.totalCommission);

    const totalDeliveryFees = round2(restaurantRows.reduce((s, r) => s + r.totalDeliveryFees, 0));
    const totalSettlementsRestaurant = round2(restaurantRows.reduce((s, r) => s + r.totalSettlements, 0));
    const totalOrderValue = round2(restaurantRows.reduce((s, r) => s + r.totalOrderValue, 0));

    res.json({
      period: { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) },
      totals: {
        orderCount: orders.length,
        totalOrderValue,
        totalDeliveryFees,
        totalSettlementsReceived: totalSettlementsRestaurant,
        outstandingFromRestaurants: round2(totalDeliveryFees - totalSettlementsRestaurant),
      },
      restaurants: restaurantRows,
      deliverers: delivererRows,
    });
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

// GET /api/delivery/reports/restaurant?restaurantId=&from=YYYY-MM-DD&to=YYYY-MM-DD
deliveryRouter.get('/reports/restaurant', async (req, res) => {
  try {
    const db = await getDb();
    const restaurantId = String(req.query.restaurantId ?? '').trim();
    if (!restaurantId) return res.status(400).json({ error: 'restaurantId obrigatório' });

    const from = req.query.from ? new Date(String(req.query.from)) : new Date(Date.now() - 30 * 86400000);
    const to = req.query.to ? new Date(String(req.query.to) + 'T23:59:59') : new Date();

    const restaurant = await db.collection('delivery_restaurants').findOne({ _id: new ObjectId(restaurantId) });
    if (!restaurant) return res.status(404).json({ error: 'Restaurante não encontrado' });

    const orders = await db.collection('delivery_orders').find({
      restaurantId,
      status: { $nin: ['rascunho', 'cancelado'] },
      createdAt: { $gte: from, $lte: to },
    }).sort({ createdAt: 1 }).toArray();

    // Acertos (settlements) do restaurante no período
    const settlements = await db.collection('delivery_settlements').find({
      restaurantId,
      date: { $gte: from, $lte: to },
    }).toArray();

    const totalDeliveryFees = orders.reduce((s, o) => s + (Number(o.deliveryFee) || 0), 0);
    const totalOrderValue = orders.reduce((s, o) => s + (Number(o.value) || 0), 0);
    const totalRestaurantProfit = totalOrderValue - totalDeliveryFees;
    const totalSettlements = settlements.reduce((s, st) => s + (Number(st.amount) || 0), 0);

    const orderRows = orders.map(o => {
      const dt = o.createdAt ? new Date(o.createdAt) : null;
      const dateStr = dt ? dt.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', timeZone: 'Europe/Brussels' }) : '';
      const timeStr = dt ? dt.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Brussels' }) : '';
      const fee = Number(o.deliveryFee) || 0;
      const val = Number(o.value) || 0;
      return {
        _id: String(o._id),
        orderRef: o.orderRef ?? '',
        date: dateStr,
        time: timeStr,
        clientAddress: o.clientAddress ?? '',
        commune: o.clientCommune ?? '',
        distanceKm: o.distanceKm ?? null,
        orderValue: val,
        deliveryFee: fee,
        foodValue: Math.round((val - fee) * 100) / 100,
        settlementAmount: o.settlementAmount ?? null,
        delivererName: o.delivererName ?? '',
        paymentMethod: o.paymentMethod ?? '',
        externalCode: o.externalCode ?? '',
        status: o.status,
      };
    });

    res.json({
      restaurant: {
        _id: String(restaurant._id),
        name: restaurant.name,
        address: restaurant.address ?? '',
      },
      period: {
        from: from.toISOString().slice(0, 10),
        to: to.toISOString().slice(0, 10),
      },
      summary: {
        totalDeliveryFees: Math.round(totalDeliveryFees * 100) / 100,
        totalSettlementsReceived: Math.round(totalSettlements * 100) / 100,
        outstandingDebt: Math.round((totalDeliveryFees - totalSettlements) * 100) / 100,
        totalOrderValue: Math.round(totalOrderValue * 100) / 100,
        totalRestaurantProfit: Math.round(totalRestaurantProfit * 100) / 100,
        orderCount: orders.length,
      },
      orders: orderRows,
    });
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

// GET /api/delivery/reports/deliverer?delivererJid=&from=YYYY-MM-DD&to=YYYY-MM-DD
deliveryRouter.get('/reports/deliverer', async (req, res) => {
  try {
    const db = await getDb();
    const delivererJid = String(req.query.delivererJid ?? '').trim();
    const delivererName = String(req.query.delivererName ?? '').trim();
    if (!delivererJid && !delivererName) return res.status(400).json({ error: 'delivererJid ou delivererName obrigatório' });

    const from = req.query.from ? new Date(String(req.query.from)) : new Date(Date.now() - 30 * 86400000);
    const to = req.query.to ? new Date(String(req.query.to) + 'T23:59:59') : new Date();

    const orderFilter: Record<string, unknown> = {
      status: { $nin: ['rascunho', 'cancelado'] },
      createdAt: { $gte: from, $lte: to },
    };
    if (delivererJid) orderFilter.delivererJid = delivererJid;
    else orderFilter.delivererName = new RegExp(delivererName, 'i');

    const orders = await db.collection('delivery_orders').find(orderFilter).sort({ createdAt: 1 }).toArray();

    // Acertos recebidos pelo entregador no período
    const stFilter: Record<string, unknown> = { date: { $gte: from, $lte: to } };
    if (delivererJid) stFilter.delivererJid = delivererJid;
    else stFilter.delivererName = new RegExp(delivererName, 'i');
    const settlements = await db.collection('delivery_settlements').find(stFilter).toArray();

    const totalCommission = orders.reduce((s, o) => s + (Number(o.deliveryFee) || 0), 0);
    const totalSettlements = settlements.reduce((s, st) => s + (Number(st.amount) || 0), 0);

    const resolvedDelivererName = orders[0]?.delivererName ?? delivererName;

    const orderRows = orders.map(o => {
      const dt = o.createdAt ? new Date(o.createdAt) : null;
      const dateStr = dt ? dt.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', timeZone: 'Europe/Brussels' }) : '';
      const timeStr = dt ? dt.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Brussels' }) : '';
      return {
        _id: String(o._id),
        orderRef: o.orderRef ?? '',
        date: dateStr,
        time: timeStr,
        restaurantName: o.restaurantName ?? '',
        clientAddress: o.clientAddress ?? '',
        commune: o.clientCommune ?? '',
        distanceKm: o.distanceKm ?? null,
        settlementAmount: o.settlementAmount ?? null,
        commission: Number(o.deliveryFee) || 0,
        status: o.status,
      };
    });

    res.json({
      deliverer: { jid: delivererJid, name: resolvedDelivererName },
      period: {
        from: from.toISOString().slice(0, 10),
        to: to.toISOString().slice(0, 10),
      },
      summary: {
        totalCommission: Math.round(totalCommission * 100) / 100,
        totalSettlementsReceived: Math.round(totalSettlements * 100) / 100,
        outstandingCredit: Math.round((totalCommission - totalSettlements) * 100) / 100,
        orderCount: orders.length,
      },
      orders: orderRows,
    });
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

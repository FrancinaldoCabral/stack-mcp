import { Router } from 'express';
import { ObjectId } from 'mongodb';
import { getDb } from '../../tools/mongodb.js';
import { handleSystemTool } from '../../tools/system.js';

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

// DELETE /api/conversations/all  — apaga TUDO (Chatwoot + Redis + MongoDB)
conversationsRouter.delete('/all', async (_req, res) => {
  try {
    const result = await handleSystemTool('system_clear_all_conversations', {});
    res.json({ ok: true, detail: result });
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

// DELETE /api/conversations/contact/:phone  — apaga tudo de um contato
conversationsRouter.delete('/contact/:phone', async (req, res) => {
  try {
    const phone = req.params.phone.replace(/\D/g, '');
    if (!phone) return res.status(400).json({ error: 'Phone inválido' });
    const result = await handleSystemTool('system_clear_contact', { phone, instance: req.query.instance });
    res.json({ ok: true, phone, detail: result });
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

import { Router } from 'express';
import { ObjectId } from 'mongodb';
import { getDb } from '../../tools/mongodb.js';

export const analyticsRouter = Router();

// GET /api/analytics?businessId=&days=7
analyticsRouter.get('/', async (req, res) => {
  try {
    const db = await getDb();
    const days = Math.min(Number(req.query.days ?? 7), 365);
    const since = new Date(Date.now() - days * 86_400_000);
    const bizFilter: Record<string, unknown> = {};
    if (req.query.businessId) bizFilter.businessId = new ObjectId(String(req.query.businessId));

    const [
      totalBusinesses,
      totalCustomers,
      totalConversations,
      recentConversations,
      recentCustomers,
    ] = await Promise.all([
      db.collection('businesses').countDocuments(),
      db.collection('customers').countDocuments(bizFilter),
      db.collection('conversations').countDocuments(bizFilter),
      db.collection('conversations').countDocuments({ ...bizFilter, started_at: { $gte: since } }),
      db.collection('customers').countDocuments({ ...bizFilter, createdAt: { $gte: since } }),
    ]);

    // Messages per day (last N days)
    const msgPipeline = [
      { $match: { ...bizFilter, started_at: { $gte: since } } },
      {
        $group: {
          _id: { $dateToString: { format: '%Y-%m-%d', date: '$started_at' } },
          conversations: { $sum: 1 },
          messages: { $sum: { $ifNull: ['$message_count', 0] } },
        },
      },
      { $sort: { _id: 1 } },
    ];
    const dailyStats = await db.collection('conversations').aggregate(msgPipeline).toArray();

    // Top customers by conversations
    const topCustomersPipeline = [
      { $match: { ...bizFilter } },
      { $sort: { conversation_count: -1 } },
      { $limit: 10 },
      { $project: { name: 1, phone: 1, conversation_count: 1, last_seen: 1 } },
    ];
    const topCustomers = await db.collection('customers').aggregate(topCustomersPipeline).toArray();

    // Model usage
    const modelPipeline = [
      { $match: { ...bizFilter } },
      { $group: { _id: '$model_used', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
    ];
    const modelUsage = await db.collection('conversations').aggregate(modelPipeline).toArray();

    res.json({
      summary: {
        totalBusinesses,
        totalCustomers,
        totalConversations,
        recentConversations,
        recentCustomers,
        period: `${days}d`,
      },
      dailyStats,
      topCustomers,
      modelUsage,
    });
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

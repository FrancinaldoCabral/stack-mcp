import { Router } from 'express';
import { requireAuth } from './auth.js';
import { businessesRouter } from './routes/businesses.js';
import { customersRouter } from './routes/customers.js';
import { conversationsRouter } from './routes/conversations.js';
import { analyticsRouter } from './routes/analytics.js';
import { knowledgeRouter } from './routes/knowledge.js';
import { agentsRouter } from './routes/agents.js';
import { deliveryRouter } from './routes/delivery.js';

export const apiRouter = Router();

apiRouter.use(requireAuth);
apiRouter.use('/businesses', businessesRouter);
apiRouter.use('/customers', customersRouter);
apiRouter.use('/conversations', conversationsRouter);
apiRouter.use('/analytics', analyticsRouter);
apiRouter.use('/knowledge', knowledgeRouter);
apiRouter.use('/agents', agentsRouter);
apiRouter.use('/delivery', deliveryRouter);

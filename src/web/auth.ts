import type { RequestHandler } from 'express';
import { config } from '../config.js';

export const requireAuth: RequestHandler = (req, res, next) => {
  const key = config.admin.apiKey;
  const auth = String(req.headers['authorization'] ?? req.headers['x-api-key'] ?? req.query['key'] ?? '');
  if (auth === key || auth === `Bearer ${key}`) return next();
  res.status(401).json({ error: 'Unauthorized' });
};

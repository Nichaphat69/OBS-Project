import { Router } from 'express';
import { requireAuth } from '../lib/requireAuth.js';
import { requireSuperAdmin } from '../lib/requireRole.js';
import { listApiActivity, listApiActivityServices } from '../lib/apiActivityLogService.js';

export const apiActivityLogRouter = Router();

apiActivityLogRouter.use(requireAuth, requireSuperAdmin);

apiActivityLogRouter.get('/', async (req, res) => {
  const q = req.query;
  res.json(
    await listApiActivity({
      direction: q.direction === 'consume' || q.direction === 'expose' ? q.direction : undefined,
      service: typeof q.service === 'string' && q.service ? q.service : undefined,
      status: q.status === 'ok' || q.status === 'error' ? q.status : undefined,
      from: typeof q.from === 'string' && q.from ? q.from : undefined,
      to: typeof q.to === 'string' && q.to ? q.to : undefined,
      limit: q.limit ? Number(q.limit) : undefined,
    }),
  );
});

apiActivityLogRouter.get('/services', async (_req, res) => {
  res.json(await listApiActivityServices());
});

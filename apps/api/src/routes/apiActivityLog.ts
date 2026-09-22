import { Router } from 'express';
import { requireAuth } from '../lib/requireAuth.js';
import { requireSuperAdmin } from '../lib/requireRole.js';
import { listApiActivity, listApiActivityServices, listApiActivityMethods } from '../lib/apiActivityLogService.js';

export const apiActivityLogRouter = Router();

apiActivityLogRouter.use(requireAuth, requireSuperAdmin);

apiActivityLogRouter.get('/', async (req, res) => {
  const q = req.query;
  const directionRaw = q.direction;
  const direction = (Array.isArray(directionRaw) ? directionRaw : typeof directionRaw === 'string' && directionRaw ? directionRaw.split(',') : [])
    .filter((d): d is 'consume' | 'expose' => d === 'consume' || d === 'expose');

  res.json(
    await listApiActivity({
      direction,
      service: typeof q.service === 'string' && q.service ? q.service : undefined,
      method: typeof q.method === 'string' && q.method ? q.method : undefined,
      status: q.status === 'ok' || q.status === 'error' ? q.status : undefined,
      q: typeof q.q === 'string' && q.q ? q.q : undefined,
      from: typeof q.from === 'string' && q.from ? q.from : undefined,
      to: typeof q.to === 'string' && q.to ? q.to : undefined,
      page: q.page ? Number(q.page) : undefined,
      pageSize: q.pageSize ? Number(q.pageSize) : undefined,
    }),
  );
});

apiActivityLogRouter.get('/services', async (_req, res) => {
  res.json(await listApiActivityServices());
});

apiActivityLogRouter.get('/methods', async (_req, res) => {
  res.json(await listApiActivityMethods());
});

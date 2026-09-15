import { Router } from 'express';
import { requireAuth } from '../lib/requireAuth.js';
import { requireSuperAdmin } from '../lib/requireRole.js';
import { auditLog } from '../lib/auditLogService.js';

export const auditLogRouter = Router();

auditLogRouter.use(requireAuth, requireSuperAdmin);

auditLogRouter.get('/', async (req, res) => {
  const limit = req.query.limit ? Number(req.query.limit) : undefined;
  res.json(await auditLog({ limit }));
});

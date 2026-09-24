import { Router } from 'express';
import { requireAuth } from '../lib/requireAuth.js';
import { requireSuperAdmin } from '../lib/requireRole.js';
import { auditLog } from '../lib/auditLogService.js';

export const auditLogRouter = Router();

auditLogRouter.use(requireAuth, requireSuperAdmin);

auditLogRouter.get('/', async (req, res) => {
  const page = req.query.page ? Number(req.query.page) : undefined;
  const pageSize = req.query.pageSize ? Number(req.query.pageSize) : undefined;
  res.json(await auditLog({ page, pageSize }));
});

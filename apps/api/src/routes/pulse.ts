import { Router } from 'express';
import { requireAuth } from '../lib/requireAuth.js';
import { pulse } from '../lib/pulseService.js';
import { requestScope } from '../lib/scopeService.js';

export const pulseRouter = Router();
pulseRouter.use(requireAuth);

pulseRouter.get('/', async (req, res) => {
  const { contractIds } = await requestScope(req);
  res.json(await pulse({ actor: req.user!.nameTh, role: req.user!.role, employeeId: req.user!.employeeId, contractIds }));
});

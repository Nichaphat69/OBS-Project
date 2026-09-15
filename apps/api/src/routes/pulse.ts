import { Router } from 'express';
import { requireAuth } from '../lib/requireAuth.js';
import { pulse } from '../lib/pulseService.js';

export const pulseRouter = Router();
pulseRouter.use(requireAuth);

pulseRouter.get('/', async (req, res) => {
  res.json(await pulse({ actor: req.user!.nameTh, role: req.user!.role, employeeId: req.user!.employeeId }));
});

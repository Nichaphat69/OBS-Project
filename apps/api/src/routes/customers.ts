import { Router } from 'express';
import { requireAuth } from '../lib/requireAuth.js';
import { requireAdmin, requireSuperAdmin } from '../lib/requireRole.js';
import { listCustomerDomains, setCustomerEmailDomain, claimCustomerEmailDomain, createCustomer, CustomerActionError } from '../lib/customersService.js';

export const customersRouter = Router();
customersRouter.use(requireAuth);

customersRouter.get('/domains', requireSuperAdmin, async (_req, res) => {
  res.json(await listCustomerDomains());
});

/** ported from server.js `POST /api/customers` — สร้างลูกค้าเปล่าๆ ยังใช้งานไม่ได้จนกว่าจะ
 * createContract ต่อ (ฟอร์ม "เพิ่มลูกค้าใหม่" เรียกทั้งสองต่อกันเสมอ) */
customersRouter.post('/', requireAdmin, async (req, res) => {
  try {
    res.json(await createCustomer({ ...req.body, actor: req.user!.nameTh }));
  } catch (error) {
    if (error instanceof CustomerActionError) return res.status(error.status).json({ error: error.message });
    throw error;
  }
});

customersRouter.patch('/:id/email-domain', requireSuperAdmin, async (req, res) => {
  try {
    res.json(await setCustomerEmailDomain(req.params.id, req.body?.domain ?? null, { actor: req.user!.nameTh }));
  } catch (error) {
    if (error instanceof CustomerActionError) return res.status(error.status).json({ error: error.message });
    throw error;
  }
});

customersRouter.post('/:id/email-domain/claim', requireAdmin, async (req, res) => {
  try {
    res.json(await claimCustomerEmailDomain(req.params.id, req.body?.domain ?? '', { actor: req.user!.nameTh }));
  } catch (error) {
    if (error instanceof CustomerActionError) return res.status(error.status).json({ error: error.message });
    throw error;
  }
});

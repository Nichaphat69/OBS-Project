import { Router } from 'express';
import { requireAuth } from '../lib/requireAuth.js';
import { requireAdmin, requireSuperAdmin, requireNotUser } from '../lib/requireRole.js';
import {
  listCustomerDomains,
  listCustomersWithoutContract,
  setCustomerEmailDomain,
  claimCustomerEmailDomain,
  createCustomer,
  deleteCustomer,
  CustomerActionError,
} from '../lib/customersService.js';

export const customersRouter = Router();
customersRouter.use(requireAuth);

customersRouter.get('/domains', requireSuperAdmin, async (_req, res) => {
  res.json(await listCustomerDomains());
});

/** ใหม่ — รายชื่อลูกค้าที่ยังไม่มีสัญญาเลย (ดู listCustomersWithoutContract) หน้า "ลูกค้า & สัญญา"
 * ใช้แสดงเป็นรายการแยกให้กลับมาเพิ่มสัญญาต่อได้ หลังแยกขั้นตอนสร้างลูกค้า/สัญญาออกจากกัน */
customersRouter.get('/without-contract', requireNotUser, async (_req, res) => {
  res.json(await listCustomersWithoutContract());
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

/** ใหม่ — ลบลูกค้าที่ยังไม่มีสัญญา (ดู deleteCustomer) ใช้เคลียร์รายที่สร้างค้างไว้/สร้างซ้ำ */
customersRouter.delete('/:id', requireAdmin, async (req, res) => {
  try {
    res.json(await deleteCustomer(req.params.id, { actor: req.user!.nameTh }));
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

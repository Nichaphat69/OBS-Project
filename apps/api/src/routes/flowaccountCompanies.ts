import { Router } from 'express';
import { requireAuth } from '../lib/requireAuth.js';
import { requireAdmin } from '../lib/requireRole.js';
import { listFlowAccountCompanies } from '../lib/contractsMasterService.js';

export const flowAccountCompaniesRouter = Router();
flowAccountCompaniesRouter.use(requireAuth);

/** ported from server.js `GET /api/flowaccount/companies` — อ่านใบเสนอราคาจาก FlowAccount มาช่วย
 * กรอกฟอร์ม "เพิ่มลูกค้าใหม่" ของแท็บ "ข้อมูลหลัก → ลูกค้า & สัญญา" */
flowAccountCompaniesRouter.get('/companies', requireAdmin, async (_req, res) => {
  res.json(await listFlowAccountCompanies());
});

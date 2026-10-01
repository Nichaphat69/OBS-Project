import { Router } from 'express';
import { requireAuth } from '../lib/requireAuth.js';
import { requireAdmin } from '../lib/requireRole.js';
import { dashboard } from '../lib/dashboardService.js';
import { requestScope } from '../lib/scopeService.js';

export const dashboardRouter = Router();

// ⚠️ เดิมเช็คแค่ว่า login อยู่หรือเปล่า (เช็ค session เองแทนใช้ requireAuth กลาง) ไม่มี role check
// เลย — role 'user' เห็นแดชบอร์ดสรุปทุกบริษัท/ยอดเงินรวมได้ (เจอจริง 15 ก.ย. 69 ตามที่ user ชี้แจง
// เพิ่มเติม) ตรงกับหน้า "แดชบอร์ด" ใน nav ที่จำกัด admin/accounting เท่านั้นอยู่แล้ว — เปลี่ยนมาใช้
// requireAuth+requireAdmin แบบเดียวกับ route อื่นทั้งหมดแทนการเช็ค session มือเอง
dashboardRouter.get('/', requireAuth, requireAdmin, async (req, res) => {
  const { contractIds } = await requestScope(req);
  const data = await dashboard(contractIds);
  res.json(data);
});

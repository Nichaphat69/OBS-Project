import { Router } from 'express';
import { requireAuth } from '../lib/requireAuth.js';
import { employeeProgress } from '../lib/dashboardService.js';

export const myProgressRouter = Router();
myProgressRouter.use(requireAuth);

/** ความคืบหน้าของตัวเอง — เฉพาะ role 'user' (พนักงาน) ใช้ session.employeeId เสมอ ไม่รับจาก client
 * (กันสวมสิทธิ์ดูของคนอื่น) บัญชียังไม่ผูกพนักงานเลยคืน null ให้หน้าเว็บโชว์ข้อความแจ้งแทน */
myProgressRouter.get('/', async (req, res) => {
  if (req.user!.role !== 'user') return res.status(403).json({ error: 'มีแค่ role พนักงานเท่านั้นที่ดูหน้านี้ได้' });
  if (!req.user!.employeeId) return res.json(null);
  res.json(await employeeProgress(req.user!.employeeId));
});

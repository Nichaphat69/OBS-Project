import { Router } from 'express';
import { requireAuth } from '../lib/requireAuth.js';
import { requireNotUser } from '../lib/requireRole.js';
import { getActiveContract } from '../lib/dashboardService.js';
import { activityFeed, employeeTimesheetFeed } from '../lib/activityFeedService.js';

export const activityRouter = Router();
activityRouter.use(requireAuth);

/** role 'executive' เห็นภาพรวมทุกบริษัทพร้อมกันอยู่แล้ว (ไม่มีตัวสลับบริษัทให้ด้วย) จึงไม่กรองตาม
 * บริษัท active ให้ — role อื่น (admin/accounting) กรองด้วยบริษัทที่ active อยู่ตอนนี้เสมอ */
/** ⚠️ เดิมไม่มี role check เลย — role 'user' ดึงฟีดรวมทั้งบริษัทได้ ซึ่งมีชื่อเพื่อนร่วมงาน จำนวนวันที่
 * วางบิลได้ ยอดเงินรายบรรทัด เลขที่ใบแจ้งหนี้ และยอดรับชำระ (18 ก.ย. 69) หน้าเว็บส่ง role 'user' ไปที่
 * /api/my-notifications อยู่แล้ว (NotificationsClient.tsx) ฟีดรวมนี้จึงไม่เคยถูกใช้โดย role นั้นเลย */
activityRouter.get('/', requireNotUser, async (req, res) => {
  const limit = req.query.limit ? Number(req.query.limit) : 30;
  const activeContract = req.user!.role === 'executive' ? null : await getActiveContract();
  res.json(await activityFeed({ limit, contractId: activeContract?.id ?? null }));
});

export const myNotificationsRouter = Router();
myNotificationsRouter.use(requireAuth);

/** "การแจ้งเตือน" ของ role 'user' — เห็นแค่สถานะ Timesheet ของตัวเอง ไม่ใช่ฟีดรวมทั้งระบบ */
myNotificationsRouter.get('/', async (req, res) => {
  if (req.user!.role !== 'user') return res.status(403).json({ error: 'มีแค่ role พนักงานเท่านั้นที่ดูหน้านี้ได้' });
  if (!req.user!.employeeId) return res.json({ items: [], latestAt: null, counts: { total: 0, critical: 0 } });
  res.json(await employeeTimesheetFeed(req.user!.employeeId));
});

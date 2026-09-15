import { Router } from 'express';
import { requireAuth } from '../lib/requireAuth.js';
import { requireNotExecutive } from '../lib/requireRole.js';
import { checkLeavesAgainstHrdd, HrddCompareError } from '../lib/hrddCompareService.js';

export const hrddRouter = Router();

hrddRouter.use(requireAuth);

/** เทียบวันลากับ HRDD ตอนรีวิวก่อนบันทึกในหน้า "อัปโหลด Timesheet" — ยังไม่มี timesheetId อ่านอย่าง
 * เดียวเหมือนกัน ไม่มีเขียน/แก้/ลบฝั่ง HRDD — ported from server.js's POST /api/hrdd-compare-preview */
hrddRouter.post('/hrdd-compare-preview', requireNotExecutive, async (req, res) => {
  try {
    const body = req.body ?? {};
    res.json(await checkLeavesAgainstHrdd({ employeeId: body.employeeId, period: body.period, leaveDays: body.leaveDays ?? [] }));
  } catch (error) {
    if (error instanceof HrddCompareError) return res.status(error.status).json({ error: error.message });
    throw error;
  }
});

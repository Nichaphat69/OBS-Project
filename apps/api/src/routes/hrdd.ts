import { Router } from 'express';
import { requireAuth } from '../lib/requireAuth.js';
import { ForbiddenEmployeeScope, requireNotExecutive, scopedEmployeeId } from '../lib/requireRole.js';
import { checkLeavesAgainstHrdd, HrddCompareError } from '../lib/hrddCompareService.js';

export const hrddRouter = Router();

hrddRouter.use(requireAuth);

/**
 * เทียบวันลากับ HRDD ตอนรีวิวก่อนบันทึกในหน้า "อัปโหลด Timesheet" — ยังไม่มี timesheetId อ่านอย่าง
 * เดียวเหมือนกัน ไม่มีเขียน/แก้/ลบฝั่ง HRDD — ported from server.js's POST /api/hrdd-compare-preview
 *
 * ⚠️ `requireNotExecutive` กันเฉพาะ role 'executive' เท่านั้น — role 'user' ผ่านด่านนี้ได้ ซึ่ง **ถูกต้อง
 * แล้ว** เพราะพนักงานทั่วไปต้องใช้หน้าอัปโหลด Timesheet ของตัวเองได้ แต่เดิม `employeeId` อ่านจาก body
 * ตรงๆ ไม่ผูกกับคนที่ล็อกอิน พนักงานจึงยิง employeeId ของเพื่อนร่วมงานมาอ่าน **ประวัติการลาจากระบบ HR
 * ของคนอื่น** ได้ (วันที่ + ประเภทการลา) และไล่เดารหัสพนักงานที่มีอยู่จริงได้จากผลลัพธ์ 404/200
 * (18 ก.ย. 69) — ผูกกับ session แบบเดียวกับ POST /api/timesheets/confirm ที่แก้ไปแล้วเมื่อ 15 ก.ย. 69
 */
hrddRouter.post('/hrdd-compare-preview', requireNotExecutive, async (req, res) => {
  try {
    const body = req.body ?? {};
    const employeeId = scopedEmployeeId(req.user, body.employeeId);
    res.json(await checkLeavesAgainstHrdd({ employeeId, period: body.period, leaveDays: body.leaveDays ?? [] }));
  } catch (error) {
    if (error instanceof ForbiddenEmployeeScope) return res.status(error.status).json({ error: error.message });
    if (error instanceof HrddCompareError) return res.status(error.status).json({ error: error.message });
    throw error;
  }
});

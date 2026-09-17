/**
 * หน้า "บันทึกการส่ง" — ใครส่ง Timesheet แล้ว ผ่านช่องทางไหน เมื่อไหร่ อยู่ขั้นไหน
 *
 * ⚠️ **แยกเป็นสองเส้นโดยตั้งใจ ไม่ใช่เส้นเดียวแล้วแตก branch ตาม role**
 *
 * เส้นนี้มีข้อมูลพนักงานทุกคนในบริษัท ถ้าใช้เส้นเดียวกันแล้วค่อยเช็ค role ข้างใน ความปลอดภัยจะขึ้นกับ
 * ตรรกะที่เขียนถูกทุกบรรทัด — พลาดครั้งเดียวคือพนักงานคนหนึ่งเห็นข้อมูลของทั้งบริษัท พอแยกเป็นสองเส้น
 * ด่านจะอยู่ที่ตัว router เอง (`requireAdmin`) role ที่ไม่ผ่านจึงไปไม่ถึงโค้ดนั้นเลยตั้งแต่แรก
 *
 * `/mine` **ไม่อ่าน employeeId จาก query เลยแม้แต่บรรทัดเดียว** — ยึดจาก session เท่านั้น ส่งพารามิเตอร์
 * ข้ามคนมาก็ไม่มีผล และบัญชีที่ยังไม่ได้ผูกพนักงานจะได้รายการว่าง ไม่ใช่ได้ของคนอื่น
 *
 * บทเรียนจากวันนี้ (17 ก.ย. 69) ที่ยึดไว้: **ไม่ระบุขอบเขต = แคบไว้ก่อน ไม่ใช่เห็นหมด** — มีสองเส้นที่
 * พลาดทิศนี้มาแล้ว (timesheets กับ invoices) โดยที่ "ไม่ส่ง contractId" กลายเป็น "เอาทุกบริษัท"
 */
import { Router } from 'express';
import { requireAuth } from '../lib/requireAuth.js';
import { requireAdmin } from '../lib/requireRole.js';
import {
  listTimesheetSubmissions,
  type SubmissionLogFilter,
  type SubmissionMethod,
  type SubmissionStatus,
} from '../lib/submissionLogService.js';
import { confirmSubmission, SubmissionReviewError } from '../lib/submissionRecordService.js';

export const timesheetSubmissionsRouter = Router();
timesheetSubmissionsRouter.use(requireAuth);

const str = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);

function filtersFrom(query: Record<string, unknown>): SubmissionLogFilter {
  return {
    period: str(query.period),
    contractId: str(query.contractId),
    method: str(query.method) as SubmissionMethod | null,
    status: str(query.status) as SubmissionStatus | null,
  };
}

/**
 * ของพนักงานคนที่ล็อกอินอยู่เท่านั้น — ทุก role เรียกได้ แต่ได้เฉพาะของตัวเอง
 *
 * บัญชี admin/accounting ที่ไม่ได้ผูกพนักงานไว้จะได้รายการว่างจากเส้นนี้ ซึ่งถูกต้องแล้ว — เขาดูภาพรวม
 * ได้จากเส้นด้านล่างอยู่แล้ว
 */
timesheetSubmissionsRouter.get('/mine', async (req, res) => {
  const employeeId = req.user!.employeeId;
  if (!employeeId) {
    return res.json({ scope: { restrictedToEmployeeId: null, mine: true }, rows: [], summary: emptySummary(), unknownDueToNoLineLink: 0 });
  }
  const result = await listTimesheetSubmissions({ ...filtersFrom(req.query), restrictToEmployeeId: employeeId });
  res.json({ scope: { restrictedToEmployeeId: employeeId, mine: true }, ...result });
});

/** ภาพรวมทุกคน — admin/แผนกบัญชีเท่านั้น (role 'user' ไปไม่ถึงโค้ดนี้เลย ถูกกันที่ requireAdmin) */
timesheetSubmissionsRouter.get('/', requireAdmin, async (req, res) => {
  const result = await listTimesheetSubmissions({ ...filtersFrom(req.query), employeeId: str(req.query.employeeId) });
  res.json({ scope: { restrictedToEmployeeId: null, mine: false }, ...result });
});

/** กดยืนยัน/ตีกลับว่ามีปัญหา — admin/แผนกบัญชีเท่านั้น บันทึกว่าใครกดและเมื่อไหร่ */
timesheetSubmissionsRouter.patch('/:employeeId/:period/review', requireAdmin, async (req, res) => {
  try {
    const status = String(req.body?.status ?? '');
    const row = await confirmSubmission({
      employeeId: req.params.employeeId,
      period: req.params.period,
      status: status as 'confirmed' | 'problem',
      note: str(req.body?.note),
      actor: req.user!.nameTh,
    });
    res.json(row);
  } catch (error) {
    if (error instanceof SubmissionReviewError) return res.status(error.status).json({ error: error.message });
    throw error;
  }
});

function emptySummary() {
  return { not_submitted: 0, submitted: 0, pending_review: 0, confirmed: 0, problem: 0 };
}

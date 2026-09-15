import { Router } from 'express';
import { requireAuth } from '../lib/requireAuth.js';
import { requireAdmin } from '../lib/requireRole.js';
import { EmployeeMasterError, addExistingEmployeeToContract, removeAssignment, updateAssignmentRate } from '../lib/employeesMasterService.js';

export const assignmentsRouter = Router();
assignmentsRouter.use(requireAuth);

/** ใหม่ (ไม่มีในต้นฉบับ) — ผูกพนักงานที่มีอยู่แล้วในระบบ (มี employeeId เดิม) เข้ากับสัญญาใหม่/เดิม —
 * ต่างจาก `POST /api/employees` ที่สร้างพนักงาน**ใหม่ทั้งคน**เสมอ ใช้ตอนพนักงานที่เคยถูกเอาออกจาก
 * โครงการ (removeAssignment() ลบ assignment ทิ้งจริง) ต้องกลับเข้าระบบใหม่โดยไม่เสียประวัติเดิม */
assignmentsRouter.post('/', requireAdmin, async (req, res) => {
  try {
    res.json(
      await addExistingEmployeeToContract({
        contractId: req.body?.contractId,
        employeeId: req.body?.employeeId,
        quotationNo: req.body?.quotationNo ?? null,
        monthlyRate: req.body?.monthlyRate,
        startDate: req.body?.startDate,
        endDate: req.body?.endDate ?? null,
        actor: req.user!.nameTh,
      }),
    );
  } catch (error) {
    if (error instanceof EmployeeMasterError) return res.status(error.status).json({ error: error.message });
    throw error;
  }
});

/** ported from server.js `PATCH /api/assignments/:id` — แก้เรทต่อเดือน (+ เลขที่ใบเสนอราคาถ้าระบุ) */
assignmentsRouter.patch('/:id', requireAdmin, async (req, res) => {
  try {
    res.json(await updateAssignmentRate({ assignmentId: req.params.id, monthlyRate: req.body?.monthlyRate, quotationNo: req.body?.quotationNo, actor: req.user!.nameTh }));
  } catch (error) {
    if (error instanceof EmployeeMasterError) return res.status(error.status).json({ error: error.message });
    throw error;
  }
});

/** ported from server.js `DELETE /api/assignments/:id` — นำพนักงานออกจากโครงการนี้เท่านั้น */
assignmentsRouter.delete('/:id', requireAdmin, async (req, res) => {
  try {
    res.json(await removeAssignment(req.params.id, { actor: req.user!.nameTh }));
  } catch (error) {
    if (error instanceof EmployeeMasterError) return res.status(error.status).json({ error: error.message });
    throw error;
  }
});

import { Router } from 'express';
import { requireAuth } from '../lib/requireAuth.js';
import { requireAdmin, requireNotUser } from '../lib/requireRole.js';
import { listEmployeesBasic } from '../lib/masterData.js';
import { requestScope } from '../lib/scopeService.js';
import {
  EmployeeMasterError,
  addEmployeeAlias,
  createEmployee,
  listEmployeesFull,
  removeEmployeeAlias,
  updateEmployee,
} from '../lib/employeesMasterService.js';

export const employeesRouter = Router();
employeesRouter.use(requireAuth);

/** ported from server.js `GET /api/employees` — ต้นฉบับมีเอนด์พอยต์เดียว คืน shape เต็ม
 * (svc.listEmployees({contractId})) เสมอ แต่ในสแต็กใหม่ endpoint นี้ถูกใช้ 2 ที่ที่ต้องการ shape
 * คนละแบบ: `UsersTab.tsx`'s employee picker (หนึ่งแถวต่อพนักงานหนึ่งคน ผ่าน `listEmployeesBasic()`
 * — ค่าเริ่มต้น ไม่ระบุ query ใดๆ) และแท็บ "ข้อมูลหลัก → พนักงาน & ชื่อพ้อง" (หนึ่งแถวต่อหนึ่งอัตราจ้าง
 * ผ่าน `?shape=full`, กรองด้วย `?contractId=` ได้ตรงกับต้นฉบับ) — คนละ query semantics กันจริงๆ (พนักงาน
 * ที่มีหลายอัตราจ้างพร้อมกันจะซ้ำแถวใน shape เต็ม ซึ่งพังตัวเลือก dropdown ของ UsersTab ถ้าใช้ shape
 * เดียวกัน) จึงแยกด้วย query param แทนที่จะเปลี่ยนพฤติกรรม endpoint เดิมไปเลย
 *
 * ⚠️ เดิมไม่มี role check เลย — role 'user' (พนักงาน) ดูรายชื่อ+เรทพนักงานทุกคนในบริษัทได้หมด (เจอจริง
 * 15 ก.ย. 69 ตอนไล่ตรวจ audit ทั้งระบบตามที่ user ชี้แจงเพิ่มเติมว่าพนักงานต้องเห็นแค่ของตัวเองเท่านั้น)
 * ใช้ requireNotUser ไม่ใช่ requireAdmin เพราะหน้า "ภาพรวมทุกบริษัท" ของ role 'executive' ต้องเรียก
 * endpoint นี้ด้วย (ดู companies/ExecOverviewClient.tsx) — บล็อกแค่ 'user' พอ */
employeesRouter.get('/', requireNotUser, async (req, res) => {
  if (req.query.shape === 'full') {
    const contractId = typeof req.query.contractId === 'string' ? req.query.contractId : undefined;
    // `scoped=1` = ใช้ขอบเขตตามตัวกรอง PO บนแถบบน (แท็บ "พนักงาน" ในข้อมูลหลัก) — ไม่ใส่ = ไม่กรอง ตามเดิม เพราะหน้าอื่น (เช่น จัดการระบบ
    // ผูกพนักงานกับบัญชี) ต้องเห็นพนักงานทุกคนข้ามบริษัทโดยเจตนา
    if (!contractId && req.query.scoped === '1') {
      const { contractIds } = await requestScope(req);
      return res.json(await listEmployeesFull({ contractIds }));
    }
    return res.json(await listEmployeesFull({ contractId }));
  }
  res.json(await listEmployeesBasic());
});

/** ported from server.js `POST /api/employees` — เพิ่มพนักงานใหม่ + อัตราจ้างแรก */
employeesRouter.post('/', requireAdmin, async (req, res) => {
  try {
    res.json(await createEmployee({ ...req.body, actor: req.user!.nameTh }));
  } catch (error) {
    if (error instanceof EmployeeMasterError) return res.status(error.status).json({ error: error.message });
    throw error;
  }
});

/** ported from server.js `PATCH /api/employees/:id` */
employeesRouter.patch('/:id', requireAdmin, async (req, res) => {
  try {
    res.json(await updateEmployee({ ...req.body, employeeId: req.params.id, actor: req.user!.nameTh }));
  } catch (error) {
    if (error instanceof EmployeeMasterError) return res.status(error.status).json({ error: error.message });
    throw error;
  }
});

/** ported from server.js `POST /api/employees/:id/aliases` */
employeesRouter.post('/:id/aliases', requireAdmin, async (req, res) => {
  try {
    res.json(await addEmployeeAlias({ employeeId: req.params.id, kind: req.body?.kind, alias: req.body?.alias, actor: req.user!.nameTh }));
  } catch (error) {
    if (error instanceof EmployeeMasterError) return res.status(error.status).json({ error: error.message });
    throw error;
  }
});

/** ported from server.js `DELETE /api/employees/:id/aliases` */
employeesRouter.delete('/:id/aliases', requireAdmin, async (req, res) => {
  try {
    const kind = typeof req.query.kind === 'string' ? req.query.kind : '';
    const alias = typeof req.query.alias === 'string' ? req.query.alias : '';
    res.json(await removeEmployeeAlias({ employeeId: req.params.id, kind, alias, actor: req.user!.nameTh }));
  } catch (error) {
    if (error instanceof EmployeeMasterError) return res.status(error.status).json({ error: error.message });
    throw error;
  }
});

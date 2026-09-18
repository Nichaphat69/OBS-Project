import { Router } from 'express';
import { requireAuth } from '../lib/requireAuth.js';
import { requireAdmin, requireAdminIfSession, requireNotUser, requireExecutiveWhenUnscoped } from '../lib/requireRole.js';
import { requireN8nSecret, requireAuthOrN8nSecret } from '../lib/n8nAuth.js';
import {
  CycleActionError,
  approveCycle,
  contractPeriodEmployees,
  draftEmailWithAi,
  getCycleApproval,
  listBillingCycles,
  readyCycles,
  requestCycleApproval,
} from '../lib/cyclesService.js';
import { InvoiceEmailError, createGmailDraft, cycleDetail } from '../lib/invoiceEmailService.js';

export const cyclesRouter = Router();

// เรียกได้ทั้งจาก n8n (ไม่มี session — shared secret) และ admin ที่ล็อกอินอยู่ (session) — ต้อง mount
// ก่อน .use(requireAuth) ด้านล่าง เหมือน timesheetReminders.ts's /ingest (ดูคอมเมนต์ที่นั่น)
cyclesRouter.get('/ready', requireN8nSecret, async (_req, res) => {
  res.json(await readyCycles());
});

/** ⚠️ `requireAuthOrN8nSecret` ปล่อยผ่านทุก role ที่ล็อกอิน — ต้นฉบับใน server.js ทำ
 * `if (session) requireAdmin(session)` ไว้ด้วย แต่ตกหล่นตอนพอร์ต ทำให้พนักงานทั่วไปสั่งส่งคำขออนุมัติ
 * วางบิลเข้า LINE ของผู้อนุมัติได้ทุกสัญญา/ทุกรอบ (18 ก.ย. 69) — `requireAdminIfSession` เอาพฤติกรรม
 * เดิมกลับมา โดยไม่กระทบเส้น n8n ที่ไม่มี session แต่ผ่าน shared secret มา */
cyclesRouter.post('/:contractId/:period/request-approval', requireAuthOrN8nSecret, requireAdminIfSession, async (req, res) => {
  try {
    const actor = req.user?.nameTh ?? 'n8n';
    const result = await requestCycleApproval(req.params.contractId, req.params.period, { actor });
    res.json(result);
  } catch (error) {
    if (error instanceof CycleActionError) {
      return res.status(error.status).json({ error: error.message, blockers: error.blockers });
    }
    throw error;
  }
});

cyclesRouter.use(requireAuth);

// ⚠️ ทั้ง 4 endpoint ด้านล่างเดิมไม่มี role check เลย — role 'user' ดูสรุปรอบบิล/ยอดเงิน/สถานะอนุมัติ
// ของทุกบริษัทได้หมด (เจอจริง 15 ก.ย. 69 ตามที่ user ชี้แจงเพิ่มเติม) แยกเป็นสองระดับตาม nav จริง:
// `/` กับ `/:contractId/:period/employees` ใช้ requireNotUser เพราะหน้า "ภาพรวมทุกบริษัท" ของ role
// 'executive' ต้องเรียกสองตัวนี้ด้วย (ดู companies/ExecOverviewClient.tsx) — ส่วน `/:contractId/:period`
// (พรีวิวใบแจ้งหนี้เต็มรูปแบบ) กับ `/approval` ใช้ requireAdmin เพราะเป็นรายละเอียดการเงินเต็มของหน้า
// "วางบิล & ร่างอีเมล" ที่ nav จำกัดแค่ admin/accounting เท่านั้น ไม่รวม executive ด้วย
// เพิ่ม requireExecutiveWhenUnscoped (15 ก.ย. 69 รอบสอง) — `/` ไม่ระบุ contractId = ข้อมูลรวมทุกบริษัท
// เดิม admin/accounting เรียกแบบนี้ได้ผ่านหน้า /billing แต่หน้านั้นแก้ให้ส่ง contractId เสมอแล้ว (ฝั่ง
// frontend) เหลือแค่ role 'executive' เท่านั้นที่ควรขอแบบไม่ระบุได้จริงตาม policy ใหม่
cyclesRouter.get('/', requireNotUser, requireExecutiveWhenUnscoped, async (req, res) => {
  const contractId = typeof req.query.contractId === 'string' ? req.query.contractId : undefined;
  res.json(await listBillingCycles(contractId));
});

/* ใช้ cycleDetail() ไม่ใช่ previewCycleInvoice() ตรงๆ เพราะต้องแวะเช็คกล่อง Gmail ก่อนว่าร่างถูกกดส่ง
   ไปแล้วหรือยัง — ตรงกับต้นฉบับ (server.js บรรทัด 579) หน้าเว็บจึงขึ้น "ส่งเมลแล้ว" ให้เองโดยไม่ต้อง
   มีคนมากดบอก Gmail ล่มไม่ทำให้เปิดหน้าไม่ได้ เพราะ syncEmailSent() จับ error ไว้เองแล้วคืน false */
cyclesRouter.get('/:contractId/:period', requireAdmin, async (req, res) => {
  try {
    res.json(await cycleDetail(req.params.contractId, req.params.period));
  } catch (error: any) {
    res.status(error.status ?? 500).json({ error: error.message });
  }
});

cyclesRouter.get('/:contractId/:period/employees', requireNotUser, async (req, res) => {
  res.json(await contractPeriodEmployees(req.params.contractId, req.params.period));
});

/** ใหม่ (ไม่มีในต้นฉบับ) — หน้ารายละเอียดรอบบิลต้องโชว์สถานะประตูอนุมัติผ่าน LINE ด้วย
 * (`getCycleApproval()` มีอยู่แล้วแต่ยังไม่เคย expose เป็น route มาก่อน — Phase 5.6) คืน null ถ้ายังไม่
 * เคยขออนุมัติ */
cyclesRouter.get('/:contractId/:period/approval', requireAdmin, async (req, res) => {
  res.json(await getCycleApproval(req.params.contractId, req.params.period));
});

// ⚠️ เดิมไม่มี role check เลย (มีแค่ requireAuth ของ router) — user role ธรรมดากดอนุมัติวางบิลได้เอง
// สร้างเอกสารจริงใน FlowAccount ได้โดยไม่ต้องเป็น admin/บัญชี (เจอจริง 15 ก.ย. 69 ตอนไล่ตรวจ audit
// ทั้งระบบ) endpoint แก้ข้อมูลการเงิน/สัญญาอื่นทุกตัวมี requireAdmin ครบอยู่แล้ว ตัวนี้หลุดจุดเดียว
cyclesRouter.post('/:contractId/:period/approve', requireAdmin, async (req, res) => {
  try {
    const result = await approveCycle(req.params.contractId, req.params.period, { actor: req.user!.nameTh });
    res.json(result);
  } catch (error) {
    if (error instanceof CycleActionError) {
      return res.status(error.status).json({ error: error.message, blockers: error.blockers });
    }
    const message = error instanceof Error ? error.message : 'สร้างเอกสารใน FlowAccount ไม่สำเร็จ';
    res.status(502).json({ error: message });
  }
});

/** ขั้นที่ 4 — ให้ AI เรียบเรียงอีเมลจากตัวเลขที่คำนวณไว้ (ยังไม่ส่ง) — ported from server.js's
 * POST /api/cycles/:id/:period/email-draft */
cyclesRouter.post('/:contractId/:period/email-draft', requireAdmin, async (req, res) => {
  try {
    const result = await draftEmailWithAi(req.params.contractId, req.params.period, { actor: req.user!.nameTh });
    res.json(result);
  } catch (error) {
    if (error instanceof CycleActionError) {
      return res.status(error.status).json({ error: error.message, blockers: error.blockers });
    }
    const message = error instanceof Error ? error.message : 'ให้ AI เรียบเรียงอีเมลไม่สำเร็จ';
    res.status(502).json({ error: message });
  }
});

/** ขั้นสุดท้ายของรอบบิล — วาง **ร่าง** อีเมลพร้อมไฟล์แนบไว้ในกล่อง Drafts ให้คนไปกดส่งเอง
 * ported from server.js's POST /api/cycles/:id/:period/gmail-draft
 *
 * ⚠️ ปลายทางคือ "ร่าง" เท่านั้น ไม่ใช่การส่งจริง — ห้ามเปลี่ยนเส้นนี้ไปเรียก GmailClient.sendMessage()
 *    โดยไม่ถามเจ้าของระบบก่อน (มีเทสดักไว้ทั้งชั้น client และชั้น service) */
cyclesRouter.post('/:contractId/:period/gmail-draft', requireAdmin, async (req, res) => {
  try {
    const result = await createGmailDraft(req.params.contractId, req.params.period, { actor: req.user!.nameTh });
    res.json(result);
  } catch (error) {
    if (error instanceof InvoiceEmailError) {
      return res.status(error.status).json({ error: error.message });
    }
    const message = error instanceof Error ? error.message : 'สร้างร่างอีเมลใน Gmail ไม่สำเร็จ';
    res.status(502).json({ error: message });
  }
});

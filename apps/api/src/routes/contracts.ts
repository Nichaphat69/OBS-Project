import { Router } from 'express';
import { requireAuth } from '../lib/requireAuth.js';
import { requireAdmin, requireNotUser } from '../lib/requireRole.js';
import { listFilterOptions, requestScope } from '../lib/scopeService.js';
import { listContracts, getActiveContract, setActiveContract, deactivateContract, ContractActionError } from '../lib/dashboardService.js';
import {
  ContractMasterError,
  createContract,
  deleteContract,
  updateContract,
  updateContractWhtRate,
  syncAssignmentsFromFlowAccount,
} from '../lib/contractsMasterService.js';

export const contractsRouter = Router();
contractsRouter.use(requireAuth);

/** ก่อนหน้านี้ไม่มี role check เลย (role "user" เรียกดูสัญญา/ลูกค้าทุกบริษัทได้หมด) — แก้ให้กันเฉพาะ
 * "user" ออก (15 ก.ย. 69 ตาม audit ที่ user ขอ) admin/accounting ยังใช้ list นี้จริงสำหรับ dropdown
 * สลับบริษัท + ตาราง Master Data ที่ต้องเห็นทุกบริษัทอยู่แล้ว (ของเดิม ไม่ใช่การเพิ่มสิทธิ์ใหม่) */
contractsRouter.get('/', requireNotUser, async (req, res) => {
  const all = await listContracts();
  // `scoped=1` = ตามตัวกรอง PO บนแถบบน (แท็บ "สัญญาบริษัท" ในข้อมูลหลัก) — ไม่ใส่ = รายการเต็มเหมือนเดิม (หน้าอื่นต้องเห็นทุกสัญญา)
  if (req.query.scoped === '1') {
    const { contractIds } = await requestScope(req);
    return res.json(contractIds ? all.filter((c) => contractIds.includes(c.id)) : all);
  }
  res.json(all);
});

/**
 * สัญญาที่กำลังดำเนินการอยู่ตอนนี้ — แถบบนใช้ตั้งค่าเริ่มต้นของตัวเลือกบริษัทตอนเปิดหน้าเว็บ
 *
 * เส้นนี้**ตกหล่นตอนปิดสิทธิ์ role "user" เมื่อ 15 ก.ย. 69** — ตัว `GET /` บรรทัดบนถูกปิดไปแล้ว
 * แต่ตัวนี้ไม่ได้ปิดตาม ทั้งที่คืน ContractSummary เต็มใบ (เลขผู้เสียภาษี ผู้ติดต่อ เรท VAT/หัก ณ ที่จ่าย
 * และ `monthlyTotal` = มูลค่าสัญญาต่อเดือน) ซึ่งพนักงานไม่ควรเห็น
 *
 * ปิดได้ปลอดภัยแล้ว (18 ก.ย. 69) — ไล่ผู้เรียกครบทั้ง 5 จุด (dashboard, master, billing, manday,
 * upload/GmailTab) เป็นหน้าของ admin/บัญชีล้วน ส่วน GmailTab ไม่ถูก render ให้ role "user" อีกแล้ว
 * ตั้งแต่หน้าอัปโหลดแยกโหมดพนักงานออกมา (ดู UploadClient.tsx) และแถบบนของ role "user" ก็ไม่มี
 * ตัวเลือกบริษัทให้เลือกอยู่แล้ว
 */
/** ตัวเลือกของตัวกรอง site · PO · พนักงาน บนแถบบน (ทุกสัญญาพร้อมรายชื่อพนักงาน) — ต้องมาก่อน `/:id/...` เส้นอื่น
 * และเปิดให้ executive ด้วย เพราะ executive ก็ใช้ตัวกรองนี้แยกดูตามบริษัท/PO (ไม่มีข้อมูลการเงินในก้อนนี้) */
contractsRouter.get('/filter-options', requireNotUser, async (_req, res) => {
  res.json(await listFilterOptions());
});

contractsRouter.get('/active', requireNotUser, async (_req, res) => {
  res.json(await getActiveContract());
});

/** สลับบริษัทที่กำลังดำเนินการอยู่ — กระทบทั้งระบบ จึงจำกัดเฉพาะ admin/แผนกบัญชี เหมือนต้นฉบับ */
contractsRouter.patch('/:id/active', requireAdmin, async (req, res) => {
  try {
    const contractId = decodeURIComponent(req.params.id);
    const actor = req.user!.nameTh;
    const result = req.body?.active === false
      ? await deactivateContract(contractId, { actor })
      : await setActiveContract(contractId, { actor });
    res.json(result);
  } catch (error) {
    if (error instanceof ContractActionError) return res.status(error.status).json({ error: error.message });
    throw error;
  }
});

/** ported from server.js `POST /api/contracts` */
contractsRouter.post('/', requireAdmin, async (req, res) => {
  try {
    res.json(await createContract({ ...req.body, actor: req.user!.nameTh }));
  } catch (error) {
    if (error instanceof ContractMasterError) return res.status(error.status).json({ error: error.message });
    throw error;
  }
});

/** ported from server.js `PATCH /api/contracts/:id` — แก้ทั้งข้อมูลลูกค้า+สัญญาในคราวเดียว */
contractsRouter.patch('/:id', requireAdmin, async (req, res) => {
  try {
    res.json(await updateContract({ ...req.body, contractId: req.params.id, actor: req.user!.nameTh }));
  } catch (error) {
    if (error instanceof ContractMasterError) return res.status(error.status).json({ error: error.message });
    throw error;
  }
});

/** ported from server.js `DELETE /api/contracts/:id` — ปฏิเสธถ้าเคยออกใบแจ้งหนี้ไปแล้วแม้แต่ใบเดียว */
contractsRouter.delete('/:id', requireAdmin, async (req, res) => {
  try {
    res.json(await deleteContract(req.params.id, { actor: req.user!.nameTh }));
  } catch (error) {
    if (error instanceof ContractMasterError) return res.status(error.status).json({ error: error.message });
    throw error;
  }
});

/** ใหม่ (ไม่มีในต้นฉบับ) — ทางเดียวที่ทำให้จำนวน/เรทพนักงานของสัญญาที่ผูก FlowAccount แล้วเปลี่ยนได้
 * (ดู assertAssignmentsNotFlowAccountLocked ใน employeesMasterService.ts) ดึงใบเสนอราคาล่าสุดจาก
 * FlowAccount มาเทียบ/อัปเดต/ปิดสถานะพนักงานที่หายไปให้ตรงกันเสมอ */
contractsRouter.post('/:id/sync-flowaccount', requireAdmin, async (req, res) => {
  try {
    res.json(await syncAssignmentsFromFlowAccount(req.params.id, { actor: req.user!.nameTh }));
  } catch (error) {
    if (error instanceof ContractMasterError) return res.status(error.status).json({ error: error.message });
    throw error;
  }
});

/** ported from server.js `PATCH /api/contracts/:id/wht-rate` — ใช้จากหน้าตรวจ Timesheet (ตัวเลือก
 * ประเภทหัก ณ ที่จ่าย) ไม่ใช่จากแท็บ "ข้อมูลหลัก" โดยตรง แต่พอร์ตไว้ในคลัสเตอร์เดียวกันเพื่อความครบถ้วน */
contractsRouter.patch('/:id/wht-rate', requireAdmin, async (req, res) => {
  try {
    res.json(await updateContractWhtRate(req.params.id, req.body?.whtRate, { actor: req.user!.nameTh }));
  } catch (error) {
    if (error instanceof ContractMasterError) return res.status(error.status).json({ error: error.message });
    throw error;
  }
});

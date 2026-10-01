import { Router } from 'express';
import { prisma } from '@obs/db';
import { requireAuth } from '../lib/requireAuth.js';
import { requireAdmin } from '../lib/requireRole.js';
import {
  getTimesheet,
  listTimesheets,
  markTimesheetChecked,
  recomputeTimesheet,
  rejectTimesheet,
  estimateTimesheetAmount,
  TimesheetActionError,
} from '../lib/timesheetsService.js';
import { enterTimesheetManually, IngestError } from '../lib/ingestService.js';
import { ManualSheetError } from '@obs/domain';
import { readTimesheetFile, confirmTimesheet, logAiRead, UploadError } from '../lib/uploadService.js';
import { ExtractionError } from '../lib/extractionService.js';
import { AbbyyError } from '../lib/abbyyClient.js';
import { requestScope } from '../lib/scopeService.js';
import { SpreadsheetExtractionError } from '../lib/spreadsheetExtractionService.js';
import { checkTimesheetAgainstHrdd, HrddCompareError } from '../lib/hrddCompareService.js';
import { enqueueFiles, enqueueExisting, ReadQueueError } from '../lib/readQueueService.js';
import { loadFile } from '../lib/fileStorage.js';

export const timesheetsRouter = Router();

timesheetsRouter.use(requireAuth);

// ⚠️ เดิม 4 endpoint ด้านล่าง (list/detail/file/hrdd-compare) ไม่มี role check เลย — role 'user'
// (พนักงาน) เรียกดู Manday/เรท/ไฟล์ต้นฉบับของพนักงานคนอื่นได้หมด (เจอจริง 15 ก.ย. 69 ตามที่ user
// ชี้แจงเพิ่มเติมว่าพนักงานต้องเห็นแค่ของตัวเองผ่านหน้า "ความคืบหน้าของฉัน" เท่านั้น) ใช้ requireAdmin
// (admin/accounting เท่านั้น ไม่รวม executive) ตรงกับหน้า "ตรวจ Manday" ใน nav ที่จำกัด role เท่านี้แล้ว
/**
 * ⚠️ ไม่ส่ง contractId มา = ใช้สัญญาที่กำลังดำเนินการอยู่ (ตัวสลับบริษัทบนแถบบน) ไม่ใช่ "เอาทุกบริษัท"
 *
 * เดิมไม่ส่งมาแล้วคืนของทุกบริษัท — หน้า "ตรวจ Manday" ดึงสัญญาที่ active มาเองก่อนแล้วค่อยส่งมาเป็น
 * query ถ้าขั้นนั้นพลาด (เรียกไม่สำเร็จ / ยังไม่ได้ตั้ง active / หน้าไม่ได้โหลดใหม่ตอนสลับบริษัท)
 * query จะว่าง แล้วหน้าจอจะโชว์พนักงานข้ามบริษัทเงียบๆ โดยไม่มีอะไรบอก — **พลาดแล้วขอบเขตกว้างขึ้น
 * ไม่ใช่แคบลง** ซึ่งเป็นทิศที่ผิดสำหรับข้อมูลค่าจ้างรายคน (เจอจริง 17 ก.ย. 69: เลือก ปตท. อยู่
 * แต่รายการขึ้นพนักงานของไทยประกันชีวิตมาด้วย)
 *
 * ตั้งค่าเริ่มต้นที่ฝั่งเซิร์ฟเวอร์แทน เพื่อให้ client ที่ลืมส่ง/ส่งไม่ทันไม่ทำให้ขอบเขตกว้างขึ้นเอง
 * ต้องการดูข้ามบริษัทจริงๆ ให้ส่ง `?all=1` มาอย่างชัดเจน — ตั้งใจให้เป็นการกระทำที่ต้องเขียนออกมา
 */
timesheetsRouter.get('/', requireAdmin, async (req, res) => {
  // ขอบเขตมาจากตัวกรอง site/PO/พนักงานบนแถบบน (query หรือ cookie obs_scope — ดู scopeService.ts) ไม่ระบุอะไร
  // เลย = สัญญาที่กำลังดำเนินการอยู่ ส่วน `?all=1` ยังต้องเขียนออกมาชัดเจนเหมือนเดิม
  const { filters, contractIds } = await requestScope(req, { allowAll: true });
  const result = await listTimesheets({ contractIds, employeeId: filters.employeeId });
  res.json({
    ...result,
    scope: {
      contractId: contractIds && contractIds.length === 1 ? contractIds[0] : null,
      contractIds,
      allCompanies: contractIds === null,
    },
  });
});

timesheetsRouter.get('/:id', requireAdmin, async (req, res) => {
  const sheet = await getTimesheet(req.params.id);
  if (!sheet) return res.status(404).json({ error: `ไม่พบ Timesheet ${req.params.id}` });
  res.json(sheet);
});

// ⚠️ เดิมไม่มี role check เลย (มีแค่ requireAuth ของ router) — user role ธรรมดาตีกลับ Timesheet ของ
// พนักงานคนไหนก็ได้ (เจอจริง 15 ก.ย. 69 ตอนไล่ตรวจ audit ทั้งระบบ) ต้องเป็นขั้นตอนตรวจของฝ่ายบัญชี/admin
// เท่านั้น ตรงกับที่ endpoint แก้ข้อมูลการเงิน/สัญญาอื่นทุกตัวใช้ requireAdmin อยู่แล้ว
timesheetsRouter.post('/:id/reject', requireAdmin, async (req, res) => {
  try {
    const sheet = await rejectTimesheet(req.params.id, {
      actor: req.user!.nameTh,
      reason: typeof req.body?.reason === 'string' ? req.body.reason : undefined,
    });
    res.json(sheet);
  } catch (error) {
    if (error instanceof TimesheetActionError) {
      return res.status(error.status).json({ error: error.message });
    }
    throw error;
  }
});

/** ยอดประมาณก่อนยืนยัน สำหรับการ์ดตรวจสอบหน้าอัปโหลด — ดู estimateTimesheetAmount() ใน timesheetsService.ts
 * ข้อมูลเรท/ยอดเงินเป็นของฝ่ายบัญชี จึง requireAdmin เหมือนเส้นอื่นที่คืนยอดเงิน */
timesheetsRouter.post('/estimate', requireAdmin, async (req, res) => {
  const { contractId, employeeId, period, leaveDays, whtRate } = req.body ?? {};
  if (typeof contractId !== 'string' || typeof employeeId !== 'string' || typeof period !== 'string') {
    return res.status(400).json({ error: 'ต้องระบุ contractId, employeeId, period' });
  }
  const estimate = await estimateTimesheetAmount({
    contractId,
    employeeId,
    period,
    leaveDays: Array.isArray(leaveDays) ? leaveDays : [],
    whtRate: typeof whtRate === 'number' ? whtRate : null,
  });
  if (!estimate) return res.status(404).json({ error: 'ไม่พบพนักงานคนนี้ในสัญญานี้ หรือรอบบิลไม่ถูกต้อง' });
  res.json(estimate);
});

timesheetsRouter.post('/read', async (req, res) => {
  try {
    const body = req.body ?? {};
    const result = await readTimesheetFile({
      fileBase64: body.fileBase64,
      fileName: body.fileName ?? null,
      expectedPeriod: body.expectedPeriod,
      contractId: body.contractId ?? null,
      // เลือกเครื่องอ่านเฉพาะครั้งนี้ (ไว้ลองเทียบ ABBYY กับ Clear Read) — ไม่ส่งมา = ใช้ตัวที่เปิดอยู่ทั้งระบบ
      // ส่งมาแล้วอ่านด้วยตัวนั้นไม่ได้ จะขึ้น error ไม่แอบสลับไปตัวอื่นให้ ไม่งั้นคนลองจะเข้าใจผิดว่าได้ลองตัวที่เลือก
      readerId: typeof body.readerId === 'string' && body.readerId ? body.readerId : null,
      // เลือก ABBYY Skill เองตอนอัปโหลด — ทับ Skill ที่ผูกกับสัญญาเฉพาะครั้งนี้ ไม่ได้แก้ค่าของสัญญา
      // ต้องเป็น skillId (UUID ของ ABBYY) ไม่ใช่ id ของแถวในตาราง (SKL-xxxx) — คนละค่ากัน
      abbyySkillId: typeof body.abbyySkillId === 'string' && body.abbyySkillId ? body.abbyySkillId : null,
    });
    const documentNo = await logAiRead({
      source: 'upload',
      fileName: result.fileName,
      result,
      actor: req.user!.nameTh,
    });
    // rawResponse เก็บลง DB ผ่าน logAiRead() ด้านบนไปแล้ว (เพื่อ debug ย้อนหลัง) — ตัดออกก่อนตอบกลับ
    // client เสมอ ไม่ใช่ข้อมูลที่หน้าเว็บต้องใช้และอาจมีขนาดใหญ่โดยไม่จำเป็น
    const { rawResponse, ...clientResult } = result;
    // sourceAiReadId = แถว ai_reads ต้นทางตอนอ่านไฟล์ที่พนักงานส่งเอง (แท็บ "รอจากพนักงาน") — แค่ส่งผ่าน
    // ไป-กลับให้ client แนบกลับมาตอน /confirm เพื่อปิดแถวต้นทางนั้น ไม่ได้ใช้ในขั้นตอนอ่านนี้เลย
    const sourceAiReadId = typeof body.sourceAiReadId === 'number' ? body.sourceAiReadId : null;
    res.json({ ...clientResult, documentNo, sourceAiReadId });
  } catch (error) {
    if (
      error instanceof UploadError ||
      error instanceof ExtractionError ||
      error instanceof AbbyyError ||
      error instanceof SpreadsheetExtractionError
    ) {
      return res.status((error as any).status ?? 502).json({ error: error.message });
    }
    throw error;
  }
});

/** อ่านหลายไฟล์พร้อมกันแบบเข้าคิว (เจ้าของระบบสั่ง 23 ก.ย. 69) — admin/บัญชีเท่านั้น (เหมือน endpoint
 * list ของหน้าอัปโหลด) ส่ง `files` (ไฟล์ใหม่) หรือ `aiReadIds` (ของที่มีอยู่แล้ว เช่นแท็บ "ส่งผ่านระบบ")
 * มาอย่างใดอย่างหนึ่ง ไม่รอ OCR เสร็จก่อนตอบกลับ — แค่สร้าง/ปรับแถวเป็น 'queued' แล้ว worker
 * (readQueueService.ts's startQueueWorker) จะหยิบไปอ่านเบื้องหลังเอง */
timesheetsRouter.post('/read-queue', requireAdmin, async (req, res) => {
  try {
    const body = req.body ?? {};
    const readerId = typeof body.readerId === 'string' && body.readerId ? body.readerId : null;
    const abbyySkillId = typeof body.abbyySkillId === 'string' && body.abbyySkillId ? body.abbyySkillId : null;

    if (Array.isArray(body.files) && body.files.length > 0) {
      const ids = await enqueueFiles({
        files: body.files.map((f: any) => ({
          fileBase64: String(f?.fileBase64 ?? ''),
          fileName: String(f?.fileName ?? 'ไม่ทราบชื่อไฟล์'),
        })),
        readerId,
        abbyySkillId,
        actor: req.user!.nameTh,
      });
      return res.json({ queued: ids.length, ids });
    }

    if (Array.isArray(body.aiReadIds) && body.aiReadIds.length > 0) {
      const count = await enqueueExisting({ aiReadIds: body.aiReadIds.map(Number), readerId, abbyySkillId });
      return res.json({ queued: count });
    }

    return res.status(400).json({ error: 'ต้องส่ง files หรือ aiReadIds มาอย่างใดอย่างหนึ่ง' });
  } catch (error) {
    if (error instanceof ReadQueueError) return res.status(error.status).json({ error: error.message });
    throw error;
  }
});

timesheetsRouter.post('/confirm', async (req, res) => {
  // role 'user' ที่ยังไม่ได้ผูกกับพนักงานคนไหนเลย (employeeId เป็น null) ต้องถูกกันไว้ตั้งแต่ต้นเลย —
  // ปล่อยผ่านแล้วไปเช็คต่อใน ingestService.ts ด้วย restrictToEmployeeId: null จะเท่ากับ "ไม่ผูกใครเลย"
  // (falsy เฉยๆ) ซึ่งหมายถึง "ไม่จำกัด" ไม่ใช่ "ต้องไม่ตรงกับใครเลย" — ต้องแยกเคสนี้ออกมาก่อน
  if (req.user!.role === 'user' && !req.user!.employeeId) {
    return res.status(403).json({ error: 'บัญชีนี้ยังไม่ได้ผูกกับพนักงานคนไหนเลย — ติดต่อ admin ให้ผูกบัญชีก่อน' });
  }
  try {
    const body = req.body ?? {};
    const result = await confirmTimesheet({
      documentNo: body.documentNo,
      extraction: body.extraction,
      fileName: body.fileName ?? null,
      sourceEmailId: body.sourceEmailId ?? null,
      sourceEmailSubject: body.sourceEmailSubject ?? null,
      approvedBy: body.approvedBy ?? null,
      approvedAt: body.approvedAt ?? null,
      readModel: body.readModel ?? null,
      actor: req.user!.nameTh,
      submissionMethod: req.user!.role === 'user' ? 'self_obs' : (body.submissionMethod ?? 'self_obs'),
      // ⚠️ เดิมไม่มีการผูกเลย — role 'user' ยืนยันชื่อคนอื่นได้ (เจอจริง 15 ก.ย. 69 ตามที่ user ชี้แจง
      // เพิ่มเติม) role อื่น (admin/accounting) ไม่ผูก เพราะต้องยืนยันแทนพนักงานได้ตามงานปกติของฝ่ายบัญชี
      restrictToEmployeeId: req.user!.role === 'user' ? req.user!.employeeId : null,
      // แถว ai_reads ต้นทางตอนหยิบไฟล์จากแท็บ "รอจากพนักงาน" มาอ่าน — ปิดแถวนั้นด้วยถ้ายืนยันสำเร็จจริง
      // (ดูคอมเมนต์เต็มที่ confirmTimesheet())
      sourceAiReadId: typeof body.sourceAiReadId === 'number' ? body.sourceAiReadId : null,
    });
    res.json(result);
  } catch (error) {
    if (error instanceof UploadError || error instanceof IngestError) {
      return res.status(error.status).json({ error: error.message });
    }
    throw error;
  }
});

timesheetsRouter.post('/manual', async (req, res) => {
  // เหตุผลเดียวกับ /confirm ด้านบน
  if (req.user!.role === 'user' && !req.user!.employeeId) {
    return res.status(403).json({ error: 'บัญชีนี้ยังไม่ได้ผูกกับพนักงานคนไหนเลย — ติดต่อ admin ให้ผูกบัญชีก่อน' });
  }
  try {
    const body = req.body ?? {};
    const result = await enterTimesheetManually({
      documentNo: typeof body.documentNo === 'string' && body.documentNo ? body.documentNo : undefined,
      employeeName: body.employeeName,
      position: body.position,
      period: body.period,
      leaveDays: Array.isArray(body.leaveDays) ? body.leaveDays : [],
      // OT กรอกมือได้แล้ว — ก่อนหน้านี้ป้อนมือบันทึก OT ไม่ได้เลย ต้องรอไฟล์ที่อ่านด้วย OCR อย่างเดียว
      otDays: Array.isArray(body.otDays) ? body.otDays : [],
      approvedBy: body.approvedBy ?? req.user!.nameTh,
      approvedAt: body.approvedAt ?? new Date().toISOString().slice(0, 10),
      customerId: body.customerId ?? null,
      actor: req.user!.nameTh,
      submissionMethod: body.submissionMethod ?? 'self_email',
      // ⚠️ เดิมไม่มีการผูกเลย — role 'user' กรอกชื่อคนอื่นเองได้ (เจอจริง 15 ก.ย. 69 ตามที่ user ชี้แจง
      // เพิ่มเติม) role อื่น (admin/accounting) ไม่ผูก เพราะต้องกรอกแทนพนักงานได้ตามงานปกติของฝ่ายบัญชี
      restrictToEmployeeId: req.user!.role === 'user' ? req.user!.employeeId : null,
    });
    res.json(result);
  } catch (error) {
    if (error instanceof ManualSheetError || error instanceof IngestError) {
      return res.status(error.status).json({ error: error.message, errors: (error as ManualSheetError).errors });
    }
    throw error;
  }
});

/** ไฟล์ PDF ต้นฉบับ — ไม่ผ่าน res.json เพราะต้องส่งเป็นไบต์ดิบให้เบราว์เซอร์เปิดดูได้ตรงๆ (ใช้ตอนกดดู
 * ไฟล์แนบจากหน้าตรวจ Manday) — ported from server.js's sendPdf()/GET /api/timesheets/:id/file
 * ชื่อไฟล์ภาษาไทยต้องใช้ filename* ตาม RFC 5987 ไม่งั้นเบราว์เซอร์ได้ชื่อเพี้ยน */
timesheetsRouter.get('/:id/file', requireAdmin, async (req, res) => {
  const row = await prisma.timesheet.findUnique({
    where: { id: req.params.id },
    select: { id: true, sourceFile: true, sourceFileKey: true },
  });
  const bytes = await loadFile(row?.sourceFileKey);
  if (!row || !bytes) {
    return res.status(404).json({ error: `ไม่พบไฟล์ต้นฉบับของ Timesheet ${req.params.id}` });
  }
  const filename = row.sourceFile || `${row.id}.pdf`;
  const download = req.query.dl !== undefined;
  const encoded = encodeURIComponent(filename);
  res.set({
    'Content-Type': 'application/pdf',
    'Content-Length': String(bytes.length),
    'Content-Disposition': `${download ? 'attachment' : 'inline'}; filename*=UTF-8''${encoded}`,
    'Cache-Control': 'no-store',
  });
  res.send(bytes);
});

/** เทียบวันลาที่ Timesheet รายงานกับวันลาที่อนุมัติแล้วจริงใน HRDD — อ่านอย่างเดียว ไม่มีเขียน/แก้/ลบ
 * ฝั่ง HRDD เด็ดขาด (ดูคอมเมนต์ที่ checkTimesheetAgainstHrdd) */
timesheetsRouter.get('/:id/hrdd-compare', requireAdmin, async (req, res) => {
  try {
    res.json(await checkTimesheetAgainstHrdd(req.params.id));
  } catch (error) {
    if (error instanceof HrddCompareError) return res.status(error.status).json({ error: error.message });
    throw error;
  }
});

/**
 * คำนวณ Manday ใหม่จากข้อมูลที่เก็บไว้ — เส้นนี้**ไม่เคยมีอยู่เลย** ทั้งที่หน้าตรวจ Manday มีปุ่ม
 * "คำนวณใหม่" ยิงมาหาตั้งแต่แรก และฟังก์ชัน `recomputeTimesheet()` ก็เขียนรออยู่ครบแล้ว
 *
 * อาการที่เกิดจริง: กดปุ่มแล้วขึ้น "กำลังคำนวณ…" แล้วจบเงียบเหมือนสำเร็จ เพราะฝั่งหน้าเว็บไม่ได้เช็ค
 * `res.ok` ด้วย — คนกดเชื่อว่าคำนวณใหม่แล้วทั้งที่ไม่มีอะไรเกิดขึ้นสักอย่าง (เจอ 18 ก.ย. 69 ตอนไล่บั๊ก
 * ทั้งระบบ ยืนยันด้วย curl ว่าได้ 404 จริง ไม่ใช่ 401 แบบเส้นที่มีอยู่)
 *
 * ใช้ requireAdmin เหมือน /:id/check และ /:id/reject — การคำนวณใหม่ทับค่าที่เคยยืนยันไว้ได้
 * จึงไม่ใช่สิ่งที่พนักงานทั่วไปควรสั่งได้
 */
timesheetsRouter.post('/:id/recompute', requireAdmin, async (req, res) => {
  try {
    const sheet = await recomputeTimesheet(req.params.id, { actor: req.user!.nameTh });
    res.json(sheet);
  } catch (error) {
    if (error instanceof TimesheetActionError) {
      return res.status(error.status).json({ error: error.message, blockers: error.blockers });
    }
    throw error;
  }
});

// ⚠️ เดิมไม่มี role check เลย เหมือนกับ /:id/reject ด้านบน — ตรวจสอบแล้ว 15 ก.ย. 69
timesheetsRouter.post('/:id/check', requireAdmin, async (req, res) => {
  try {
    const sheet = await markTimesheetChecked(req.params.id, { actor: req.user!.nameTh });
    res.json(sheet);
  } catch (error) {
    if (error instanceof TimesheetActionError) {
      return res.status(error.status).json({ error: error.message, blockers: error.blockers });
    }
    throw error;
  }
});

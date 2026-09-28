import { Router } from 'express';
import { prisma } from '@obs/db';
import { requireAuth } from '../lib/requireAuth.js';
import { requireAdmin } from '../lib/requireRole.js';
import { CycleActionError, deleteInvoice, listInvoices } from '../lib/cyclesService.js';
import { getActiveContract } from '../lib/dashboardService.js';
import { loadFile } from '../lib/fileStorage.js';

export const invoicesRouter = Router();

invoicesRouter.use(requireAuth);

// ⚠️ เดิมไม่มี role check เลย — role 'user' เห็นใบแจ้งหนี้ทุกใบของทุกบริษัทได้ (เจอจริง 15 ก.ย. 69 ตอน
// ไล่ตรวจ audit ทั้งระบบ) ตรงกับหน้า "ใบแจ้งหนี้" ใน nav ที่จำกัด admin/accounting เท่านั้นอยู่แล้ว
/**
 * ⚠️ เหตุผลเดียวกับ GET /api/timesheets — ไม่ส่ง contractId มา = ใช้สัญญาที่กำลังดำเนินการอยู่
 * ไม่ใช่ "เอาทุกบริษัท"
 *
 * หน้าเว็บดึงสัญญาที่ active มาแนบเป็น query เอง ถ้าขั้นนั้นพลาด query จะว่าง แล้วรายการจะข้ามบริษัท
 * เงียบๆ — พลาดแล้วขอบเขตกว้างขึ้นไม่ใช่แคบลง ซึ่งผิดทิศสำหรับยอดเงินของลูกค้าแต่ละราย
 * (เจอรูปแบบเดียวกันนี้จริงในหน้าตรวจ Manday เมื่อ 17 ก.ย. 69 — หน้านี้เป็นที่ที่สองที่ยังเหลืออยู่)
 *
 * ต้องการดูข้ามบริษัทจริงๆ ส่ง `?all=1` มาอย่างชัดเจน
 */
invoicesRouter.get('/', requireAdmin, async (req, res) => {
  const explicit = typeof req.query.contractId === 'string' && req.query.contractId ? req.query.contractId : null;
  const wantsAll = req.query.all === '1' || req.query.all === 'true';

  let contractId = explicit ?? undefined;
  if (!explicit && !wantsAll) {
    const active = await getActiveContract();
    contractId = active?.id;
  }

  // คืนรูปเดิมเป๊ะ ไม่ห่อ scope เพิ่มเหมือนฝั่ง timesheets เพราะหน้านี้รับเป็น array ตรงๆ อยู่แล้ว
  // การเปลี่ยนรูป response จะทำให้หน้าเว็บพังทันที ซึ่งไม่ใช่เรื่องที่แก้อยู่
  res.json(await listInvoices(contractId));
});

/** ไฟล์ PDF ของใบแจ้งหนี้ — cache มาจาก FlowAccount shareLink ตอนอนุมัติ (approveCycle) ไม่ผ่าน
 * res.json เพราะต้องส่งเป็นไบต์ดิบให้เบราว์เซอร์เปิดดูได้ตรงๆ — ports จาก timesheets.ts's GET
 * /:id/file's pattern (15 ก.ย. 69 ตามที่ user ขอ ให้แนบไฟล์นี้ในอีเมลวางบิลได้จริง) เอกสารเก่าที่
 * อนุมัติไปแล้วก่อน feature นี้จะไม่มีไฟล์ (documentPdf เป็น null) ต้องลบแล้วอนุมัติใหม่ถึงจะ cache ได้ */
invoicesRouter.get('/:id/file', requireAdmin, async (req, res) => {
  const row = await prisma.invoice.findUnique({
    where: { id: req.params.id },
    select: { id: true, documentNo: true, documentPdf: true, documentPdfKey: true },
  });
  const bytes = row ? await loadFile({ fileKey: row.documentPdfKey, fileBytes: row.documentPdf }) : null;
  if (!row || !bytes) {
    return res.status(404).json({ error: `ไม่พบไฟล์ PDF ของใบแจ้งหนี้ ${req.params.id}` });
  }
  const filename = `${row.documentNo || row.id}.pdf`;
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

/** ลบใบแจ้งหนี้ทิ้ง (ทั้งเอกสารจริงใน FlowAccount และแถวในระบบเรา) — ใช้ตอนวางบิลผิดรอบ/ผิดคน แล้ว
 * ต้องเปิดทางให้ส่ง Timesheet รอบนั้นเข้ามาใหม่ได้ — ported from server.js's DELETE /api/invoices/:id */
invoicesRouter.delete('/:id', requireAdmin, async (req, res) => {
  try {
    const result = await deleteInvoice(req.params.id, { actor: req.user!.nameTh });
    res.json(result);
  } catch (error) {
    if (error instanceof CycleActionError) {
      return res.status(error.status).json({ error: error.message, blockers: error.blockers });
    }
    throw error;
  }
});

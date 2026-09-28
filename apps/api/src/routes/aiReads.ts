import { Router } from 'express';
import { prisma } from '@obs/db';
import { requireAuth } from '../lib/requireAuth.js';
import { listAiReads, getAiRead, dismissAiRead, AiReadError } from '../lib/aiReadsService.js';
import { loadFile } from '../lib/fileStorage.js';

export const aiReadsRouter = Router();

aiReadsRouter.use(requireAuth);

/** เดิมไม่มีการกรองตามคนเลย role "user" เห็นประวัติอ่าน AI ของทุกบริษัทได้ (เจอจริง 15 ก.ย. 69 ตาม
 * audit ที่ user ยืนยัน) — role "user" ไม่มี employeeId ผูกบัญชี (บัญชียังไม่ได้เชื่อมพนักงาน) ให้เห็น
 * รายการว่างไปเลยแทนที่จะ query แบบ employeeId ว่าง (จะไปแมตช์แถวที่ยังจับคู่คนไม่ได้ของทุกบริษัทแทน)
 * role อื่น (admin/accounting/executive) ยังกรองตาม contractId ได้เหมือนเดิมไม่เปลี่ยน */
aiReadsRouter.get('/', async (req, res) => {
  const contractId = typeof req.query.contractId === 'string' ? req.query.contractId : undefined;
  if (req.user!.role === 'user') {
    if (!req.user!.employeeId) return res.json([]);
    return res.json(await listAiReads(undefined, req.user!.employeeId));
  }
  res.json(await listAiReads(contractId));
});

aiReadsRouter.get('/:id', async (req, res) => {
  const row = await getAiRead(Number(req.params.id));
  if (!row) return res.status(404).json({ error: 'ไม่พบรายการนี้ในประวัติ' });
  if (req.user!.role === 'user' && row.employeeId !== req.user!.employeeId) {
    return res.status(403).json({ error: 'ดูประวัติของคนอื่นไม่ได้' });
  }
  res.json(row);
});

const FILE_CONTENT_TYPES: Record<string, string> = {
  pdf: 'application/pdf',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  xls: 'application/vnd.ms-excel',
  csv: 'text/csv',
};

/** ไฟล์ต้นฉบับที่เคยอ่านผ่าน AI (upload/Gmail) — ใช้ตอนกด preview/ดาวน์โหลดจากหน้าประวัติ "ที่มาของ
 * ข้อมูล" (เดิม getAiRead() ตัด fileBytes ออกโดยตั้งใจเพราะหน้ารีวิวไม่ต้องใช้ — ดู aiReadsService.ts)
 * ports จาก timesheets.ts's GET /:id/file's pattern — ต่างกันตรงต้องเดา Content-Type จากนามสกุลไฟล์
 * เอง เพราะที่นี่รับได้ทั้ง PDF/XLSX/CSV ไม่ใช่ PDF เสมอแบบ Timesheet ที่ ingest แล้ว */
aiReadsRouter.get('/:id/file', async (req, res) => {
  const row = await prisma.aiRead.findUnique({
    where: { id: Number(req.params.id) },
    select: { fileName: true, fileBytes: true, fileKey: true, employeeId: true },
  });
  if (!row) {
    return res.status(404).json({ error: `ไม่พบไฟล์ต้นฉบับของรายการนี้` });
  }
  // ตรวจสิทธิ์ก่อนไปหยิบไฟล์จาก storage — ไม่ควรดึงไบต์ของคนอื่นออกมาแล้วค่อยปฏิเสธ
  if (req.user!.role === 'user' && row.employeeId !== req.user!.employeeId) {
    return res.status(403).json({ error: 'ดูไฟล์ของคนอื่นไม่ได้' });
  }
  const bytes = await loadFile(row);
  if (!bytes) {
    return res.status(404).json({ error: `ไม่พบไฟล์ต้นฉบับของรายการนี้` });
  }
  const filename = row.fileName || `ai-read-${req.params.id}`;
  const ext = filename.split('.').pop()?.toLowerCase() ?? '';
  const contentType = FILE_CONTENT_TYPES[ext] ?? 'application/octet-stream';
  const download = req.query.dl !== undefined;
  const encoded = encodeURIComponent(filename);
  res.set({
    'Content-Type': contentType,
    'Content-Length': String(bytes.length),
    'Content-Disposition': `${download ? 'attachment' : 'inline'}; filename*=UTF-8''${encoded}`,
    'Cache-Control': 'no-store',
  });
  res.send(bytes);
});

aiReadsRouter.post('/dismiss', async (req, res) => {
  try {
    const id = Number(req.body?.id);
    if (req.user!.role === 'user') {
      const row = await prisma.aiRead.findUnique({ where: { id }, select: { employeeId: true } });
      if (row && row.employeeId !== req.user!.employeeId) {
        return res.status(403).json({ error: 'ลบประวัติของคนอื่นไม่ได้' });
      }
    }
    await dismissAiRead(id, { actor: req.user!.nameTh });
    res.json({ ok: true });
  } catch (error) {
    if (error instanceof AiReadError) return res.status(error.status).json({ error: error.message });
    throw error;
  }
});

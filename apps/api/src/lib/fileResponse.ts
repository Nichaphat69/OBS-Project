import type { Request, Response } from 'express';

/**
 * ส่งไฟล์ที่เก็บไว้ในระบบกลับให้เบราว์เซอร์ (เปิดดู/ดาวน์โหลด) — ที่เดียวที่ตัดสินชนิดไฟล์จากนามสกุล
 *
 * เดิมแต่ละ route ยัด `application/pdf` ตายตัว (timesheets, invoices) หรือมีตารางชนิดไฟล์ของตัวเอง
 * (aiReads) ทำให้ Timesheet ที่เป็น Excel/ภาพเปิดดูในป๊อปอัปไม่ได้ — ตอนนี้ระบบรับไฟล์หลายชนิดแล้ว
 * (PDF, xlsx/xls, csv, ภาพสแกน) ทุกจุดที่ส่งไฟล์ออกจึงต้องบอกชนิดตามไฟล์จริง
 */
const TYPE_BY_EXT: Record<string, string> = {
  pdf: 'application/pdf',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  xls: 'application/vnd.ms-excel',
  csv: 'text/csv; charset=utf-8',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  tif: 'image/tiff',
  tiff: 'image/tiff',
  webp: 'image/webp',
  gif: 'image/gif',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  txt: 'text/plain; charset=utf-8',
};

export function contentTypeForName(fileName: string | null | undefined, fallback = 'application/octet-stream'): string {
  const ext = (fileName ?? '').toLowerCase().match(/\.([a-z0-9]{1,5})$/)?.[1];
  return (ext && TYPE_BY_EXT[ext]) || fallback;
}

/** `?dl` = ดาวน์โหลด · ไม่มี = เปิดดูในหน้า (inline) — ชื่อไฟล์ไทยต้องใช้ filename* ตาม RFC 5987 */
export function sendStoredFile(req: Request, res: Response, bytes: Buffer, fileName: string, fallbackType?: string): void {
  const download = req.query.dl !== undefined;
  res.set({
    'Content-Type': contentTypeForName(fileName, fallbackType),
    'Content-Length': String(bytes.length),
    'Content-Disposition': `${download ? 'attachment' : 'inline'}; filename*=UTF-8''${encodeURIComponent(fileName)}`,
    'Cache-Control': 'no-store',
  });
  res.send(bytes);
}

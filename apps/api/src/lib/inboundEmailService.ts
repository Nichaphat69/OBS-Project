/**
 * รับไฟล์ Timesheet ที่ n8n ส่งเข้ามา "เก็บไว้เฉยๆ" (30 ก.ย. 69)
 *
 * ทำไมไม่อ่านทันทีเหมือน `/ingest` — การอ่านด้วยโมเดลกินเวลาและทรัพยากร และผลที่ได้ต้องมีคนตรวจก่อน
 * อยู่แล้ว (ขั้น "ตรวจ Manday") จึงให้คนกดอ่านเองในแท็บ "ดึงจาก Gmail" · OBS ไม่แตะกล่องเมลเลย
 * ไฟล์ทุกไฟล์มาจาก n8n เท่านั้น
 */
import { prisma } from '@obs/db';
import { storeFile } from './fileStorage.js';
import { logAudit } from './audit.js';
import { detectFileKind, SUPPORTED_FILES_TEXT } from './fileKind.js';

export class InboundEmailError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

export interface ReceiveEmailInput {
  sourceEmailId?: unknown;
  fileName?: unknown;
  fileBase64?: unknown;
  subject?: unknown;
  from?: unknown;
  bodyText?: unknown;
  receivedAt?: unknown;
}

const str = (v: unknown, max: number): string | null =>
  typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null;

export async function receiveInboundEmail(input: ReceiveEmailInput): Promise<{ id: number; duplicate: boolean }> {
  const sourceEmailId = str(input.sourceEmailId, 200);
  const fileName = str(input.fileName, 300);
  if (!sourceEmailId) throw new InboundEmailError('ต้องระบุ sourceEmailId ของอีเมล');
  if (!fileName) throw new InboundEmailError('ต้องระบุชื่อไฟล์');
  if (typeof input.fileBase64 !== 'string' || !input.fileBase64) throw new InboundEmailError('ต้องแนบไฟล์ (fileBase64)');

  const existing = await prisma.inboundEmail.findUnique({
    where: { sourceEmailId_fileName: { sourceEmailId, fileName } },
    select: { id: true },
  });
  if (existing) return { id: existing.id, duplicate: true };

  const bytes = Buffer.from(input.fileBase64, 'base64');
  // ตรวจชนิดจากเนื้อไฟล์ (ไม่เชื่อนามสกุล) — รับ PDF / Excel / CSV / ภาพสแกน (6 ต.ค. 69 ขยายจากเดิมที่รับเฉพาะ PDF)
  // ชนิดที่อ่านไม่ได้ (Word, ZIP ฯลฯ) ปฏิเสธตรงนี้ กันมากองรอให้คนกดอ่านแล้วพัง
  const detected = bytes.length === 0 ? null : detectFileKind(bytes, fileName);
  if (!detected || detected.kind === 'unknown') {
    throw new InboundEmailError(
      `ไฟล์ ${fileName} ${detected?.label ? `เป็นไฟล์ ${detected.label} ` : ''}อ่านอัตโนมัติไม่ได้ — รับเฉพาะ ${SUPPORTED_FILES_TEXT}`,
      422,
    );
  }

  const fileKey = await storeFile('ai-read', bytes, { fileName, mimeType: detected.mimeType });
  try {
    const row = await prisma.inboundEmail.create({
      data: {
        sourceEmailId,
        fileName,
        fileKey,
        fileSize: bytes.length,
        subject: str(input.subject, 500),
        fromAddress: str(input.from, 300),
        bodyText: str(input.bodyText, 4000),
        receivedAt: str(input.receivedAt, 60),
        createdAt: new Date().toISOString(),
      },
      select: { id: true },
    });
    await logAudit({
      actor: 'n8n',
      action: 'receive_inbound_email',
      entityType: 'inbound_email',
      entityId: String(row.id),
      detail: { sourceEmailId, fileName },
    });
    return { id: row.id, duplicate: false };
  } catch (error: any) {
    // n8n สองรอบส่งไฟล์เดียวกันพร้อมกัน — อีกรอบชนะไปแล้ว ถือว่าซ้ำ ไม่ใช่ความผิดพลาด
    if (error?.code === 'P2002') {
      const again = await prisma.inboundEmail.findUnique({
        where: { sourceEmailId_fileName: { sourceEmailId, fileName } },
        select: { id: true },
      });
      if (again) return { id: again.id, duplicate: true };
    }
    throw error;
  }
}

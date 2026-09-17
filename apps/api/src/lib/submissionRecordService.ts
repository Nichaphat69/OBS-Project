/**
 * บันทึกการตอบกลับของพนักงานจากปุ่มใน LINE ลงตาราง `timesheet_submissions`
 *
 * แยกไฟล์จาก `submissionLogService.ts` (ฝั่งอ่าน) โดยตั้งใจ — คนละคนดูแล และฝั่งอ่านไม่ได้สร้างแถวเอง
 * ถ้าไม่มีแถวก็ยังแสดงผลได้ครบ ฝั่งนี้จึงสร้างแถวเฉพาะตอนมีคนกดจริง ไม่ต้อง pre-create ให้ทุกคนทุกรอบ
 *
 * ⚠️ กติกาสำคัญที่สุดของไฟล์นี้: **การเขียนตารางต้องไม่ทำให้การตอบกลับ LINE ล้มเด็ดขาด**
 * พนักงานกดปุ่มแล้วไม่มีอะไรตอบ คือประสบการณ์ที่แย่กว่า admin เห็นข้อมูลช้าไปหนึ่งรายการมาก — ฟังก์ชัน
 * ที่นี่จึงไม่ throw ออกไปเลยไม่ว่ากรณีใด ล้มเหลวแล้วบันทึกลง audit_log ไว้ตามย้อนหลังแทน
 */
import { prisma } from '@obs/db';
import { logAudit } from './audit.js';

/** ช่องทางการส่งจริงเท่านั้น — การกด "ขอเลื่อน" ไม่ใช่ช่องทาง (ดูคอมเมนต์ที่ model TimesheetSubmission) */
export type SubmissionMethod = 'self_obs' | 'self_email' | 'proxy_email';

export interface RecordSubmissionInput {
  employeeId: string;
  period: string;
  contractId?: string | null;
  /** ระบุเมื่อพนักงานเลือกช่องทางจริง — ไม่ระบุคู่กับ `deferred` */
  method?: SubmissionMethod;
  /** true เมื่อพนักงานกด "ขอเลื่อน" — จะบันทึกเวลาไว้โดยไม่แตะช่องทางที่เคยเลือกไว้ */
  deferred?: boolean;
  lineUserId?: string | null;
  /** พนักงานได้รับข้อความตอบกลับไหม — null = ไม่ได้พยายามตอบ (ไม่มี replyToken) */
  replyOk?: boolean | null;
  replyFailureReason?: string | null;
}

/**
 * บันทึกการตอบกลับหนึ่งครั้ง — หนึ่งคนหนึ่งรอบมีแถวเดียว กดซ้ำคือการอัปเดตแถวเดิม
 *
 * จงใจ **ไม่ล้างค่าที่เคยบันทึกไว้**: การกด "ขอเลื่อน" หลังจากเคยเลือกช่องทางแล้ว จะไม่ลบช่องทางเดิมทิ้ง
 * และการเลือกช่องทางใหม่ก็ไม่ลบประวัติการขอเลื่อน — ทั้งสองอย่างเป็นข้อเท็จจริงที่เกิดขึ้นจริงคนละเวลา
 * ส่วน `reviewStatus` ที่ admin กดไว้ไม่ถูกแตะเลยไม่ว่ากรณีใด (เก็บคนละคอลัมน์ด้วยเหตุผลนี้)
 */
export async function recordSubmissionResponse(input: RecordSubmissionInput): Promise<void> {
  const now = new Date().toISOString();
  const { employeeId, period } = input;

  const changes: Record<string, unknown> = {
    contractId: input.contractId ?? null,
    lineUserId: input.lineUserId ?? null,
    replyOk: input.replyOk ?? null,
    replyFailureReason: input.replyFailureReason ?? null,
    updatedAt: now,
  };
  if (input.method) {
    changes.method = input.method;
    changes.methodChosenAt = now;
  }
  if (input.deferred) changes.deferredAt = now;

  try {
    await prisma.timesheetSubmission.upsert({
      where: { employeeId_period: { employeeId, period } },
      update: changes,
      create: {
        id: `SUB-${employeeId}-${period}`,
        employeeId,
        period,
        createdAt: now,
        ...(changes as { updatedAt: string }),
      },
    });
  } catch (error: any) {
    // กลืนไว้โดยตั้งใจ — ดูเหตุผลที่หัวไฟล์ ข้อมูลยังตามย้อนหลังได้จาก audit_log ที่ handler เขียนคู่กันอยู่
    await logAudit({
      actor: 'system',
      action: 'record_timesheet_submission_failed',
      entityType: 'employee',
      entityId: employeeId,
      detail: { period, method: input.method ?? null, deferred: Boolean(input.deferred), message: error?.message },
    }).catch(() => {});
  }
}

export class SubmissionReviewError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

/**
 * admin/แผนกบัญชีกดยืนยัน หรือตีกลับว่ามีปัญหา — เก็บที่ `reviewStatus` แยกจากสิ่งที่พนักงานกด
 *
 * แยกคอลัมน์กันเพื่อให้ผลการตรวจของ admin **ไม่ถูกทับเมื่อพนักงานกดปุ่มใน LINE ใหม่อีกครั้ง** ซึ่งเกิดขึ้น
 * ได้จริง (กดเลือกช่องทางผิดแล้วกดใหม่) — ถ้าเก็บรวมช่องเดียว การกดของพนักงานจะลบผลการตรวจทิ้งเงียบๆ
 *
 * สร้างแถวให้ถ้ายังไม่มี เพราะ admin ตรวจคนที่ "ยังไม่ส่ง" ได้ (เช่นตีว่ามีปัญหาเพราะติดต่อไม่ได้)
 * ซึ่งเป็นแถวที่ฝั่งอ่าน derive มาจาก assignment ไม่ได้มาจากตารางนี้
 */
export async function confirmSubmission({
  employeeId,
  period,
  status,
  note,
  actor,
}: {
  employeeId: string;
  period: string;
  status: 'confirmed' | 'problem';
  note?: string | null;
  actor: string;
}) {
  if (status !== 'confirmed' && status !== 'problem') {
    throw new SubmissionReviewError('สถานะต้องเป็น confirmed หรือ problem เท่านั้น');
  }
  if (!/^\d{4}-\d{2}$/.test(period)) throw new SubmissionReviewError('รูปแบบรอบเดือนต้องเป็น YYYY-MM');

  const employee = await prisma.employee.findUnique({ where: { id: employeeId }, select: { id: true } });
  if (!employee) throw new SubmissionReviewError(`ไม่พบพนักงาน ${employeeId}`, 404);

  const now = new Date().toISOString();
  const row = await prisma.timesheetSubmission.upsert({
    where: { employeeId_period: { employeeId, period } },
    update: { reviewStatus: status, reviewedBy: actor, reviewedAt: now, note: note ?? null, updatedAt: now },
    create: {
      id: `SUB-${employeeId}-${period}`,
      employeeId,
      period,
      reviewStatus: status,
      reviewedBy: actor,
      reviewedAt: now,
      note: note ?? null,
      createdAt: now,
      updatedAt: now,
    },
  });

  await logAudit({
    actor,
    action: status === 'confirmed' ? 'confirm_timesheet_submission' : 'flag_timesheet_submission',
    entityType: 'employee',
    entityId: employeeId,
    detail: { period, note: note ?? null },
  });

  return row;
}

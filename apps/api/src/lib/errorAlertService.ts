/**
 * แจ้งเตือนผ่าน LINE ทันทีที่ API พังจริง (unhandled error) — เจ้าของระบบสั่ง 24 ก.ย. 69 ("แจ้งเตือนไป
 * ใน LINE หรือส่ง email ในกรณีที่เกิด error แจ้งเตือนมาให้ admin") ใช้กลไกส่งเดียวกับที่ระบบมีอยู่แล้ว
 * (LineClient.pushPlainText) แต่ **ปลายทางแยกจากที่แจ้งฝ่ายบัญชี** — ใช้ lineAdminTargets() ไม่ใช่
 * lineApproverTargets() เพราะ error ระบบเป็นเรื่องของ admin/ทีมดูแลระบบ ไม่ใช่งานอนุมัติของบัญชี
 * (ตั้งค่าแยกได้ผ่าน LINE_ADMIN_TARGET ใน .env — ไม่ตั้งไว้ก็ยังส่งได้ ถอยไปใช้กลุ่มเดียวกับบัญชีชั่วคราว)
 * ปิดเงียบๆ ถ้าไม่มี LINE ตั้งไว้เลย
 *
 * ⚠️ ไม่ทำฝั่งอีเมล: ระบบนี้ตั้งใจไม่มีการ "ส่งอีเมลอัตโนมัติ" เลยสักจุด — อีเมลฝั่งธุรกิจทุกเส้นต้องผ่าน
 * createDraft() เป็นแค่ร่างรอคนตรวจก่อนเสมอ (ดู gmailClient.ts's หัวไฟล์) ยังไม่มี SMTP/ผู้ให้บริการส่ง
 * อีเมลจริงในระบบนี้เลย การเพิ่ม "ส่ง error alert ทางอีเมลอัตโนมัติ" จึงเป็นความสามารถใหม่ทั้งหมด (ต้องมี
 * SMTP credentials ใหม่) ไม่ใช่แค่ต่อของเดิม — ยังไม่ทำในรอบนี้ ให้ LINE เป็นช่องทางหลักไปก่อน
 *
 * กันสแปม: error เดิม (คีย์เดียวกัน = method+path+message) แจ้งซ้ำได้ไม่เกิน 1 ครั้งต่อ ALERT_COOLDOWN_MS
 * — ไม่งั้นถ้าบั๊กเดิมโดนยิงรัวๆ (เช่น cron/webhook เรียกซ้ำ) จะสแปม LINE จนท่วมจริง
 */
import { LineClient, hasLineCredentials } from './lineClient.js';
import { lineAdminTargets } from './notificationRecipientsService.js';

const ALERT_COOLDOWN_MS = 10 * 60_000;
const lastAlertAt = new Map<string, number>();

export async function notifyApiError(error: unknown, context: { method: string; path: string }): Promise<void> {
  if (!hasLineCredentials()) return;

  const message = error instanceof Error ? error.message : String(error);
  const key = `${context.method} ${context.path} :: ${message}`;
  const now = Date.now();
  const last = lastAlertAt.get(key);
  if (last && now - last < ALERT_COOLDOWN_MS) return;
  lastAlertAt.set(key, now);

  try {
    const targets = await lineAdminTargets();
    if (targets.length === 0) return;
    const text = [
      '🔴 OBS API error',
      `${context.method} ${context.path}`,
      message,
      new Date().toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' }),
    ].join('\n');
    await new LineClient().pushPlainText(text, { targets });
  } catch (alertError) {
    // ห้ามให้การแจ้งเตือนพังไปทำให้ error handler เดิมพังตาม — log เฉยๆ พอ
    console.error('[errorAlertService] ส่ง LINE แจ้ง error ไม่สำเร็จ —', alertError);
  }
}

/**
 * ผู้รับแจ้งเตือน — ported from service.js's listNotificationRecipients/
 * addNotificationRecipient/removeNotificationRecipient/listKnownLineUsers.
 *
 * Storage is unchanged from the original: a JSON array under settings key
 * "notification_recipients" (not its own table) — see service.js's own comment on this choice.
 *
 * `listKnownLineUsers()` enriches each userId with a live LINE displayName via
 * LineClient.getProfile() — now that lineClient.ts is ported (see MIGRATION_PLAN.md's LINE
 * account linking / support tickets phase), this fills in for real when LINE credentials exist.
 */
import { prisma } from '@obs/db';
import { getSetting, setSetting } from './dashboardService.js';
import { logAudit } from './audit.js';
import { LineClient, hasLineCredentials } from './lineClient.js';

const NOTIFY_CHANNELS = ['line', 'email'];
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const SETTING_KEY = 'notification_recipients';

export class NotificationRecipientError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

export interface NotificationRecipient {
  id: number;
  channel: 'line' | 'email';
  label: string;
  target: string;
}

export async function listNotificationRecipients(): Promise<NotificationRecipient[]> {
  return getSetting<NotificationRecipient[]>(SETTING_KEY, []);
}

/** ported from service.js lineApproverTargets() — ปลายทาง LINE ทุกคนที่จะได้รับแจ้งเตือน (ขออนุมัติ
 * วางบิล/ตั๋วแจ้งปัญหาใหม่ ฯลฯ) — เรื่องของฝ่ายบัญชี
 *
 * ลำดับการหาปลายทาง (24 ก.ย. 69 ตามที่ขอ "เชื่อมต่อ LINE ครั้งแรกแล้วรู้ว่าเป็น role อะไร"):
 *  1. บัญชี role 'accounting' ที่ผูกไลน์ส่วนตัวไว้แล้ว (User.lineUserId) — วิธีที่ถูกต้อง/แนะนำให้ใช้
 *  2. รายชื่อที่เพิ่มเองในหน้า "ผู้รับแจ้งเตือน" (ของเดิมก่อนมีการผูกอัตโนมัติ — เก็บไว้เผื่อยังมีคนใช้อยู่)
 *  3. LINE_APPROVER_TARGET ใน .env (fallback สุดท้าย กันไม่แจ้งใครเลย) */
export async function lineApproverTargets(): Promise<string[]> {
  const linked = await prisma.user.findMany({ where: { role: 'accounting', lineUserId: { not: null } }, select: { lineUserId: true } });
  if (linked.length) return linked.map((u) => u.lineUserId!);

  const list = (await listNotificationRecipients()).filter((r) => r.channel === 'line').map((r) => r.target);
  if (list.length) return list;
  return process.env.LINE_APPROVER_TARGET ? [process.env.LINE_APPROVER_TARGET] : [];
}

/** ปลายทางแจ้งเตือน "ระบบล่ม/error" โดยเฉพาะ — แยกจาก lineApproverTargets() ด้านบนตั้งใจ (เจ้าของระบบ
 * สั่ง 24 ก.ย. 69 ว่า error ของระบบต้องแจ้ง admin ไม่ใช่ปนไปกับที่แจ้งฝ่ายบัญชีเรื่องขออนุมัติ/ตั๋วแจ้งปัญหา
 * ซึ่งเป็นคนละกลุ่มคนละหน้าที่กัน) ลำดับเดียวกับ lineApproverTargets(): บัญชี role 'admin' ที่ผูกไลน์ไว้
 * แล้วก่อน → LINE_ADMIN_TARGET ใน .env → ถอยไปใช้กลุ่มบัญชีต่อ (ดีกว่าไม่แจ้งใครเลย) */
export async function lineAdminTargets(): Promise<string[]> {
  const linked = await prisma.user.findMany({ where: { role: 'admin', lineUserId: { not: null } }, select: { lineUserId: true } });
  if (linked.length) return linked.map((u) => u.lineUserId!);

  if (process.env.LINE_ADMIN_TARGET) return [process.env.LINE_ADMIN_TARGET];
  return lineApproverTargets();
}

/** ported from service.js notificationEmailTargets() — อีเมลปลายทางทุกคนที่บอกพนักงานให้ส่ง
 * Timesheet ไปเมื่อเลือก "ส่งผ่าน Email" */
export async function notificationEmailTargets(): Promise<string[]> {
  return (await listNotificationRecipients()).filter((r) => r.channel === 'email').map((r) => r.target);
}

export async function addNotificationRecipient({
  channel,
  label,
  target,
  actor,
}: {
  channel: string;
  label?: string;
  target: string;
  actor: string;
}): Promise<NotificationRecipient> {
  if (!NOTIFY_CHANNELS.includes(channel)) throw new NotificationRecipientError('ช่องทางต้องเป็น line หรือ email เท่านั้น');
  const trimmedTarget = (target ?? '').trim();
  if (!trimmedTarget) throw new NotificationRecipientError('ต้องระบุปลายทาง (LINE user ID หรืออีเมล)');
  if (channel === 'email' && !EMAIL_RE.test(trimmedTarget)) throw new NotificationRecipientError('รูปแบบอีเมลไม่ถูกต้อง');

  const list = await listNotificationRecipients();
  const id = list.reduce((max, r) => Math.max(max, r.id), 0) + 1;
  const recipient: NotificationRecipient = {
    id,
    channel: channel as 'line' | 'email',
    label: (label ?? '').trim() || trimmedTarget,
    target: trimmedTarget,
  };
  await setSetting(SETTING_KEY, [...list, recipient]);
  await logAudit({ actor, action: 'add_notification_recipient', entityType: 'notification_recipient', entityId: String(id), detail: recipient });
  return recipient;
}

export async function removeNotificationRecipient(id: number, { actor }: { actor: string }): Promise<NotificationRecipient> {
  const list = await listNotificationRecipients();
  const target = list.find((r) => r.id === Number(id));
  if (!target) throw new NotificationRecipientError('ไม่พบผู้รับแจ้งเตือนนี้', 404);

  await setSetting(SETTING_KEY, list.filter((r) => r.id !== Number(id)));
  await logAudit({ actor, action: 'remove_notification_recipient', entityType: 'notification_recipient', entityId: String(id), detail: target });
  return target;
}

export interface KnownLineUser {
  userId: string;
  lastSeenAt: string | null;
  displayName: string | null;
}

/** ported from service.js listKnownLineUsers() */
export async function listKnownLineUsers(): Promise<KnownLineUser[]> {
  const rows = await prisma.auditLog.groupBy({
    by: ['entityId'],
    where: { entityType: 'line_user', action: 'line_event_seen' },
    _max: { at: true },
  });
  const users = rows
    .filter((r) => r.entityId)
    .map((r) => ({ userId: r.entityId as string, lastSeenAt: r._max.at ?? null, displayName: null as string | null }))
    .sort((a, b) => (b.lastSeenAt ?? '').localeCompare(a.lastSeenAt ?? ''));

  if (!hasLineCredentials()) return users;
  const line = new LineClient();
  return Promise.all(
    users.map(async (u) => {
      const profile = await line.getProfile(u.userId).catch(() => null);
      return { ...u, displayName: profile?.displayName ?? null };
    }),
  );
}

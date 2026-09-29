/**
 * จัดการ "กล่อง Gmail ที่ระบบได้รับอนุญาตให้อ่าน" — จุดเดียวที่รู้ว่าตอนนี้ระบบอ่านกล่องไหนอยู่
 *
 * ก่อนมีไฟล์นี้ คำตอบของคำถาม "ระบบกำลังอ่านกล่องของใคร" คือ "ของคนที่กดยินยอมล่าสุด" ซึ่งไม่มีใคร
 * ตอบได้ และไม่มีที่ไหนบันทึกไว้เลย ใครมีสิทธิ์กดปุ่มก็สลับกล่องได้เงียบๆ แล้วเมล Timesheet จะหายไป
 * โดยไม่มี error สักตัว (29 ก.ย. 69 — ทีมถามเรื่องนี้พอดี)
 *
 * ตอนนี้กล่องที่ใช้ถูกเลือกจากแถวที่ `isActive` ไม่ใช่จากลำดับการกด และฐานข้อมูลบังคับไว้ด้วย unique
 * index ว่ามี active ได้ทีละหนึ่งเท่านั้น
 */
import { prisma } from '@obs/db';
import { decryptSecret, encryptSecret, hasEncryptionKey } from './tokenCrypto.js';
import { logAudit } from './audit.js';

export class GmailConnectionError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.name = 'GmailConnectionError';
    this.status = status;
  }
}

/** รูปที่ส่งให้หน้าเว็บ — **ไม่มี refresh token อยู่ในนี้เด็ดขาด** */
export interface GmailConnectionStatus {
  connected: boolean;
  email: string | null;
  connectedBy: string | null;
  connectedAt: string | null;
  lastOkAt: string | null;
  lastError: string | null;
  lastErrorAt: string | null;
  /** ได้สิทธิ์อ่านเมลมาจริงหรือเปล่า — กดยินยอมผ่านแต่ไม่ได้สิทธิ์นี้ก็อ่านเมลไม่ได้ */
  canReadMail: boolean;
  /** ยังใช้ค่าจาก .env อยู่ (ยังไม่มีใครกดเชื่อมผ่านหน้าเว็บเลย) */
  usingEnvFallback: boolean;
}

const GMAIL_READONLY = 'https://www.googleapis.com/auth/gmail.readonly';
const nowIso = () => new Date().toISOString();

/** แถวที่ระบบใช้อยู่จริง — null ถ้ายังไม่มีใครเชื่อม */
export async function activeConnection() {
  return prisma.gmailConnection.findFirst({ where: { isActive: true } });
}

/**
 * refresh token ที่ควรใช้ตอนนี้ — เอาจากฐานข้อมูลก่อนเสมอ ไม่มีค่อยตกไปใช้ `.env`
 *
 * การตกกลับไปใช้ `.env` ตั้งใจให้มี เพื่อให้เครื่องที่ยังไม่ได้กดเชื่อมผ่านหน้าเว็บ (รวมถึงตอน deploy
 * รอบแรกหลังเพิ่มฟีเจอร์นี้) ทำงานต่อได้เหมือนเดิมทุกประการ ไม่ใช่พังทันทีที่อัปเดต
 */
export async function currentRefreshToken(): Promise<string | undefined> {
  const row = await activeConnection();
  if (row) {
    try {
      return decryptSecret(row.refreshToken);
    } catch (error) {
      // ถอดรหัสไม่ได้ = กุญแจไม่ตรง ต้องให้คนเห็น ไม่ใช่เงียบๆ ตกไปใช้ค่าเก่าใน .env ซึ่งอาจเป็นคนละกล่อง
      throw new GmailConnectionError(
        `อ่านการเชื่อมต่อกล่อง ${row.email} ไม่สำเร็จ — ${(error as Error).message}`,
        500,
      );
    }
  }
  return process.env.GMAIL_REFRESH_TOKEN || undefined;
}

export async function connectionStatus(): Promise<GmailConnectionStatus> {
  const row = await activeConnection();
  if (!row) {
    return {
      connected: Boolean(process.env.GMAIL_REFRESH_TOKEN),
      email: null,
      connectedBy: null,
      connectedAt: null,
      lastOkAt: null,
      lastError: null,
      lastErrorAt: null,
      canReadMail: Boolean(process.env.GMAIL_REFRESH_TOKEN),
      usingEnvFallback: Boolean(process.env.GMAIL_REFRESH_TOKEN),
    };
  }
  return {
    connected: true,
    email: row.email,
    connectedBy: row.connectedBy,
    connectedAt: row.connectedAt,
    lastOkAt: row.lastOkAt,
    lastError: row.lastError,
    lastErrorAt: row.lastErrorAt,
    canReadMail: (row.scopes ?? '').includes(GMAIL_READONLY),
    usingEnvFallback: false,
  };
}

/**
 * บันทึกการเชื่อมต่อใหม่ — กล่องเดิมที่เคยเชื่อมไว้จะถูกปิดใช้งาน (ไม่ลบทิ้ง เก็บประวัติไว้)
 *
 * ปิดของเดิมก่อนแล้วค่อยเปิดอันใหม่ในทรานแซกชันเดียว เพราะฐานข้อมูลบังคับว่ามี active ได้ทีละหนึ่ง
 * ถ้าทำแยกกันจะมีจังหวะที่ชนกันเองแล้วล้ม
 */
export async function saveConnection({
  email,
  refreshToken,
  scopes,
  actor,
}: {
  email: string;
  refreshToken: string;
  scopes: string;
  actor: string;
}): Promise<GmailConnectionStatus> {
  if (!hasEncryptionKey()) {
    throw new GmailConnectionError(
      'ยังไม่ได้ตั้ง TOKEN_ENCRYPTION_KEY บนเครื่องนี้ จึงเก็บสิทธิ์เข้าถึงกล่องเมลอย่างปลอดภัยไม่ได้',
      500,
    );
  }
  const previous = await activeConnection();
  const encrypted = encryptSecret(refreshToken);

  await prisma.$transaction(async (tx) => {
    await tx.gmailConnection.updateMany({ where: { isActive: true }, data: { isActive: false } });
    await tx.gmailConnection.upsert({
      where: { email },
      create: {
        email,
        refreshToken: encrypted,
        scopes,
        isActive: true,
        connectedBy: actor,
        connectedAt: nowIso(),
        lastOkAt: nowIso(),
      },
      update: {
        refreshToken: encrypted,
        scopes,
        isActive: true,
        connectedBy: actor,
        connectedAt: nowIso(),
        lastOkAt: nowIso(),
        lastError: null,
        lastErrorAt: null,
      },
    });
  });

  await logAudit({
    actor,
    action: previous && previous.email !== email ? 'gmail_connection_switched' : 'gmail_connection_saved',
    entityType: 'gmail_connection',
    entityId: email,
    detail: { from: previous?.email ?? null, to: email, canReadMail: scopes.includes(GMAIL_READONLY) },
  });

  return connectionStatus();
}

/** เลิกใช้กล่องที่ผูกอยู่ — เก็บแถวไว้เป็นประวัติ แต่ล้าง token ทิ้งเพื่อไม่ให้เหลือสิทธิ์ค้างในระบบ */
export async function disconnect({ actor }: { actor: string }): Promise<GmailConnectionStatus> {
  const row = await activeConnection();
  if (!row) throw new GmailConnectionError('ยังไม่มีกล่องที่เชื่อมต่ออยู่', 404);

  await prisma.gmailConnection.update({
    where: { id: row.id },
    data: { isActive: false, refreshToken: '', lastError: 'ยกเลิกการเชื่อมต่อโดยผู้ดูแลระบบ', lastErrorAt: nowIso() },
  });
  await logAudit({
    actor,
    action: 'gmail_connection_disconnected',
    entityType: 'gmail_connection',
    entityId: row.email,
    detail: {},
  });
  return connectionStatus();
}

/**
 * บันทึกผลการใช้งานจริงกับ Google — ให้หน้าจอบอกได้ว่า "ยังใช้ได้อยู่" หรือ "หลุดแล้วเพราะอะไร"
 * โดยไม่ต้องรอให้คนไปกดแล้วเจอ error เอง · เงียบเสมอเมื่อบันทึกไม่ได้ เพราะนี่เป็นแค่ข้อมูลประกอบ
 * ไม่ควรทำให้การทำงานหลักล้มตาม
 */
export async function recordUsage(ok: boolean, errorMessage?: string): Promise<void> {
  try {
    const row = await activeConnection();
    if (!row) return;
    await prisma.gmailConnection.update({
      where: { id: row.id },
      data: ok
        ? { lastOkAt: nowIso(), lastError: null, lastErrorAt: null }
        : { lastError: (errorMessage ?? '').slice(0, 500), lastErrorAt: nowIso() },
    });
  } catch {
    /* ไม่สำคัญพอที่จะทำให้งานหลักพัง */
  }
}

/**
 * เข้ารหัสค่าลับที่ต้องเก็บในฐานข้อมูล — ตอนนี้ใช้กับ refresh token ของ Gmail ที่เดียว
 *
 * **กันอะไรได้จริง** — ไฟล์สำรองฐานข้อมูลหลุดออกไปนอกเครื่อง ซึ่งเป็นทางที่ข้อมูลรั่วได้ง่ายที่สุด
 * เพราะ `pg_dump` ออกทุกคืนและกำลังจะถูกย้ายไปเก็บที่อื่น ถ้าไม่เข้ารหัส ใครได้ไฟล์ไปก็สวมสิทธิ์
 * อ่านกล่องเมลได้ทันที
 *
 * **กันไม่ได้** — คนที่เข้าถึงเครื่องได้ เพราะกุญแจอยู่ในไฟล์ `.env` บนเครื่องเดียวกัน ถ้าต้องการกัน
 * ระดับนั้นต้องย้ายกุญแจไปอยู่ที่ KMS/Secrets Manager ซึ่งเกินความจำเป็นของระบบนี้ตอนนี้
 *
 * ใช้ AES-256-GCM เพราะนอกจากปกปิดเนื้อหาแล้วยังตรวจจับการถูกแก้ไขได้ด้วย (ถ้ามีใครไปแก้ค่าในตาราง
 * ตรงๆ การถอดรหัสจะล้มเหลว ไม่ใช่คืนค่าขยะออกมาเงียบๆ)
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12;
const PREFIX = 'v1';

export class TokenCryptoError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TokenCryptoError';
  }
}

/**
 * กุญแจ 32 ไบต์จาก TOKEN_ENCRYPTION_KEY — รับได้ทั้งเลขฐานสิบหก 64 ตัว (จาก `openssl rand -hex 32`)
 * และข้อความยาวๆ ธรรมดา (ย่อยด้วย SHA-256 ให้เอง) เพื่อไม่ให้คนตั้งค่าพลาดเพราะรูปแบบกุญแจ
 */
function keyFromEnv(): Buffer {
  const raw = process.env.TOKEN_ENCRYPTION_KEY;
  if (!raw) {
    throw new TokenCryptoError(
      'ยังไม่ได้ตั้ง TOKEN_ENCRYPTION_KEY — สร้างด้วย `openssl rand -hex 32` แล้วใส่ใน .env ' +
        '(ตั้งครั้งเดียวแล้วห้ามเปลี่ยน ถ้าเปลี่ยนจะถอดรหัสของที่เก็บไว้เดิมไม่ได้)',
    );
  }
  if (/^[0-9a-f]{64}$/i.test(raw)) return Buffer.from(raw, 'hex');
  return createHash('sha256').update(raw, 'utf8').digest();
}

export function hasEncryptionKey(): boolean {
  return Boolean(process.env.TOKEN_ENCRYPTION_KEY);
}

/** คืนสตริงรูป `v1.<iv>.<tag>.<ciphertext>` — ขึ้นต้นด้วยเวอร์ชันเผื่อวันหนึ่งต้องเปลี่ยนวิธีเข้ารหัส */
export function encryptSecret(plain: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, keyFromEnv(), iv);
  const body = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return [PREFIX, iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), body.toString('base64url')].join('.');
}

export function decryptSecret(stored: string): string {
  const parts = String(stored ?? '').split('.');
  if (parts.length !== 4 || parts[0] !== PREFIX) {
    throw new TokenCryptoError('รูปแบบค่าที่เก็บไว้ไม่ถูกต้อง — อาจถูกแก้ไขหรือเก็บมาด้วยวิธีอื่น');
  }
  const [, ivB64, tagB64, bodyB64] = parts;
  const decipher = createDecipheriv(ALGORITHM, keyFromEnv(), Buffer.from(ivB64, 'base64url'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64url'));
  try {
    return Buffer.concat([decipher.update(Buffer.from(bodyB64, 'base64url')), decipher.final()]).toString('utf8');
  } catch {
    // ถอดไม่ผ่าน = กุญแจไม่ใช่ตัวเดิม หรือค่าถูกแก้ ทั้งสองกรณีต้องให้คนเห็น ไม่ใช่กลืนแล้วคืนค่าว่าง
    throw new TokenCryptoError(
      'ถอดรหัสค่าที่เก็บไว้ไม่สำเร็จ — TOKEN_ENCRYPTION_KEY อาจไม่ใช่กุญแจเดิมที่ใช้ตอนเข้ารหัส',
    );
  }
}

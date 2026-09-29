/**
 * การเชื่อมกล่อง Gmail — ตรงนี้คือจุดที่ "สิทธิ์เข้าถึงกล่องเมลของคนจริง" ถูกเก็บและถูกเลือกใช้
 * พลาดแล้วเจ็บสองทาง: อ่านกล่องผิดคนโดยไม่มีใครรู้ หรือระบบดึงเมลไม่ได้ทั้งที่ยังมีสิทธิ์อยู่
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { prisma } from '@obs/db';
import { encryptSecret, decryptSecret, TokenCryptoError } from '../src/lib/tokenCrypto.js';
import {
  saveConnection,
  connectionStatus,
  currentRefreshToken,
  disconnect,
  activeConnection,
} from '../src/lib/gmailConnectionService.js';

const GMAIL_SCOPE = 'openid email https://www.googleapis.com/auth/gmail.readonly';

async function clear() {
  await prisma.gmailConnection.deleteMany({});
}

test('เข้ารหัสแล้วถอดกลับได้ค่าเดิมเป๊ะ', () => {
  const secret = '1//04ทดสอบ-refresh-token_ยาวๆ';
  const stored = encryptSecret(secret);
  assert.notEqual(stored, secret, 'ค่าที่เก็บต้องไม่ใช่ค่าดิบ');
  assert.ok(stored.startsWith('v1.'), 'ต้องมีเวอร์ชันนำหน้า เผื่อวันหนึ่งเปลี่ยนวิธีเข้ารหัส');
  assert.equal(decryptSecret(stored), secret);
});

test('เข้ารหัสค่าเดิมสองครั้งต้องได้ผลไม่ซ้ำกัน', () => {
  assert.notEqual(encryptSecret('abc'), encryptSecret('abc'), 'ถ้าซ้ำแปลว่า iv ไม่ได้สุ่มใหม่');
});

test('ค่าที่ถูกแก้ไขต้องถอดไม่ผ่าน ไม่ใช่คืนค่าขยะเงียบๆ', () => {
  const stored = encryptSecret('ของจริง');
  const parts = stored.split('.');
  parts[3] = Buffer.from('ของปลอม').toString('base64url');
  assert.throws(() => decryptSecret(parts.join('.')), TokenCryptoError);
});

test('กุญแจคนละดอกต้องถอดไม่ผ่าน', () => {
  const stored = encryptSecret('ของจริง');
  const original = process.env.TOKEN_ENCRYPTION_KEY;
  process.env.TOKEN_ENCRYPTION_KEY = 'f'.repeat(64);
  try {
    assert.throws(() => decryptSecret(stored), TokenCryptoError);
  } finally {
    process.env.TOKEN_ENCRYPTION_KEY = original;
  }
});

test('ยังไม่มีใครเชื่อม → ตกไปใช้ค่าใน .env เหมือนเดิม ไม่พัง', async () => {
  await clear();
  const original = process.env.GMAIL_REFRESH_TOKEN;
  process.env.GMAIL_REFRESH_TOKEN = 'token-จาก-env';
  try {
    assert.equal(await currentRefreshToken(), 'token-จาก-env');
    const status = await connectionStatus();
    assert.equal(status.usingEnvFallback, true, 'ต้องบอกหน้าจอได้ว่ายังใช้ค่าจากเซิร์ฟเวอร์อยู่');
    assert.equal(status.email, null, 'ค่าใน .env ไม่รู้ว่าเป็นกล่องของใคร — ห้ามเดา');
  } finally {
    if (original === undefined) delete process.env.GMAIL_REFRESH_TOKEN;
    else process.env.GMAIL_REFRESH_TOKEN = original;
  }
});

test('เชื่อมกล่องแล้วต้องใช้ของในฐานข้อมูลแทน .env', async () => {
  await clear();
  const original = process.env.GMAIL_REFRESH_TOKEN;
  process.env.GMAIL_REFRESH_TOKEN = 'token-เก่าใน-env';
  try {
    await saveConnection({
      email: 'fern@ipassion.co.th',
      refreshToken: 'token-ของกล่องเฟิร์น',
      scopes: GMAIL_SCOPE,
      actor: 'Nichaphat',
    });
    assert.equal(await currentRefreshToken(), 'token-ของกล่องเฟิร์น', 'ฐานข้อมูลต้องชนะ .env เสมอ');

    const status = await connectionStatus();
    assert.equal(status.email, 'fern@ipassion.co.th');
    assert.equal(status.connectedBy, 'Nichaphat', 'ต้องรู้ว่าใครเป็นคนเชื่อม');
    assert.equal(status.canReadMail, true);
    assert.equal(status.usingEnvFallback, false);
  } finally {
    if (original === undefined) delete process.env.GMAIL_REFRESH_TOKEN;
    else process.env.GMAIL_REFRESH_TOKEN = original;
  }
});

test('เชื่อมกล่องใหม่ทับ — กล่องเดิมต้องถูกปิด ไม่ใช่ active สองอัน', async () => {
  await clear();
  await saveConnection({ email: 'fern@ipassion.co.th', refreshToken: 't1', scopes: GMAIL_SCOPE, actor: 'A' });
  await saveConnection({ email: 'supranee@ipassion.co.th', refreshToken: 't2', scopes: GMAIL_SCOPE, actor: 'B' });

  const active = await prisma.gmailConnection.findMany({ where: { isActive: true } });
  assert.equal(active.length, 1, 'มีกล่องที่ใช้งานอยู่ได้ทีละหนึ่งเท่านั้น');
  assert.equal(active[0].email, 'supranee@ipassion.co.th');
  assert.equal(await currentRefreshToken(), 't2');

  const all = await prisma.gmailConnection.findMany({});
  assert.equal(all.length, 2, 'กล่องเดิมต้องถูกเก็บไว้เป็นประวัติ ไม่ใช่ลบทิ้ง');
});

test('เชื่อมกล่องเดิมซ้ำ — อัปเดตแถวเดิม ไม่สร้างซ้ำ และล้าง error เก่าทิ้ง', async () => {
  await clear();
  await saveConnection({ email: 'fern@ipassion.co.th', refreshToken: 't1', scopes: GMAIL_SCOPE, actor: 'A' });
  const row = await activeConnection();
  await prisma.gmailConnection.update({ where: { id: row!.id }, data: { lastError: 'หลุดไปเมื่อวาน' } });

  await saveConnection({ email: 'fern@ipassion.co.th', refreshToken: 't2', scopes: GMAIL_SCOPE, actor: 'B' });
  const all = await prisma.gmailConnection.findMany({});
  assert.equal(all.length, 1);
  assert.equal(all[0].lastError, null, 'ต่อใหม่สำเร็จแล้วต้องไม่ค้างข้อความเดิมบนหน้าจอ');
  assert.equal(await currentRefreshToken(), 't2');
});

test('ยินยอมแล้วแต่ไม่ได้สิทธิ์อ่านเมล ต้องบอกให้รู้', async () => {
  await clear();
  await saveConnection({ email: 'fern@ipassion.co.th', refreshToken: 't1', scopes: 'openid email', actor: 'A' });
  const status = await connectionStatus();
  assert.equal(status.connected, true);
  assert.equal(status.canReadMail, false, 'ต้องแยกออกว่า "เชื่อมแล้ว" กับ "อ่านเมลได้" ไม่ใช่เรื่องเดียวกัน');
});

test('ยกเลิกการเชื่อมต่อ — ต้องไม่เหลือ token ค้างอยู่ในระบบ', async () => {
  await clear();
  const original = process.env.GMAIL_REFRESH_TOKEN;
  delete process.env.GMAIL_REFRESH_TOKEN;
  try {
    await saveConnection({ email: 'fern@ipassion.co.th', refreshToken: 't1', scopes: GMAIL_SCOPE, actor: 'A' });
    await disconnect({ actor: 'A' });

    const status = await connectionStatus();
    assert.equal(status.connected, false);
    assert.equal(await currentRefreshToken(), undefined, 'ยกเลิกแล้วต้องไม่มี token ให้ใช้อีก');
    const row = await prisma.gmailConnection.findFirst({ where: { email: 'fern@ipassion.co.th' } });
    assert.equal(row?.refreshToken, '', 'ต้องล้างค่าทิ้ง ไม่ใช่แค่ปิดใช้งานแล้วเก็บ token ไว้');
  } finally {
    if (original !== undefined) process.env.GMAIL_REFRESH_TOKEN = original;
  }
});

test('token ที่เก็บในฐานข้อมูลต้องไม่ใช่ค่าดิบ', async () => {
  await clear();
  await saveConnection({ email: 'fern@ipassion.co.th', refreshToken: 'ค่าลับจริงๆ', scopes: GMAIL_SCOPE, actor: 'A' });
  const row = await activeConnection();
  assert.ok(row);
  assert.ok(!row!.refreshToken.includes('ค่าลับจริงๆ'), 'ห้ามเก็บ refresh token เป็นข้อความธรรมดา');
  assert.equal(decryptSecret(row!.refreshToken), 'ค่าลับจริงๆ');
});

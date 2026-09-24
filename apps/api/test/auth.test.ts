/**
 * ทดสอบ login/logout — apps/api/src/lib/{auth,usersService}.ts
 *
 * Ported from test/auth.test.js (assertions preserved exactly เว้นที่ระบุไว้) — ต้นฉบับใช้ SQLite
 * ชั่วคราวแยกไฟล์ ที่นี่ใช้ Postgres ตัวเทสต์แล้วล้างตารางก่อนเริ่ม (resetDb) แทน เพราะไฟล์นี้แตะแค่
 * ตาราง users/sessions ที่ fixture ไม่ยุ่งด้วยอยู่แล้ว
 *
 * **สองเทสต์ของต้นฉบับที่ไม่ได้พอร์ต** เพราะสแต็กใหม่ไม่มีฟังก์ชันนั้นโดยตั้งใจ:
 * - `parseCookies` — สแต็กใหม่ใช้ middleware `cookie-parser` แทนการ parse เอง
 * - `hasAnyUser` — ของเดิมมีไว้ให้ CLI `scripts/create-user.js` เช็คตอน bootstrap ผู้ใช้คนแรก
 *   สแต็กใหม่ยังไม่มี bootstrap path นั้น (ดู Phase 5.8 ข้อ 7 ใน MIGRATION_PLAN.md ที่ค้างไว้)
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { prisma } from '@obs/db';

import { resetDb } from './helpers/testDb.js';
import {
  verifyLogin, createSession, resolveSession, destroySession,
  registerUser, requestPasswordReset, verifyResetCode, resetPasswordWithToken,
} from '../src/lib/auth.js';
import { createUser, listUsers, updateUserRole, setUserActive, resetPassword } from '../src/lib/usersService.js';

await resetDb();

test.after(async () => {
  await prisma.$disconnect();
});

test('สร้างผู้ใช้ใหม่สำเร็จ — ไม่ระบุ role เป็น user โดยปริยาย', async () => {
  const user = await createUser({ username: 'nicha', nameTh: 'นิชา', password: 'sup3rsecret', actor: 'ทดสอบ' });
  assert.equal(user.username, 'nicha');
  assert.equal(user.nameTh, 'นิชา');
  assert.equal(user.role, 'user');
});

test('สร้าง admin ได้เมื่อระบุ role ตรงๆ', async () => {
  const user = await createUser({
    username: 'admin@ipassion.co.th', nameTh: 'Admin', password: 'adminpass1', role: 'admin', actor: 'ทดสอบ',
  });
  assert.equal(user.role, 'admin');
});

test('role ที่ไม่รู้จักสร้างไม่ได้', async () => {
  await assert.rejects(
    () => createUser({ username: 'weird', nameTh: 'x', password: 'longenough1', role: 'superuser', actor: 'ทดสอบ' }),
    (error: any) => error.status === 400,
  );
});

test('รหัสผ่านสั้นกว่า 8 ตัว ต้องสร้างไม่ได้', async () => {
  await assert.rejects(
    () => createUser({ username: 'ssomeone', nameTh: 'ใครบางคน', password: 'short', actor: 'ทดสอบ' }),
    (error: any) => error.status === 400,
  );
});

test('ตั้งชื่อ username ซ้ำไม่ได้', async () => {
  await assert.rejects(
    () => createUser({ username: 'nicha', nameTh: 'คนอื่น', password: 'anotherpass1', actor: 'ทดสอบ' }),
    (error: any) => error.status === 409,
  );
});

test('login ด้วยรหัสถูก → ได้ข้อมูลผู้ใช้กลับมารวม role', async () => {
  const user = await verifyLogin('nicha', 'sup3rsecret');
  assert.deepEqual(user, { username: 'nicha', nameTh: 'นิชา', role: 'user', employeeId: null });
});

test('login ด้วยรหัสผิด → null', async () => {
  assert.equal(await verifyLogin('nicha', 'wrongpassword'), null);
});

test('login ด้วย username ที่ไม่มีอยู่ → null (ไม่บอกว่าผิดที่ไหน)', async () => {
  assert.equal(await verifyLogin('ghost', 'anything1'), null);
});

test('login ด้วยชื่อ (nameTh) แทน username ได้ (24 ก.ย. 69 ตามที่ขอ)', async () => {
  const user = await verifyLogin('นิชา', 'sup3rsecret');
  assert.deepEqual(user, { username: 'nicha', nameTh: 'นิชา', role: 'user', employeeId: null });
});

test('login ด้วยชื่อ ตัวพิมพ์เล็ก/ใหญ่ไม่ตรงก็ยังเข้าได้ (case-insensitive)', async () => {
  const user = await verifyLogin('NICHA', 'sup3rsecret');
  assert.equal(user?.username, 'nicha');
});

test('login ด้วยอีเมล (email คนละค่ากับ username) ได้', async () => {
  await prisma.user.update({ where: { username: 'nicha' }, data: { email: 'nicha.test@ipassion.co.th' } });
  const user = await verifyLogin('nicha.test@ipassion.co.th', 'sup3rsecret');
  assert.equal(user?.username, 'nicha');
  await prisma.user.update({ where: { username: 'nicha' }, data: { email: null } });
});

test('login ด้วยชื่อที่ตรงกับหลายคนพอดี → null (กันเข้าบัญชีผิดคนเงียบๆ)', async () => {
  await createUser({ username: 'nicha2', nameTh: 'นิชา', password: 'anotherpass1', actor: 'ทดสอบ' });
  assert.equal(await verifyLogin('นิชา', 'sup3rsecret'), null, 'ชื่อซ้ำกัน 2 คน ต้องปฏิเสธ ไม่ใช่เดาเอาคนแรก');
  await prisma.user.deleteMany({ where: { username: 'nicha2' } });
});

test('สร้าง session แล้ว resolve กลับมาได้ข้อมูลตรงกัน', async () => {
  const { token, expiresAt } = await createSession('nicha');
  assert.ok(token.length > 20);
  assert.ok(new Date(expiresAt).getTime() > Date.now());

  const resolved = await resolveSession(token);
  assert.deepEqual(resolved, { username: 'nicha', nameTh: 'นิชา', role: 'user', employeeId: null });
});

test('resolveSession คืน null เมื่อ token ไม่มีอยู่จริง', async () => {
  assert.equal(await resolveSession('ไม่มีอยู่จริง'), null);
});

test('resolveSession คืน null เมื่อไม่มี token เลย', async () => {
  assert.equal(await resolveSession(null), null);
  assert.equal(await resolveSession(undefined), null);
});

test('destroySession แล้ว resolve ไม่ได้อีก (logout)', async () => {
  const { token } = await createSession('nicha');
  assert.ok(await resolveSession(token));
  await destroySession(token);
  assert.equal(await resolveSession(token), null);
});

test('listUsers คืนทุกคน เรียงตาม username ไม่มีรหัสผ่าน/salt หลุดออกมา', async () => {
  const users = await listUsers();
  assert.ok(users.length >= 2);
  const nicha = users.find((u) => u.username === 'nicha')!;
  // ต้นฉบับคืน key แบบ snake_case ปนกับ camelCase (created_at/name_th/employee_id/self_registered +
  // selfRegistered) — พอร์ตนี้คืน camelCase ล้วนตาม UserRow และเพิ่ม nameEn (Phase 5.4)
  // ใจความที่เทสต์นี้คุมไว้เหมือนเดิมทุกประการ: ต้องไม่มี salt/hash หลุดออกมาเลย
  assert.deepEqual(
    Object.keys(nicha).sort(),
    ['active', 'createdAt', 'email', 'employeeId', 'nameEn', 'nameTh', 'role', 'selfRegistered', 'username'].sort(),
  );
  assert.equal(nicha.active, true);
});

test('updateUserRole เปลี่ยน role ได้ และมีผลกับ login ครั้งต่อไปทันที', async () => {
  // ต้นฉบับคืน `{ username, nameTh, role }` กลับมาแล้วเทสต์เช็ค result.role — พอร์ตนี้ไม่คืนค่าอะไร
  // เลย (route `PATCH /api/users/:username` ตัวเดียวที่เรียก ก็ไม่ได้ใช้ค่าที่คืนมา) ใจความจริงของ
  // เทสต์นี้อยู่ที่บรรทัดถัดไป — role ใหม่ต้องมีผลกับ login ครั้งต่อไปทันที ซึ่งยังตรวจเหมือนเดิม
  await updateUserRole('nicha', 'admin', { actor: 'ทดสอบ' });
  assert.equal((await verifyLogin('nicha', 'sup3rsecret'))!.role, 'admin');
  await updateUserRole('nicha', 'user', { actor: 'ทดสอบ' }); // คืนค่าเดิมกันเทสต์อื่นพัง
});

test('updateUserRole กับ role ที่ไม่รู้จัก → error 400', async () => {
  await assert.rejects(
    () => updateUserRole('nicha', 'superuser', { actor: 'ทดสอบ' }),
    (error: any) => error.status === 400,
  );
});

test('updateUserRole กับ username ที่ไม่มีอยู่ → error 404', async () => {
  await assert.rejects(
    () => updateUserRole('ghost', 'admin', { actor: 'ทดสอบ' }),
    (error: any) => error.status === 404,
  );
});

test('setUserActive(false) ปิดใช้งาน → login ไม่ได้อีก และ session เดิมถูกเลิกด้วย', async () => {
  const { token } = await createSession('nicha');
  assert.ok(await resolveSession(token));

  await setUserActive('nicha', false, { actor: 'ทดสอบ' });

  assert.equal(await verifyLogin('nicha', 'sup3rsecret'), null);
  assert.equal(await resolveSession(token), null);
  assert.equal((await listUsers()).find((u) => u.username === 'nicha')!.active, false);
});

test('setUserActive(true) เปิดใช้งานคืน → login ได้อีกครั้ง', async () => {
  await setUserActive('nicha', true, { actor: 'ทดสอบ' });
  assert.ok(await verifyLogin('nicha', 'sup3rsecret'));
});

test('setUserActive กับ username ที่ไม่มีอยู่ → error 404', async () => {
  await assert.rejects(
    () => setUserActive('ghost', false, { actor: 'ทดสอบ' }),
    (error: any) => error.status === 404,
  );
});

test('resetPassword ตั้งรหัสใหม่ได้ — รหัสเดิม login ไม่ได้อีก และเซสชันเดิมถูกเลิก', async () => {
  const { token } = await createSession('nicha');
  assert.ok(await resolveSession(token));

  await resetPassword('nicha', 'newpassword1', { actor: 'ทดสอบ' });

  assert.equal(await verifyLogin('nicha', 'sup3rsecret'), null, 'รหัสเดิมต้องใช้ไม่ได้อีก');
  assert.equal(await resolveSession(token), null, 'เซสชันเดิมต้องถูกเลิก');
  assert.ok(await verifyLogin('nicha', 'newpassword1'), 'รหัสใหม่ต้อง login ได้');
});

test('resetPassword รหัสสั้นกว่า 8 ตัว → error 400', async () => {
  await assert.rejects(
    () => resetPassword('nicha', 'short', { actor: 'ทดสอบ' }),
    (error: any) => error.status === 400,
  );
});

test('resetPassword กับ username ที่ไม่มีอยู่ → error 404', async () => {
  await assert.rejects(
    () => resetPassword('ghost', 'longenough1', { actor: 'ทดสอบ' }),
    (error: any) => error.status === 404,
  );
});

/* ── ลงทะเบียนเอง (31 ส.ค. 69 ตามที่ขอ) ── */

test('registerUser สร้างบัญชีได้ แต่ active=0 เสมอ — รอ admin เปิดใช้งานก่อน', async () => {
  const result = await registerUser({ email: 'someone@ipassion.co.th', nameTh: 'คนสมัครเอง', password: 'longenough1' });
  assert.equal(result.username, 'someone@ipassion.co.th');
  assert.equal(await verifyLogin('someone@ipassion.co.th', 'longenough1'), null, 'ยัง login ไม่ได้จนกว่า admin จะเปิดใช้งาน');

  const listed = (await listUsers()).find((u) => u.username === 'someone@ipassion.co.th')!;
  assert.equal(listed.active, false);
  assert.equal(listed.selfRegistered, true);
  assert.equal(listed.role, 'user');
});

test('registerUser อีเมลรูปแบบผิด → error 400', async () => {
  await assert.rejects(
    () => registerUser({ email: 'ไม่ใช่อีเมล', nameTh: 'x', password: 'longenough1' }),
    (error: any) => error.status === 400,
  );
});

test('registerUser ซ้ำอีเมลเดิม → error 409', async () => {
  await assert.rejects(
    () => registerUser({ email: 'someone@ipassion.co.th', nameTh: 'อีกคน', password: 'longenough1' }),
    (error: any) => error.status === 409,
  );
});

/* ── ลืมรหัสผ่านทางอีเมล (31 ส.ค. 69 ตามที่ขอ) ── */

test('requestPasswordReset คืน null เงียบๆ ถ้าไม่เจอบัญชี — กัน enumeration', async () => {
  assert.equal(await requestPasswordReset('ghost@ipassion.co.th'), null);
});

test('requestPasswordReset คืน null ถ้าบัญชียังไม่ active (สมัครเองแล้วยังไม่ได้รับอนุมัติ)', async () => {
  assert.equal(await requestPasswordReset('someone@ipassion.co.th'), null);
});

test('ลืมรหัสผ่านครบ 3 ขั้น — ขอรหัส → ยืนยันรหัส → ตั้งรหัสผ่านใหม่ ใช้รหัสใหม่ login ได้จริง', async () => {
  await createUser({ username: 'forgetful@ipassion.co.th', nameTh: 'คนขี้ลืม', password: 'oldpassword1', actor: 'ทดสอบ' });

  const requested = await requestPasswordReset('forgetful@ipassion.co.th');
  assert.ok(requested);
  assert.match(requested.code, /^[0-9]{6}$/);

  await assert.rejects(
    () => verifyResetCode('forgetful@ipassion.co.th', '000000'),
    (error: any) => error.status === 400,
    'รหัสผิดต้อง throw',
  );

  const { resetToken } = await verifyResetCode('forgetful@ipassion.co.th', requested.code);
  assert.ok(resetToken);

  await assert.rejects(
    () => resetPasswordWithToken('forgetful@ipassion.co.th', 'ไม่ใช่token', 'newpassword1'),
    (error: any) => error.status === 400,
    'token ผิดต้อง throw',
  );

  await resetPasswordWithToken('forgetful@ipassion.co.th', resetToken, 'newpassword1');
  assert.equal(await verifyLogin('forgetful@ipassion.co.th', 'oldpassword1'), null, 'รหัสเดิมต้องใช้ไม่ได้อีก');
  assert.ok(await verifyLogin('forgetful@ipassion.co.th', 'newpassword1'), 'รหัสใหม่ต้อง login ได้');

  await assert.rejects(
    () => resetPasswordWithToken('forgetful@ipassion.co.th', resetToken, 'anotherpass1'),
    (error: any) => error.status === 400,
    'resetToken เดิมใช้ซ้ำไม่ได้',
  );
});

test('verifyResetCode กับบัญชีที่ไม่เคยขอรหัสไว้ → error 400', async () => {
  await createUser({ username: 'neverasked@ipassion.co.th', nameTh: 'ไม่เคยขอ', password: 'longenough1', actor: 'ทดสอบ' });
  await assert.rejects(
    () => verifyResetCode('neverasked@ipassion.co.th', '123456'),
    (error: any) => error.status === 400,
  );
});

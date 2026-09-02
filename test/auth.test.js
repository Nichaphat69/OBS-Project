/**
 * ทดสอบ login/logout — src/auth.js
 * ใช้ฐานข้อมูลชั่วคราวแยกจากเทสต์อื่น เพราะแตะตาราง users/sessions ที่ seed.js ไม่ยุ่งด้วย
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync } from 'node:fs';

const DB = join(tmpdir(), `obs-auth-test-${process.pid}.sqlite`);
process.env.DB_PATH = DB;

const auth = await import('../src/auth.js');
const { closeDb } = await import('../src/db/index.js');

test.after(() => {
  closeDb();
  for (const suffix of ['', '-wal', '-shm']) {
    try { rmSync(DB + suffix); } catch { /* ไม่มีไฟล์ก็ข้าม */ }
  }
});

test('ยังไม่มีผู้ใช้เลยตอนฐานข้อมูลใหม่', () => {
  assert.equal(auth.hasAnyUser(), false);
});

test('สร้างผู้ใช้ใหม่สำเร็จ — ไม่ระบุ role เป็น user โดยปริยาย', () => {
  const user = auth.createUser({ username: 'nicha', nameTh: 'นิชา', password: 'sup3rsecret' });
  assert.equal(user.username, 'nicha');
  assert.equal(user.nameTh, 'นิชา');
  assert.equal(user.role, 'user');
  assert.equal(auth.hasAnyUser(), true);
});

test('สร้าง admin ได้เมื่อระบุ role ตรงๆ', () => {
  const user = auth.createUser({
    username: 'admin@ipassion.co.th', nameTh: 'Admin', password: 'adminpass1', role: 'admin',
  });
  assert.equal(user.role, 'admin');
});

test('role ที่ไม่รู้จักสร้างไม่ได้', () => {
  assert.throws(
    () => auth.createUser({ username: 'weird', nameTh: 'x', password: 'longenough1', role: 'superuser' }),
    (error) => error.status === 400,
  );
});

test('รหัสผ่านสั้นกว่า 8 ตัว ต้องสร้างไม่ได้', () => {
  assert.throws(
    () => auth.createUser({ username: 'ssomeone', nameTh: 'ใครบางคน', password: 'short' }),
    (error) => error.status === 400,
  );
});

test('ตั้งชื่อ username ซ้ำไม่ได้', () => {
  assert.throws(
    () => auth.createUser({ username: 'nicha', nameTh: 'คนอื่น', password: 'anotherpass1' }),
    (error) => error.status === 409,
  );
});

test('login ด้วยรหัสถูก → ได้ข้อมูลผู้ใช้กลับมารวม role', () => {
  const user = auth.verifyLogin('nicha', 'sup3rsecret');
  assert.deepEqual(user, { username: 'nicha', nameTh: 'นิชา', role: 'user', employeeId: null });
});

test('login ด้วยรหัสผิด → null', () => {
  assert.equal(auth.verifyLogin('nicha', 'wrongpassword'), null);
});

test('login ด้วย username ที่ไม่มีอยู่ → null (ไม่บอกว่าผิดที่ไหน)', () => {
  assert.equal(auth.verifyLogin('ghost', 'anything1'), null);
});

test('สร้าง session แล้ว resolve กลับมาได้ข้อมูลตรงกัน', () => {
  const { token, expiresAt } = auth.createSession('nicha');
  assert.ok(token.length > 20);
  assert.ok(new Date(expiresAt).getTime() > Date.now());

  const resolved = auth.resolveSession(token);
  assert.deepEqual(resolved, { username: 'nicha', nameTh: 'นิชา', role: 'user', employeeId: null });
});

test('resolveSession คืน null เมื่อ token ไม่มีอยู่จริง', () => {
  assert.equal(auth.resolveSession('ไม่มีอยู่จริง'), null);
});

test('resolveSession คืน null เมื่อไม่มี token เลย', () => {
  assert.equal(auth.resolveSession(null), null);
  assert.equal(auth.resolveSession(undefined), null);
});

test('destroySession แล้ว resolve ไม่ได้อีก (logout)', () => {
  const { token } = auth.createSession('nicha');
  assert.ok(auth.resolveSession(token));
  auth.destroySession(token);
  assert.equal(auth.resolveSession(token), null);
});

test('parseCookies แยกคุกกี้หลายตัวออกจาก header เดียวได้', () => {
  assert.deepEqual(
    auth.parseCookies('obs_session=abc123; other=xyz'),
    { obs_session: 'abc123', other: 'xyz' },
  );
});

test('parseCookies คืน object เปล่าเมื่อไม่มี header', () => {
  assert.deepEqual(auth.parseCookies(undefined), {});
  assert.deepEqual(auth.parseCookies(''), {});
});

test('listUsers คืนทุกคน เรียงตาม username ไม่มีรหัสผ่าน/salt หลุดออกมา', () => {
  const users = auth.listUsers();
  assert.ok(users.length >= 2);
  const nicha = users.find((u) => u.username === 'nicha');
  assert.deepEqual(
    Object.keys(nicha).sort(),
    ['active', 'created_at', 'email', 'employee_id', 'name_th', 'role', 'self_registered', 'selfRegistered', 'username'].sort(),
  );
  assert.equal(nicha.active, true);
});

test('updateUserRole เปลี่ยน role ได้ และมีผลกับ login ครั้งต่อไปทันที', () => {
  const result = auth.updateUserRole('nicha', 'admin', { actor: 'ทดสอบ' });
  assert.equal(result.role, 'admin');
  assert.equal(auth.verifyLogin('nicha', 'sup3rsecret').role, 'admin');
  auth.updateUserRole('nicha', 'user', { actor: 'ทดสอบ' }); // คืนค่าเดิมกันเทสต์อื่นพัง
});

test('updateUserRole กับ role ที่ไม่รู้จัก → error 400', () => {
  assert.throws(
    () => auth.updateUserRole('nicha', 'superuser'),
    (error) => error.status === 400,
  );
});

test('updateUserRole กับ username ที่ไม่มีอยู่ → error 404', () => {
  assert.throws(
    () => auth.updateUserRole('ghost', 'admin'),
    (error) => error.status === 404,
  );
});

test('setUserActive(false) ปิดใช้งาน → login ไม่ได้อีก และ session เดิมถูกเลิกด้วย', () => {
  const { token } = auth.createSession('nicha');
  assert.ok(auth.resolveSession(token));

  auth.setUserActive('nicha', false, { actor: 'ทดสอบ' });

  assert.equal(auth.verifyLogin('nicha', 'sup3rsecret'), null);
  assert.equal(auth.resolveSession(token), null);
  assert.equal(auth.listUsers().find((u) => u.username === 'nicha').active, false);
});

test('setUserActive(true) เปิดใช้งานคืน → login ได้อีกครั้ง', () => {
  auth.setUserActive('nicha', true, { actor: 'ทดสอบ' });
  assert.ok(auth.verifyLogin('nicha', 'sup3rsecret'));
});

test('setUserActive กับ username ที่ไม่มีอยู่ → error 404', () => {
  assert.throws(
    () => auth.setUserActive('ghost', false),
    (error) => error.status === 404,
  );
});

test('resetPassword ตั้งรหัสใหม่ได้ — รหัสเดิม login ไม่ได้อีก และเซสชันเดิมถูกเลิก', () => {
  const { token } = auth.createSession('nicha');
  assert.ok(auth.resolveSession(token));

  auth.resetPassword('nicha', 'newpassword1', { actor: 'ทดสอบ' });

  assert.equal(auth.verifyLogin('nicha', 'sup3rsecret'), null, 'รหัสเดิมต้องใช้ไม่ได้อีก');
  assert.equal(auth.resolveSession(token), null, 'เซสชันเดิมต้องถูกเลิก');
  assert.ok(auth.verifyLogin('nicha', 'newpassword1'), 'รหัสใหม่ต้อง login ได้');
});

test('resetPassword รหัสสั้นกว่า 8 ตัว → error 400', () => {
  assert.throws(
    () => auth.resetPassword('nicha', 'short'),
    (error) => error.status === 400,
  );
});

test('resetPassword กับ username ที่ไม่มีอยู่ → error 404', () => {
  assert.throws(
    () => auth.resetPassword('ghost', 'longenough1'),
    (error) => error.status === 404,
  );
});

/* ── ลงทะเบียนเอง (31 ส.ค. 69 ตามที่ขอ) ── */

test('registerUser สร้างบัญชีได้ แต่ active=0 เสมอ — รอ admin เปิดใช้งานก่อน', () => {
  const result = auth.registerUser({ email: 'someone@ipassion.co.th', nameTh: 'คนสมัครเอง', password: 'longenough1' });
  assert.equal(result.username, 'someone@ipassion.co.th');
  assert.equal(auth.verifyLogin('someone@ipassion.co.th', 'longenough1'), null, 'ยัง login ไม่ได้จนกว่า admin จะเปิดใช้งาน');

  const listed = auth.listUsers().find((u) => u.username === 'someone@ipassion.co.th');
  assert.equal(listed.active, false);
  assert.equal(listed.selfRegistered, true);
  assert.equal(listed.role, 'user');
});

test('registerUser อีเมลรูปแบบผิด → error 400', () => {
  assert.throws(
    () => auth.registerUser({ email: 'ไม่ใช่อีเมล', nameTh: 'x', password: 'longenough1' }),
    (error) => error.status === 400,
  );
});

test('registerUser ซ้ำอีเมลเดิม → error 409', () => {
  assert.throws(
    () => auth.registerUser({ email: 'someone@ipassion.co.th', nameTh: 'อีกคน', password: 'longenough1' }),
    (error) => error.status === 409,
  );
});

/* ── ลืมรหัสผ่านทางอีเมล (31 ส.ค. 69 ตามที่ขอ) ── */

test('requestPasswordReset คืน null เงียบๆ ถ้าไม่เจอบัญชี — กัน enumeration', () => {
  assert.equal(auth.requestPasswordReset('ghost@ipassion.co.th'), null);
});

test('requestPasswordReset คืน null ถ้าบัญชียังไม่ active (สมัครเองแล้วยังไม่ได้รับอนุมัติ)', () => {
  assert.equal(auth.requestPasswordReset('someone@ipassion.co.th'), null);
});

test('ลืมรหัสผ่านครบ 3 ขั้น — ขอรหัส → ยืนยันรหัส → ตั้งรหัสผ่านใหม่ ใช้รหัสใหม่ login ได้จริง', () => {
  auth.createUser({ username: 'forgetful@ipassion.co.th', nameTh: 'คนขี้ลืม', password: 'oldpassword1' });

  const requested = auth.requestPasswordReset('forgetful@ipassion.co.th');
  assert.ok(requested);
  assert.match(requested.code, /^[0-9]{6}$/);

  assert.throws(
    () => auth.verifyResetCode('forgetful@ipassion.co.th', '000000'),
    (error) => error.status === 400,
    'รหัสผิดต้อง throw',
  );

  const { resetToken } = auth.verifyResetCode('forgetful@ipassion.co.th', requested.code);
  assert.ok(resetToken);

  assert.throws(
    () => auth.resetPasswordWithToken('forgetful@ipassion.co.th', 'ไม่ใช่token', 'newpassword1'),
    (error) => error.status === 400,
    'token ผิดต้อง throw',
  );

  auth.resetPasswordWithToken('forgetful@ipassion.co.th', resetToken, 'newpassword1');
  assert.equal(auth.verifyLogin('forgetful@ipassion.co.th', 'oldpassword1'), null, 'รหัสเดิมต้องใช้ไม่ได้อีก');
  assert.ok(auth.verifyLogin('forgetful@ipassion.co.th', 'newpassword1'), 'รหัสใหม่ต้อง login ได้');

  assert.throws(
    () => auth.resetPasswordWithToken('forgetful@ipassion.co.th', resetToken, 'anotherpass1'),
    (error) => error.status === 400,
    'resetToken เดิมใช้ซ้ำไม่ได้',
  );
});

test('verifyResetCode กับบัญชีที่ไม่เคยขอรหัสไว้ → error 400', () => {
  auth.createUser({ username: 'neverasked@ipassion.co.th', nameTh: 'ไม่เคยขอ', password: 'longenough1' });
  assert.throws(
    () => auth.verifyResetCode('neverasked@ipassion.co.th', '123456'),
    (error) => error.status === 400,
  );
});

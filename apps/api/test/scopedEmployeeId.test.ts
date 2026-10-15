/**
 * พนักงานทั่วไปต้องถามได้เฉพาะข้อมูลของตัวเอง แม้ endpoint นั้นจะเปิดให้ role 'user' ใช้ (18 ก.ย. 69)
 *
 * เจอจาก POST /api/hrdd-compare-preview ซึ่งกันด้วย `requireNotExecutive` — ด่านนั้นกันเฉพาะ role
 * 'executive' เท่านั้น role 'user' ผ่านได้ (ซึ่งถูกต้อง เพราะพนักงานต้องใช้หน้าอัปโหลด Timesheet ของ
 * ตัวเอง) แต่ `employeeId` อ่านจาก body ตรงๆ ไม่ผูกกับคนที่ล็อกอิน พนักงานจึงยิง employeeId ของเพื่อน
 * ร่วมงานมาอ่านประวัติการลาจากระบบ HR ของคนอื่นได้ (วันที่ + ประเภทการลา)
 *
 * กันด้วยการผูกกับ session แบบเดียวกับที่ POST /api/timesheets/confirm ทำอยู่แล้ว — เทสต์นี้ล็อกไว้ว่า
 * ค่าที่ client ส่งมาต้องแพ้ session เสมอสำหรับ role 'user' และต้องไม่ปล่อยบัญชีที่ยังไม่ได้ผูกพนักงาน
 * ผ่านไปเป็นค่าว่าง (ค่าว่างในชั้นล่างแปลว่า "ไม่จำกัด" ไม่ใช่ "ไม่ตรงกับใครเลย")
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { ForbiddenEmployeeScope, requireAdminIfSession, scopedEmployeeId } from '../src/lib/requireRole.js';

test("role 'user' ได้ของตัวเองเสมอ ต่อให้ส่ง employeeId ของคนอื่นมา", () => {
  const me = { role: 'user', employeeId: 'EMP-0042' };

  assert.equal(scopedEmployeeId(me, 'EMP-0018'), 'EMP-0042', 'ค่าที่ client ส่งมาต้องแพ้ session เสมอ');
  assert.equal(scopedEmployeeId(me, undefined), 'EMP-0042');
  assert.equal(scopedEmployeeId(me, ''), 'EMP-0042');
});

test("บัญชี role 'user' ที่ยังไม่ได้ผูกพนักงาน ต้องถูกปฏิเสธ ไม่ใช่กลายเป็นค่าว่าง", () => {
  const unlinked = { role: 'user', employeeId: null };

  assert.throws(
    () => scopedEmployeeId(unlinked, 'EMP-0018'),
    (error: unknown) => error instanceof ForbiddenEmployeeScope && (error as ForbiddenEmployeeScope).status === 403,
    'ปล่อยผ่านเป็นค่าว่างจะกลายเป็น "ไม่จำกัด" ในชั้นล่าง ซึ่งกว้างกว่าที่ตั้งใจ',
  );
});

test("role อื่นยังถามแทนพนักงานคนอื่นได้ตามงานปกติ", () => {
  for (const role of ['admin', 'accounting', 'executive']) {
    assert.equal(scopedEmployeeId({ role, employeeId: null }, 'EMP-0018'), 'EMP-0018', `role ${role}`);
  }
});

/**
 * `requireAdminIfSession` — endpoint ที่เรียกได้ทั้งจาก n8n และจากคนที่ล็อกอิน (POST
 * /api/cycles/:contractId/:period/request-approval) เดิมปล่อยผ่านทุก role ที่ล็อกอิน ทั้งที่ต้นฉบับใน
 * server.js ทำ `if (session) requireAdmin(session)` ไว้ — พนักงานทั่วไปจึงสั่งส่งคำขออนุมัติออก INV เข้า
 * LINE ของผู้อนุมัติได้ทุกสัญญา/ทุกรอบ
 */
function runGuard(user: unknown) {
  const req: any = { user };
  let statusCode: number | null = null;
  let nexted = false;
  const res: any = { status(code: number) { statusCode = code; return this; }, json() { return this; } };
  requireAdminIfSession(req, res, () => { nexted = true; });
  return { statusCode, nexted };
}

test('requireAdminIfSession: คนล็อกอินต้องเป็น admin/บัญชีเท่านั้น', () => {
  assert.deepEqual(runGuard({ role: 'admin' }), { statusCode: null, nexted: true });
  assert.deepEqual(runGuard({ role: 'accounting' }), { statusCode: null, nexted: true });

  assert.deepEqual(runGuard({ role: 'user' }), { statusCode: 403, nexted: false }, 'พนักงานทั่วไปต้องถูกปฏิเสธ');
  assert.deepEqual(runGuard({ role: 'executive' }), { statusCode: 403, nexted: false }, 'ผู้บริหารดูอย่างเดียว');
});

test('requireAdminIfSession: เส้น n8n (ไม่มี session) ต้องผ่านตามเดิม', () => {
  assert.deepEqual(runGuard(undefined), { statusCode: null, nexted: true }, 'n8n ผ่าน shared secret มาแล้ว ห้ามบล็อก');
});

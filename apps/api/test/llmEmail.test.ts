/**
 * ทดสอบ apps/api/src/lib/llmEmailService.ts — ร่าง/อ่านอีเมลด้วยโมเดลข้อความในเครื่อง (LM Studio/Ollama)
 *
 * ใช้ fakeFetch จำลองการตอบของ endpoint แบบ OpenAI-compatible (/chat/completions)
 * แทนของจริง จึงรันได้โดยไม่ต้องเปิดโมเดลในเครื่องและไม่ยิงออกเน็ตจริง
 *
 * Ported from test/email.test.js (assertions preserved exactly) — พอร์ต TS รับ `fetchImpl` เข้ามา
 * ทาง option เหมือนต้นฉบับ จึงไม่ต้องสลับ global fetch แบบไฟล์เทสต์ ABBYY/FlowAccount
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { draftBillingEmail, readApprovalEmail } from '../src/lib/llmEmailService.js';

function fakeFetch(content: unknown) {
  return (async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      choices: [{ message: { content: JSON.stringify(content) }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 10, completion_tokens: 20 },
    }),
  })) as unknown as typeof fetch;
}

test('draftBillingEmail เรียกโมเดลข้อความในเครื่อง แล้ว parse ผลได้', async () => {
  const fetchImpl = fakeFetch({
    subject: 'ออก INV เดือนมกราคม',
    body: 'เรียน ... ยอดรวม 10,000 บาท',
    highlights: ['ยอดเท่าเดือนก่อน'],
  });

  const result = await draftBillingEmail({ total: 10000 }, { fetchImpl });

  assert.equal(result.subject, 'ออก INV เดือนมกราคม');
  assert.match(result.model, /^local:/);
  assert.ok(result.usage);
});

test('readApprovalEmail parse ผลได้เหมือนกัน', async () => {
  const fetchImpl = fakeFetch({
    isTimesheetApproval: true,
    documentNo: '2026010091',
    approvalStatus: 'อนุมัติ',
    employeeName: 'สมชาย ใจดี',
    period: '2026-01',
    approvedBy: 'ผู้จัดการโครงการ',
    approvedAt: '2026-01-28',
    notes: [],
  });

  const result = await readApprovalEmail(
    { subject: 'แจ้งอนุมัติ', from: 'a@b.com', date: '2026-01-28', body: 'อนุมัติแล้ว' },
    { fetchImpl },
  );

  assert.equal(result.documentNo, '2026010091');
  assert.equal(result.approvalStatus, 'อนุมัติ');
  assert.match(result.model, /^local:/);
});

test('โยน error ที่อ่านออกถ้าโมเดลตอบขาดคีย์ที่จำเป็น', async () => {
  const fetchImpl = fakeFetch({ subject: 'หัวข้อ' }); // ขาด body, highlights

  await assert.rejects(
    () => draftBillingEmail({ total: 10000 }, { fetchImpl }),
    /ขาดคีย์/,
  );
});

test('โยน error ที่อ่านออกถ้าเชื่อมต่อ local server ไม่ได้', async () => {
  const fetchImpl = (async () => {
    throw new Error('connect ECONNREFUSED');
  }) as unknown as typeof fetch;

  await assert.rejects(
    () => draftBillingEmail({ total: 10000 }, { fetchImpl }),
    /เชื่อมต่อโมเดลในเครื่องไม่ได้/,
  );
});

test('โยน error ที่อ่านออกถ้าโมเดลตอบไม่เป็น JSON', async () => {
  const fetchImpl = (async () => ({
    ok: true,
    status: 200,
    json: async () => ({ choices: [{ message: { content: 'ไม่ใช่ json' }, finish_reason: 'stop' }] }),
  })) as unknown as typeof fetch;

  await assert.rejects(
    () => draftBillingEmail({ total: 10000 }, { fetchImpl }),
    /ไม่เป็น JSON ที่ถูกต้อง/,
  );
});

test('โยน error ที่อ่านออกถ้าผลลัพธ์ถูกตัดเพราะ max_tokens', async () => {
  const fetchImpl = (async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      choices: [{ message: { content: '{"subject":"x"' }, finish_reason: 'length' }],
    }),
  })) as unknown as typeof fetch;

  await assert.rejects(
    () => draftBillingEmail({ total: 10000 }, { fetchImpl }),
    /ถูกตัดเพราะยาวเกิน max_tokens/,
  );
});

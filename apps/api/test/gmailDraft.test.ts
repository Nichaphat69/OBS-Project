/**
 * ร่างอีเมล INV — ฝั่ง GmailClient
 *
 * Ported from test/gmail-draft.test.js (เฉพาะส่วนที่เป็นของ client ล้วนๆ: createDraft, buildMime,
 * findSentMessage) ส่วนที่เหลือของไฟล์ต้นฉบับทดสอบ createGmailDraft()/syncEmailSent() ใน service
 * ซึ่งยังไม่ได้พอร์ต — assertion ของสองตัวนั้นยังรออยู่ที่ test/gmail-draft.test.js เหมือนเดิม
 *
 * ⚠️ ทุกเทสในไฟล์นี้คุยกับ fetch จำลอง ไม่แตะ Gmail จริง และไม่มีเทสไหนเรียก sendMessage()
 *    เพราะอีเมลฝั่งธุรกิจต้องเป็นแค่ "ร่าง" เสมอ (ดูคำเตือนหัว gmailClient.ts)
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { GmailClient, buildMime } from '../src/lib/gmailClient.js';
import { withFetch } from './helpers/fakeFetch.js';

const CREDS = { clientId: 'cid', clientSecret: 'secret', refreshToken: 'refresh' };

/** ตอบ OAuth ให้ผ่านเสมอ แล้วส่ง response ที่กำหนดให้กับทุก endpoint ของ Gmail
 * calls เก็บ request ที่ยิงออกไปจริงไว้ให้ assert ได้ว่าเราส่งอะไรไป */
function fakeGmail(byPath: Record<string, unknown>, { status = 200 } = {}) {
  const calls: Array<{ url: string; options: any }> = [];
  const impl = async (url: any, options: any = {}) => {
    const href = String(url);
    if (href.includes('oauth2.googleapis.com')) {
      return { ok: true, status: 200, text: async () => JSON.stringify({ access_token: 'tok', expires_in: 3600 }) };
    }
    calls.push({ url: href, options });
    const key = Object.keys(byPath).find((k) => href.includes(k));
    if (!key) throw new Error(`ไม่มี response จำลองสำหรับ ${href}`);
    return { ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(byPath[key]) };
  };
  return { impl, calls };
}

const PROFILE = { emailAddress: 'billing@ipassion.co.th', messagesTotal: 10 };

test('createDraft สร้างร่างอย่างเดียว — ยิงไปที่ /drafts ไม่ใช่ /messages/send', async () => {
  const { impl, calls } = fakeGmail({
    '/drafts': { id: 'draft-1', message: { id: 'msg-1', threadId: 'thread-1' } },
    '/profile': PROFILE,
  });

  const result = await withFetch(impl, () =>
    new GmailClient(CREDS).createDraft({ to: 'a@b.com', subject: 'ออก INV มี.ค. 2026', body: 'เรียนคุณลูกค้า' }),
  );

  const sendCalls = calls.filter((c) => c.url.includes('/messages/send'));
  assert.equal(sendCalls.length, 0, 'ห้ามแตะการส่งจริงเด็ดขาด');
  assert.equal(calls.filter((c) => c.url.includes('/drafts')).length, 1);
  assert.equal(result.draftId, 'draft-1');
  assert.equal(result.messageId, 'msg-1');
  assert.equal(result.threadId, 'thread-1', 'threadId คือตัวเดียวที่อยู่ยงหลังกดส่ง ต้องเก็บไว้');
});

test('createDraft ตีกลับทันทีถ้าไม่มีอีเมลผู้รับ — ไม่ยิงออกไปเปล่าๆ', async () => {
  const { impl, calls } = fakeGmail({ '/drafts': {} });
  await assert.rejects(
    () => withFetch(impl, () => new GmailClient(CREDS).createDraft({ to: '', subject: 'x', body: 'y' })),
    /ต้องระบุอีเมลผู้รับ/,
  );
  assert.equal(calls.length, 0);
});

test('ลิงก์เปิดร่างใช้ authuser=อีเมลจริง ไม่ใช่ /u/0/ ที่จะเปิดผิดบัญชีในเบราว์เซอร์ที่ล็อกอินหลายบัญชี', async () => {
  const { impl } = fakeGmail({
    '/drafts': { id: 'draft-1', message: { id: 'msg-1', threadId: 't1' } },
    '/profile': PROFILE,
  });
  const result = await withFetch(impl, () =>
    new GmailClient(CREDS).createDraft({ to: 'a@b.com', subject: 's', body: 'b' }),
  );
  assert.match(result.url, /authuser=billing%40ipassion\.co\.th/);
  assert.doesNotMatch(result.url, /\/u\/0\//);
  assert.match(result.url, /compose=msg-1/);
});

test('ร่างที่ Gmail ไม่คืน message กลับมา — ยังได้ลิงก์ไปกล่อง Drafts ไม่ใช่ลิงก์เสีย', async () => {
  const { impl } = fakeGmail({ '/drafts': { id: 'draft-9' }, '/profile': PROFILE });
  const result = await withFetch(impl, () =>
    new GmailClient(CREDS).createDraft({ to: 'a@b.com', subject: 's', body: 'b' }),
  );
  assert.equal(result.messageId, null);
  assert.equal(result.threadId, null);
  assert.match(result.url, /#drafts$/);
});

test('แนบไฟล์ครบทุกใบ — นับจำนวนได้ และไฟล์ทุกใบอยู่ในอีเมลดิบที่ยิงไป Gmail', async () => {
  const { impl, calls } = fakeGmail({
    '/drafts': { id: 'd', message: { id: 'm', threadId: 't' } },
    '/profile': PROFILE,
  });

  const attachments = [
    { filename: 'INV.pdf', mimeType: 'application/pdf', content: Buffer.from('INVOICE-BYTES') },
    { filename: 'timesheet-a.pdf', mimeType: 'application/pdf', content: Buffer.from('TS-A') },
    { filename: 'timesheet-b.pdf', mimeType: 'application/pdf', content: Buffer.from('TS-B') },
  ];
  const result = await withFetch(impl, () =>
    new GmailClient(CREDS).createDraft({ to: 'a@b.com', subject: 's', body: 'b', attachments }),
  );

  assert.equal(result.attachmentCount, 3);

  // แกะ raw ที่ยิงไปจริงกลับมาดู ว่าไฟล์ครบและเนื้อไฟล์ไม่เพี้ยน
  const sent = JSON.parse(calls.find((c) => c.url.includes('/drafts'))!.options.body);
  const raw = Buffer.from(String(sent.message.raw).replaceAll('-', '+').replaceAll('_', '/'), 'base64').toString('utf8');
  for (const a of attachments) {
    assert.ok(raw.includes(`filename="${a.filename}"`), `ต้องมีไฟล์ ${a.filename}`);
    assert.ok(raw.includes(a.content.toString('base64')), `เนื้อไฟล์ ${a.filename} ต้องไม่เพี้ยน`);
  }
});

test('buildMime: ไม่มีไฟล์แนบได้ text/plain ล้วน · มีไฟล์แนบได้ multipart/mixed', () => {
  const plain = buildMime({ to: 'a@b.com', subject: 'x', body: 'สวัสดี' }).toString('utf8');
  assert.match(plain, /Content-Type: text\/plain/);
  assert.doesNotMatch(plain, /multipart\/mixed/);

  const mixed = buildMime({
    to: 'a@b.com',
    subject: 'x',
    body: 'สวัสดี',
    attachments: [{ filename: 'f.pdf', mimeType: 'application/pdf', content: Buffer.from('X') }],
  }).toString('utf8');
  assert.match(mixed, /multipart\/mixed; boundary="obs_/);
  assert.match(mixed, /Content-Disposition: attachment; filename="f\.pdf"/);
});

test('หัวข้อภาษาไทยเข้ารหัสตาม RFC 2047 ไม่งั้นตัวอักษรเพี้ยนในเมลไคลเอนต์', () => {
  const mime = buildMime({ to: 'a@b.com', subject: 'ออก INV มี.ค. 2026', body: 'x' }).toString('utf8');
  assert.match(mime, /Subject: =\?UTF-8\?B\?/);
  assert.doesNotMatch(mime, /Subject: ออก INV/);
});

test('หัวข้อภาษาอังกฤษล้วนไม่ต้องเข้ารหัส — อ่านออกตรงๆ ในอีเมลดิบ', () => {
  const mime = buildMime({ to: 'a@b.com', subject: 'Invoice March 2026', body: 'x' }).toString('utf8');
  assert.match(mime, /Subject: Invoice March 2026/);
});

test('ใส่ cc แล้วต้องมีบรรทัด Cc ในอีเมลดิบ — ไม่ใส่ก็ต้องไม่มีบรรทัดนั้นโผล่มา', () => {
  assert.match(buildMime({ to: 'a@b.com', cc: 'hq@ipassion.co.th', subject: 's', body: 'b' }).toString('utf8'), /^Cc: hq@ipassion\.co\.th$/m);
  assert.doesNotMatch(buildMime({ to: 'a@b.com', subject: 's', body: 'b' }).toString('utf8'), /^Cc:/m);
});

test('findSentMessage อ่าน label SENT + เวลา + ผู้รับ จาก response ของ Gmail ได้ถูก', async () => {
  const { impl } = fakeGmail({
    '/threads/': {
      messages: [
        { id: 'm1', labelIds: ['DRAFT'], payload: { headers: [] } },
        {
          id: 'm2',
          labelIds: ['SENT', 'INBOX'],
          internalDate: '1775444100000',
          payload: { headers: [{ name: 'To', value: 'thanwarat@tli.example.com' }, { name: 'Subject', value: 'ออก INV' }] },
        },
      ],
    },
  });

  const sent = await withFetch(impl, () => new GmailClient(CREDS).findSentMessage('thread-1'));
  assert.equal(sent!.messageId, 'm2', 'ต้องหยิบฉบับที่มี label SENT ไม่ใช่ฉบับร่าง');
  assert.equal(sent!.to, 'thanwarat@tli.example.com');
  assert.equal(sent!.subject, 'ออก INV');
  assert.equal(sent!.sentAt, new Date(1775444100000).toISOString());
});

test('findSentMessage คืน null เมื่อสนทนามีแต่ร่าง ยังไม่มีฉบับที่ส่งออก', async () => {
  const { impl } = fakeGmail({ '/threads/': { messages: [{ id: 'm1', labelIds: ['DRAFT'] }] } });
  assert.equal(await withFetch(impl, () => new GmailClient(CREDS).findSentMessage('thread-1')), null);
});

test('findSentMessage คืน null เมื่อยังไม่เคยเก็บ threadId ไว้ — ไม่ต้องไปกวน Gmail เลย', async () => {
  const { impl, calls } = fakeGmail({ '/threads/': {} });
  assert.equal(await withFetch(impl, () => new GmailClient(CREDS).findSentMessage(null)), null);
  assert.equal(calls.length, 0);
});

/* ยิงกับ Gmail จริงแล้วเจอว่า id ที่ผิดรูปแบบได้ 400 "Invalid id value" ไม่ใช่ 404 อย่างที่คิดไว้ตอนแรก
   ถ้าไม่ดักไว้ จะโยน error ทุกครั้งที่มีคนเปิดหน้ารอบบิลที่เก็บ threadId เสียไว้ */
for (const status of [400, 404]) {
  test(`findSentMessage คืน null เมื่อ Gmail ตอบ ${status} — ตามสนทนานั้นต่อไม่ได้แล้ว ไม่ใช่ error`, async () => {
    const { impl } = fakeGmail({ '/threads/': { error: { message: 'Invalid id value' } } }, { status });
    assert.equal(await withFetch(impl, () => new GmailClient(CREDS).findSentMessage('thread-เสีย')), null);
  });
}

test('findSentMessage ยังโยน error เมื่อ Gmail ตอบ 500 — อันนั้นคือระบบมีปัญหา ไม่ใช่สนทนาหาย', async () => {
  const { impl } = fakeGmail({ '/threads/': { error: { message: 'backend error' } } }, { status: 500 });
  await assert.rejects(() => withFetch(impl, () => new GmailClient(CREDS).findSentMessage('thread-1')));
});

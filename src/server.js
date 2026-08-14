/**
 * HTTP server — ไม่ใช้ framework ภายนอกเพื่อให้รันได้ทันทีโดยไม่ต้องติดตั้งอะไรเพิ่ม
 * (AI ทั้งหมด — อ่าน Timesheet PDF และร่างอีเมล — เรียกโมเดลที่รันในเครื่อง
 *  ผ่าน LM Studio/Ollama ไม่ได้พึ่งบริการ AI ภายนอกเลย)
 */

import './env.js';   // ต้องมาก่อน import อื่น — โมดูลอื่นอ่าน process.env ตอน import

import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, dirname, extname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

import * as svc from './service.js';
import { getDb, closeDb } from './db/index.js';
import { onChange } from './events.js';
import {
  SESSION_COOKIE, parseCookies, resolveSession, verifyLogin, createSession, destroySession, hasAnyUser,
  listUsers, createUser, updateUserRole, setUserActive, deleteUser,
} from './auth.js';
import { localLlmBaseUrl, localTextModel, localVisionModel, keepModelWarm } from './llm/localClient.js';

const here = dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = join(here, '..', 'public');
/* 3000 มีแอป iPassion Recruit ใช้อยู่ — ค่าเริ่มต้นจึงเป็น 4300 ตามที่คู่มือบอก
   ไม่งั้นรันแล้วชนพอร์ตทุกครั้งที่ยังไม่ได้สร้างไฟล์ .env */
const PORT = Number(process.env.PORT ?? 4300);

/**
 * เส้นทางที่ไม่ต้อง login — สองกลุ่ม
 *   1. auth เอง (login/logout/me) — ต้องเรียกได้ก่อนมี session
 *   2. จุดต่อกับเครื่องอื่น ไม่ใช่คนนั่งหน้าเว็บ (n8n, LINE) — LINE มีการตรวจลายเซ็นของตัวเองอยู่แล้ว
 *      n8n ยิง /ingest, /cycles/ready, /request-approval ตรงๆ ไม่มี cookie มาด้วย
 * ที่เหลือทั้งหมดต้อง login ก่อน — เดิมทุกคนที่เปิดเว็บถือเป็นคนเดียวกันตาม env ACTOR
 * ซึ่งทำให้ audit log ผิดความจริงทันทีที่มีคนที่สองมาใช้ (ดู src/auth.js)
 */
const PUBLIC_API_PATTERNS = [
  /^\/api\/auth\/(login|logout|me)$/,
  /^\/api\/timesheets\/ingest$/,
  /^\/api\/cycles\/ready$/,
  /^\/api\/cycles\/[^/]+\/[0-9]{4}-[0-9]{2}\/request-approval$/,
  /^\/api\/line\/webhook$/,
];

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
};

const routes = [
  /* ── login / logout / ใครกำลังใช้อยู่ ── */
  ['POST', /^\/api\/auth\/login$/, (_m, _url, body) => {
    if (!body?.username || !body?.password) throw httpError(400, 'ต้องระบุ username และ password');
    const user = verifyLogin(body.username, body.password);
    if (!user) throw httpError(401, 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง');
    return { __session: createSession(user.username), ...user };
  }],

  ['POST', /^\/api\/auth\/logout$/, (_m, _url, _body, session, req) => {
    destroySession(parseCookies(req.headers.cookie)[SESSION_COOKIE]);
    return { __clearSession: true };
  }],

  ['GET', /^\/api\/auth\/me$/, (_m, _url, _body, session) =>
    (session ? { loggedIn: true, ...session } : { loggedIn: false })],

  /* ── จัดการระบบ → ผู้ใช้ — เฉพาะ admin (เดิมทำได้แค่ผ่าน scripts/create-user.js/SQL) ── */
  ['GET', /^\/api\/users$/, (_m, _url, _body, session) => {
    requireAdmin(session);
    return listUsers();
  }],

  ['POST', /^\/api\/users$/, (_m, _url, body, session) => {
    requireAdmin(session);
    return createUser({
      username: body?.username, nameTh: body?.nameTh, password: body?.password, role: body?.role,
      actor: session.nameTh,
    });
  }],

  ['PATCH', /^\/api\/users\/([^/]+)$/, (m, _url, body, session) => {
    requireAdmin(session);
    const username = decodeURIComponent(m[1]);
    if (username === session.username && body?.active === false) {
      throw httpError(400, 'ปิดใช้งานบัญชีของตัวเองไม่ได้');
    }
    let result;
    if (body?.role !== undefined) result = updateUserRole(username, body.role, { actor: session.nameTh });
    if (body?.active !== undefined) result = setUserActive(username, Boolean(body.active), { actor: session.nameTh });
    if (!result) throw httpError(400, 'ต้องระบุ role หรือ active อย่างใดอย่างหนึ่ง');
    return result;
  }],

  ['DELETE', /^\/api\/users\/([^/]+)$/, (m, _url, _body, session) => {
    requireAdmin(session);
    const username = decodeURIComponent(m[1]);
    if (username === session.username) throw httpError(400, 'ลบบัญชีของตัวเองไม่ได้');
    return deleteUser(username, { actor: session.nameTh });
  }],

  /** จัดการระบบ → บันทึกระบบ — log ของ audit_log ดิบ ไม่ผ่านการกรอง/แต่งข้อความแบบกระดิ่ง */
  ['GET', /^\/api\/audit-log$/, (_m, url, _body, session) => {
    requireAdmin(session);
    return svc.auditLog({ limit: Number(url.searchParams.get('limit') ?? 200) });
  }],

  /** จัดการระบบ → ผู้รับแจ้งเตือน — ปลายทาง LINE ตัวแรกคือคนที่จะได้รับคำขออนุมัติวางบิลจริง */
  ['GET', /^\/api\/notification-recipients$/, (_m, _url, _body, session) => {
    requireAdmin(session);
    return svc.listNotificationRecipients();
  }],

  ['POST', /^\/api\/notification-recipients$/, (_m, _url, body, session) => {
    requireAdmin(session);
    return svc.addNotificationRecipient({
      channel: body?.channel, label: body?.label, target: body?.target, actor: session.nameTh,
    });
  }],

  ['DELETE', /^\/api\/notification-recipients\/([^/]+)$/, (m, _url, _body, session) => {
    requireAdmin(session);
    return svc.removeNotificationRecipient(m[1], { actor: session.nameTh });
  }],

  /** คนที่เคยทักบอท LINE มาแล้ว — ให้เลือกตอนเพิ่มผู้รับแจ้งเตือนแทนก็อป userId มาวางเอง */
  ['GET', /^\/api\/line\/known-users$/, (_m, _url, _body, session) => {
    requireAdmin(session);
    return svc.listKnownLineUsers();
  }],

  /** ภาพรวม — หน้ารายงาน ไม่ใช่ขั้นตอนงาน แต่ใช้ดูข้อมูลรวมของทั้งระบบได้
   *  ?contractId= กรองให้เหลือแค่บริษัทที่กำลังเลือกอยู่บนแถบบน — ไม่ส่งมา = รวมทุกสัญญา (ของเดิม) */
  ['GET', /^\/api\/dashboard$/, (_m, url) =>
    svc.dashboard({ contractId: url.searchParams.get('contractId') ?? undefined })],

  ['GET', /^\/api\/timesheets$/, (_m, url) =>
    svc.listTimesheets({
      status: url.searchParams.get('status') ?? undefined,
      period: url.searchParams.get('period') ?? undefined,
      contractId: url.searchParams.get('contractId') ?? undefined,
    })],

  ['GET', /^\/api\/timesheets\/([^/]+)$/, (m) => {
    const sheet = svc.getTimesheet(decodeURIComponent(m[1]));
    if (!sheet) throw httpError(404, `ไม่พบ Timesheet ${m[1]}`);
    return sheet;
  }],

  ['POST', /^\/api\/timesheets\/([^/]+)\/recompute$/, (m, _url, _body, session) =>
    svc.recomputeTimesheet(decodeURIComponent(m[1]), { actor: session.nameTh })],

  /** เทียบวันลาที่ Timesheet รายงานกับวันลาที่อนุมัติแล้วจริงใน HRDD — อ่านอย่างเดียว
   * ไม่มีเขียน/แก้/ลบฝั่ง HRDD เด็ดขาด (ดูคอมเมนต์ที่ svc.checkTimesheetAgainstHrdd) */
  ['GET', /^\/api\/timesheets\/([^/]+)\/hrdd-compare$/, (m) =>
    svc.checkTimesheetAgainstHrdd(decodeURIComponent(m[1]))],

  /** เทียบวันลากับ HRDD ตอนรีวิวก่อนบันทึกในหน้า "อัปโหลด Timesheet" — ยังไม่มี timesheetId
   * (ดูคอมเมนต์ที่ svc.checkLeavesAgainstHrdd) อ่านอย่างเดียวเหมือนกัน ไม่มีเขียน/แก้/ลบฝั่ง HRDD */
  ['POST', /^\/api\/hrdd-compare-preview$/, (_m, _url, body) =>
    svc.checkLeavesAgainstHrdd({
      employeeId: body?.employeeId, period: body?.period, leaveDays: body?.leaveDays ?? [],
    })],

  ['POST', /^\/api\/timesheets\/([^/]+)\/reject$/, (m, _url, body, session) => {
    if (!body?.reason) throw httpError(400, 'ต้องระบุเหตุผลที่ตีกลับ');
    return svc.rejectTimesheet(decodeURIComponent(m[1]), { actor: session.nameTh, reason: body.reason });
  }],

  /** ขั้นที่ 2 ของโหมด manual — คนกดยืนยันว่าตรวจใบนี้แล้ว */
  ['POST', /^\/api\/timesheets\/([^/]+)\/check$/, (m, _url, _body, session) =>
    svc.markTimesheetChecked(decodeURIComponent(m[1]), { actor: session.nameTh })],

  /**
   * ขั้นที่ 1 ของโหมด manual — อัปโหลดไฟล์เอง ให้ AI อ่านให้ดูก่อน ยังไม่บันทึก
   * แยกจาก /ingest เพราะคนต้องได้ตรวจสิ่งที่ AI อ่านมาก่อนเข้าระบบ
   */
  ['POST', /^\/api\/timesheets\/read$/, async (_m, _url, body, session) => {
    if (!body?.fileBase64) throw httpError(400, 'ยังไม่ได้แนบไฟล์ Timesheet');
    const result = await svc.readTimesheetFile({
      fileBase64: body.fileBase64,
      fileName: body.fileName ?? null,
      expectedPeriod: body.expectedPeriod || null,
    });
    const documentNo = svc.logAiRead({ source: 'upload', fileName: body.fileName ?? null, result, actor: session.nameTh });
    const { fileBytes, ...clientResult } = result;
    return { ...clientResult, documentNo };
  }],

  /** คนตรวจสิ่งที่ AI อ่านแล้วกดยืนยัน → บันทึกเข้าระบบด้วยเส้นเดียวกับ n8n */
  ['POST', /^\/api\/timesheets\/confirm$/, (_m, _url, body, session) =>
    svc.confirmTimesheet({ ...body, actor: session.nameTh })],

  /** ประวัติที่ AI เคยอ่านแล้ว ทั้งจากอัปโหลดไฟล์เองและดึงจาก Gmail — ด่านแรกก่อนเข้าระบบวางบิลจริง */
  ['GET', /^\/api\/ai-reads$/, (_m, url) =>
    svc.listAiReads({ contractId: url.searchParams.get('contractId') ?? undefined })],

  ['GET', /^\/api\/ai-reads\/([^/]+)$/, (m) => {
    const row = svc.getAiRead(Number(m[1]));
    if (!row) throw httpError(404, 'ไม่พบรายการนี้');
    return row;
  }],

  ['POST', /^\/api\/ai-reads\/dismiss$/, (_m, _url, body, session) => {
    if (!body?.id) throw httpError(400, 'ต้องระบุรายการที่จะลบ');
    svc.dismissAiRead(Number(body.id), { actor: session.nameTh });
    return { ok: true };
  }],

  /* ── ขั้นที่ 1 ทางที่สอง: ดึงจากกล่อง Gmail ─────────────── */

  /** รายการอีเมลแจ้งอนุมัติที่ยังไม่ได้เอาเข้าระบบ — คนเลือกเองว่าจะดึงฉบับไหน */
  ['GET', /^\/api\/gmail\/inbox$/, (_m, url) =>
    svc.gmailInbox({
      query: url.searchParams.get('q') || undefined,
      max: Number(url.searchParams.get('max') ?? 15),
    })],

  /** ดึงอีเมล 1 ฉบับ → AI อ่านทั้งเนื้อเมลและไฟล์แนบ → คืนให้คนตรวจ (ยังไม่บันทึก) */
  ['POST', /^\/api\/gmail\/read$/, async (_m, _url, body, session) => {
    if (!body?.messageId) throw httpError(400, 'ต้องระบุอีเมลที่จะดึง');
    const result = await svc.readTimesheetFromEmail({
      messageId: body.messageId,
      attachmentFilename: body.attachmentFilename ?? null,
    });
    const documentNo = svc.logAiRead({ source: 'gmail', sourceEmailId: body.messageId, result, actor: session.nameTh });
    const { fileBytes, ...clientResult } = result;
    return { ...clientResult, documentNo };
  }],

  /** ซ่อนอีเมลฉบับนี้ทิ้งจากรายการ — ไม่ลบอีเมลจริงใน Gmail */
  ['POST', /^\/api\/gmail\/dismiss$/, (_m, _url, body, session) => {
    if (!body?.messageId) throw httpError(400, 'ต้องระบุอีเมลที่จะซ่อน');
    return svc.dismissGmailMessage(body.messageId, { actor: session.nameTh });
  }],

  /**
   * ป้อน Timesheet ด้วยมือ — ทางเข้าของการใช้งานแบบ manual
   * ไม่ต้องมีอีเมล ไม่ต้องเรียก AI เลย แต่ผ่านการตรวจชุดเดียวกับ n8n
   * เลขที่เอกสารระบบออกให้อัตโนมัติ (ดู nextDocumentNo) ไม่ต้องให้คนพิมพ์เองแล้ว
   */
  ['POST', /^\/api\/timesheets\/manual$/, (_m, _url, body, session) =>
    svc.enterTimesheetManually({ ...body, actor: session.nameTh })],

  /**
   * จุดต่อหลักกับ n8n — รับไฟล์ Timesheet เข้าระบบครบวงจร
   * อ่านด้วยโมเดล vision ในเครื่อง → จับคู่พนักงาน → บันทึก → คำนวณ Manday → บอก nextAction
   * ยิงซ้ำด้วย documentNo เดิมได้ ไม่เกิดข้อมูลซ้ำ
   */
  ['POST', /^\/api\/timesheets\/ingest$/, async (_m, _url, body) => {
    return svc.ingestTimesheet({ ...body, actor: body?.actor ?? 'n8n' });
  }],

  /* ── แก้ข้อมูลหลักด้วยมือ — เฉพาะ admin เพราะกระทบทุกใบแจ้งหนี้ในอนาคต ── */
  ['POST', /^\/api\/employees\/([^/]+)\/aliases$/, (m, _url, body, session) => {
    requireAdmin(session);
    return svc.addEmployeeAlias({
      employeeId: decodeURIComponent(m[1]),
      kind: body?.kind, alias: body?.alias, actor: session.nameTh,
    });
  }],

  ['DELETE', /^\/api\/employees\/([^/]+)\/aliases$/, (m, url, _body, session) => {
    requireAdmin(session);
    return svc.removeEmployeeAlias({
      employeeId: decodeURIComponent(m[1]),
      kind: url.searchParams.get('kind'),
      alias: url.searchParams.get('alias'),
      actor: session.nameTh,
    });
  }],

  ['PATCH', /^\/api\/assignments\/([^/]+)$/, (m, _url, body, session) => {
    requireAdmin(session);
    return svc.updateAssignmentRate({
      assignmentId: decodeURIComponent(m[1]),
      monthlyRate: body?.monthlyRate, quotationNo: body?.quotationNo, actor: session.nameTh,
    });
  }],

  ['POST', /^\/api\/holidays$/, (_m, _url, body, session) => {
    requireAdmin(session);
    return svc.addHoliday({
      date: body?.date, name: body?.name,
      customerId: body?.customerId ?? null, actor: session.nameTh,
    });
  }],

  ['DELETE', /^\/api\/holidays$/, (_m, url, _body, session) => {
    requireAdmin(session);
    return svc.removeHoliday({
      date: url.searchParams.get('date'),
      customerId: url.searchParams.get('customerId') || null,
      actor: session.nameTh,
    });
  }],

  /* ── ปิดงาน: คนส่งเมลเองแล้วมายืนยัน ── */
  ['POST', /^\/api\/invoices\/([^/]+)\/sent$/, (m, _url, _body, session) =>
    svc.markInvoiceEmailSent({ invoiceId: decodeURIComponent(m[1]), actor: session.nameTh })],

  /** ให้ n8n ตัวตั้งเวลาถามว่า "วันนี้ต้องวางบิลอะไร" */
  ['GET', /^\/api\/cycles\/ready$/, () => svc.readyCycles()],

  ['GET', /^\/api\/contracts$/, () => svc.listContracts()],
  /** สัญญาที่กำลังดำเนินการอยู่ตอนนี้ — แถบบนใช้ตั้งค่าเริ่มต้นของตัวเลือกบริษัทตอนเปิดหน้าเว็บ */
  ['GET', /^\/api\/contracts\/active$/, () => svc.getActiveContract()],

  /* ── เพิ่มลูกค้า/สัญญาใหม่ + สลับว่าใครกำลัง active — แก้ข้อมูลหลักเฉพาะ admin เหมือนกัน ── */
  ['POST', /^\/api\/customers$/, (_m, _url, body, session) => {
    requireAdmin(session);
    return svc.createCustomer({ ...body, actor: session.nameTh });
  }],

  ['POST', /^\/api\/contracts$/, (_m, _url, body, session) => {
    requireAdmin(session);
    return svc.createContract({ ...body, actor: session.nameTh });
  }],

  ['PATCH', /^\/api\/contracts\/([^/]+)\/active$/, (m, _url, body, session) => {
    requireAdmin(session);
    const contractId = decodeURIComponent(m[1]);
    return body?.active === false
      ? svc.deactivateContract(contractId, { actor: session.nameTh })
      : svc.setActiveContract(contractId, { actor: session.nameTh });
  }],

  ['GET', /^\/api\/employees$/, (_m, url) =>
    svc.listEmployees({ contractId: url.searchParams.get('contractId') ?? undefined })],

  ['POST', /^\/api\/employees$/, (_m, _url, body, session) => {
    requireAdmin(session);
    return svc.createEmployee({ ...body, actor: session.nameTh });
  }],

  ['PATCH', /^\/api\/employees\/([^/]+)$/, (m, _url, body, session) => {
    requireAdmin(session);
    return svc.updateEmployee({ ...body, employeeId: decodeURIComponent(m[1]), actor: session.nameTh });
  }],

  ['DELETE', /^\/api\/assignments\/([^/]+)$/, (m, _url, _body, session) => {
    requireAdmin(session);
    return svc.removeAssignment(decodeURIComponent(m[1]), { actor: session.nameTh });
  }],
  ['GET', /^\/api\/invoices$/, (_m, url) =>
    svc.listInvoices({ contractId: url.searchParams.get('contractId') ?? undefined })],
  ['GET', /^\/api\/activity$/, (_m, url) =>
    svc.activityFeed({ limit: Number(url.searchParams.get('limit') ?? 30) })],
  ['GET', /^\/api\/settings$/, () => svc.settingsSnapshot()],
  ['GET', /^\/api\/pulse$/, (_m, _url, _body, session) => svc.pulse({ actor: session.nameTh, role: session.role })],
  ['GET', /^\/api\/cycles$/, (_m, url) =>
    svc.billingCycles({ contractId: url.searchParams.get('contractId') ?? undefined })],

  /* cycleDetail ไม่ใช่ previewCycleInvoice ตรงๆ เพราะต้องแวะเช็คกล่อง Gmail ก่อนว่าร่างถูกส่งไปหรือยัง
     แล้วขึ้นแถบ "ส่งเมลแล้ว" ให้เองโดยไม่ต้องมีคนมากดบอก (ดู syncEmailSent) */
  ['GET', /^\/api\/cycles\/([^/]+)\/([0-9]{4}-[0-9]{2})$/, (m) =>
    svc.cycleDetail(decodeURIComponent(m[1]), m[2])],

  ['POST', /^\/api\/cycles\/([^/]+)\/([0-9]{4}-[0-9]{2})\/approve$/, (m, _url, _body, session) =>
    svc.approveCycle(decodeURIComponent(m[1]), m[2], { actor: session.nameTh })],

  /**
   * ขั้น 4.2 — ประตูมนุษย์จริงก่อนสร้างร่างใน FlowAccount — เส้นนี้ n8n เรียกได้โดยไม่ต้อง login
   * (อยู่ใน PUBLIC_API_PATTERNS) ที่นี่แค่ส่งสรุปเข้า LINE ให้คนกด ไม่สร้างเอกสารใดๆ
   * เรียกจากหน้าเว็บได้ด้วย — ตอนนั้น session มีค่า actor จะเป็นชื่อคนที่กดจริง ไม่ใช่ 'n8n'
   */
  ['POST', /^\/api\/cycles\/([^/]+)\/([0-9]{4}-[0-9]{2})\/request-approval$/, (m, _url, _body, session) =>
    svc.requestCycleApproval(decodeURIComponent(m[1]), m[2], { actor: session?.nameTh ?? 'n8n' })],

  ['GET', /^\/api\/cycles\/([^/]+)\/([0-9]{4}-[0-9]{2})\/approval$/, (m) =>
    svc.getCycleApproval(decodeURIComponent(m[1]), m[2])],

  /** ขั้นที่ 4 — ให้ AI เรียบเรียงอีเมลจากตัวเลขที่คำนวณไว้ (ยังไม่ส่ง) */
  ['POST', /^\/api\/cycles\/([^/]+)\/([0-9]{4}-[0-9]{2})\/email-draft$/, (m, _url, _body, session) =>
    svc.draftEmailWithAi(decodeURIComponent(m[1]), m[2], { actor: session.nameTh })],

  /**
   * ขั้นที่ 4 — วางร่างไว้ในกล่อง Drafts ของ Gmail
   * ชื่อ endpoint เป็น draft ไม่ใช่ send โดยเจตนา — ระบบไม่มีทางส่งอีเมลออกเอง
   */
  ['POST', /^\/api\/cycles\/([^/]+)\/([0-9]{4}-[0-9]{2})\/gmail-draft$/, (m, _url, _body, session) =>
    svc.createGmailDraft(decodeURIComponent(m[1]), m[2], { actor: session.nameTh })],
];

function httpError(status, message, extra = {}) {
  return Object.assign(new Error(message), { status, ...extra });
}

/** ใช้กับ route ที่แก้ข้อมูลหลัก (เรท/สัญญา/ชื่อพ้อง/วันหยุด) — เฉพาะ admin */
function requireAdmin(session) {
  if (session.role !== 'admin') {
    throw httpError(403, 'ต้องเป็น admin เท่านั้นถึงจะแก้ข้อมูลหลักได้');
  }
}

async function readBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    // ไฟล์ Timesheet ที่อัปโหลดมาเป็น base64 อยู่ในก้อนนี้ด้วย จึงต้องเผื่อไว้มากกว่าคำขอ JSON ปกติ
    if (size > 12_000_000) throw httpError(413, 'ไฟล์ใหญ่เกินไป — Timesheet ไม่ควรเกิน 8 MB');
    chunks.push(chunk);
  }
  if (chunks.length === 0) return null;
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw httpError(400, 'รูปแบบ JSON ไม่ถูกต้อง');
  }
}

function sendJson(res, status, data) {
  const body = JSON.stringify(data, null, 2);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

/**
 * รหัสรุ่นจากเวลาแก้ไขไฟล์หน้าเว็บล่าสุด
 *
 * ใช้ทั้งเป็น query string ท้าย CSS/JS (บังคับให้เบราว์เซอร์โหลดใหม่เมื่อไฟล์เปลี่ยน)
 * และแสดงบนหัวระบบ เพื่อให้ยืนยันได้ว่ากำลังดูรุ่นไหนอยู่
 */
async function buildId() {
  const files = ['index.html', 'styles.css', 'app.js'].map((f) => join(PUBLIC_DIR, f));
  const stats = await Promise.all(
    files.map((f) => stat(f).then((s) => s.mtimeMs).catch(() => 0)),
  );
  const newest = Math.max(...stats);
  const d = new Date(newest);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
}

/** ห้ามแคชไฟล์หน้าเว็บ — ไม่งั้นแก้ UI แล้วผู้ใช้ยังเห็นของเดิม */
const NO_CACHE = {
  'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
  Pragma: 'no-cache',
  Expires: '0',
};

async function sendHtml(res, path) {
  const html = (await readFile(path, 'utf8')).replaceAll('__BUILD__', await buildId());
  res.writeHead(200, {
    ...NO_CACHE,
    'Content-Type': MIME['.html'],
    'Content-Length': Buffer.byteLength(html),
  });
  res.end(html);
}

async function serveStatic(req, res, pathname) {
  const relative = pathname === '/' ? 'index.html' : pathname.slice(1);
  // กันการอ่านไฟล์นอกโฟลเดอร์ public
  const target = join(PUBLIC_DIR, normalize(relative).replace(/^(\.\.[/\\])+/, ''));
  if (!target.startsWith(PUBLIC_DIR)) {
    sendJson(res, 403, { error: 'ไม่อนุญาต' });
    return;
  }
  try {
    if (extname(target) === '.html') {
      await sendHtml(res, target);
      return;
    }
    const file = await readFile(target);
    res.writeHead(200, {
      ...NO_CACHE,
      'Content-Type': MIME[extname(target)] ?? 'application/octet-stream',
      'Content-Length': file.length,
    });
    res.end(file);
  } catch {
    if (extname(target) === '') {
      // เส้นทางของ SPA — ส่ง index.html กลับไป
      await sendHtml(res, join(PUBLIC_DIR, 'index.html'));
      return;
    }
    sendJson(res, 404, { error: `ไม่พบไฟล์ ${pathname}` });
  }
}

/* ── ช่องทางแจ้งข่าวสด (Server-Sent Events) ─────────────────────────
   เดิมหน้าจอถามเซิร์ฟเวอร์เป็นจังหวะ ป้ายตัวเลขจึงช้าได้เกือบเต็มหนึ่งจังหวะ
   และยิงถามทิ้งเปล่าตลอดเวลาที่ไม่มีอะไรเปลี่ยน — ซึ่งเป็นเวลาเกือบทั้งวัน
   ทางนี้เซิร์ฟเวอร์บอกเองตอนมีของใหม่ ป้ายขึ้นแทบทันที และเงียบสนิทตอนไม่มีอะไรเกิด

   เลือก SSE ไม่ใช่ WebSocket เพราะข่าวไหลทางเดียวจากเซิร์ฟเวอร์ไปหน้าจอ
   ใช้ HTTP ปกติ ไม่ต้องเพิ่มไลบรารี และ EventSource ฝั่งเบราว์เซอร์ต่อสายกลับเอง */

const streams = new Set();

function broadcast(chunk) {
  for (const res of streams) {
    // ปลายสายที่ตายแล้วอาจยังไม่ถูกแจ้ง close — เขียนพลาดก็ถอดออกจากรายชื่อ
    try { res.write(chunk); } catch { streams.delete(res); }
  }
}

function openStream(req, res) {
  res.writeHead(200, {
    ...NO_CACHE,
    'Content-Type': 'text/event-stream; charset=utf-8',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',   // กัน reverse proxy อมข้อมูลไว้ในบัฟเฟอร์
  });
  res.write('retry: 3000\n\n');   // สายหลุดแล้วให้เบราว์เซอร์ต่อใหม่ใน 3 วินาที
  streams.add(res);
  req.on('close', () => streams.delete(res));
}

onChange((reason) => {
  broadcast(`event: change\ndata: ${JSON.stringify({ reason })}\n\n`);
});

/* สายที่เงียบนานมักถูกตัวกลางตัดทิ้ง เคาะเป็นบรรทัดคอมเมนต์ไว้ให้สายไม่ตาย
   unref เพื่อไม่ให้ตัวจับเวลานี้ค้างไว้ไม่ให้กระบวนการปิดตัวตอนสั่งหยุดเซิร์ฟเวอร์ */
setInterval(() => broadcast(': beat\n\n'), 25_000).unref();

/* กันโมเดล vision ในเครื่องหลุดจากหน่วยความจำตอนไม่มีใครเรียกนาน — บางเซิร์ฟเวอร์ตั้ง TTL ปลดโมเดล
   ไว้ 1 ชม. (ใช้ LM Studio ร่วมกับระบบอื่น แก้ config เครื่องนั้นไม่ได้/ไม่อยากยุ่ง) ปิงถี่กว่านั้นมาก
   พอให้โมเดลไม่ว่างจนถูกปลด ผิดพลาดได้ก็แค่ log เงียบๆ ไม่กระทบการทำงานหลัก (ดู keepModelWarm) */
setInterval(() => { keepModelWarm(); }, 20 * 60_000).unref();

/** ตั้ง/ถอนคุกกี้ session — HttpOnly กันอ่านจาก JS, SameSite=Lax กันแนบมาจากเว็บอื่น */
function setSessionCookie(res, token, expiresAt) {
  res.setHeader('Set-Cookie', `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Expires=${new Date(expiresAt).toUTCString()}`);
}
function clearSessionCookie(res) {
  res.setHeader('Set-Cookie', `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host ?? 'localhost'}`);

  if (!url.pathname.startsWith('/api/')) {
    await serveStatic(req, res, url.pathname);
    return;
  }

  const session = resolveSession(parseCookies(req.headers.cookie)[SESSION_COOKIE]);
  const isPublic = PUBLIC_API_PATTERNS.some((re) => re.test(url.pathname));
  if (!session && !isPublic) {
    sendJson(res, 401, { error: 'ยังไม่ได้เข้าสู่ระบบ — กรุณา login ก่อนใช้งาน' });
    return;
  }

  // ไม่ผ่านตารางเส้นทางด้านล่าง เพราะสายนี้เปิดค้างไว้ ไม่ได้ตอบ JSON ก้อนเดียวแล้วจบ
  if (url.pathname === '/api/stream' && req.method === 'GET') {
    openStream(req, res);
    return;
  }

  /**
   * webhook จาก LINE ตอนคนกดปุ่มอนุมัติ/ตีกลับ — ต้องอ่าน raw body เองก่อน JSON.parse
   * เพราะการตรวจลายเซ็น HMAC ต้องใช้ไบต์ดิบ ผ่าน readBody() ทั่วไปที่ parse เป็น object แล้วไม่ได้
   */
  if (url.pathname === '/api/line/webhook' && req.method === 'POST') {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const raw = Buffer.concat(chunks);
    try {
      const result = await svc.processLineWebhook(raw, req.headers['x-line-signature']);
      sendJson(res, 200, result);
    } catch (error) {
      sendJson(res, error.status ?? 500, { error: error.message });
    }
    return;
  }

  /** ส่งไฟล์ PDF เป็นไบต์ดิบ — inline = เปิดดูในเบราว์เซอร์ · attachment = สั่งดาวน์โหลด
   *  ชื่อไฟล์ภาษาไทยต้องใช้ filename* ตาม RFC 5987 ไม่งั้นเบราว์เซอร์ได้ชื่อเพี้ยน */
  const sendPdf = (response, file, download) => {
    const encoded = encodeURIComponent(file.filename ?? 'document.pdf');
    response.writeHead(200, {
      ...NO_CACHE,
      'Content-Type': 'application/pdf',
      'Content-Length': file.bytes.length,
      'Content-Disposition': `${download ? 'attachment' : 'inline'}; filename*=UTF-8''${encoded}`,
    });
    response.end(file.bytes);
  };

  /** ไฟล์ PDF ต้นฉบับ — ไม่ผ่าน sendJson เพราะต้องส่งเป็นไบต์ดิบให้เบราว์เซอร์เปิดดูได้ตรงๆ
   *  (ใช้ตอนกดดูไฟล์แนบจากหน้าร่างอีเมล / แนบจริงเข้า Gmail draft)
   *  timesheets = ไฟล์ที่รับเข้ามา · invoices = ใบวางบิลที่ตัดมาจากหน้า share ของ FlowAccount */
  const fileMatch = url.pathname.match(/^\/api\/(timesheets|invoices)\/([^/]+)\/file$/);
  if (fileMatch && req.method === 'GET') {
    const id = decodeURIComponent(fileMatch[2]);
    const isInvoice = fileMatch[1] === 'invoices';
    const file = isInvoice ? await svc.getInvoiceFile(id) : svc.getTimesheetFile(id);
    if (!file) {
      sendJson(res, 404, {
        error: isInvoice
          ? `ยังไม่มีไฟล์ใบวางบิลของ ${id} — ดึงจาก FlowAccount ไม่สำเร็จหรือยังไม่มีลิงก์ดูเอกสาร`
          : `ไม่พบไฟล์ต้นฉบับของ Timesheet ${id}`,
      });
      return;
    }
    sendPdf(res, file, url.searchParams.get('dl') !== null);
    return;
  }

  /** ไฟล์แนบใน Gmail ที่ยังไม่ได้เข้าระบบ — ให้เปิดดูก่อนสั่งให้ AI อ่านได้
   *  ดึงสดจาก Gmail ทุกครั้ง ไม่เก็บลงระบบ เพราะยังไม่มีใครยืนยันไฟล์นี้ */
  const mailFileMatch = url.pathname.match(/^\/api\/gmail\/([^/]+)\/attachment$/);
  if (mailFileMatch && req.method === 'GET') {
    try {
      const file = await svc.getGmailAttachment({
        messageId: decodeURIComponent(mailFileMatch[1]),
        filename: url.searchParams.get('filename'),
      });
      sendPdf(res, file, url.searchParams.get('dl') !== null);
    } catch (error) {
      sendJson(res, error.status ?? 500, { error: error.message });
    }
    return;
  }

  // ส่งออก CSV — ไม่ผ่าน sendJson เพราะต้องเป็นไฟล์ให้ดาวน์โหลด

  const body = req.method === 'POST' || req.method === 'PATCH' ? await readBody(req).catch((e) => e) : null;
  if (body instanceof Error) {
    sendJson(res, body.status ?? 400, { error: body.message });
    return;
  }

  for (const [method, pattern, handler] of routes) {
    if (req.method !== method) continue;
    const match = url.pathname.match(pattern);
    if (!match) continue;

    try {
      const result = await handler(match, url, body, session, req);
      /* มีแค่ /auth/login กับ /auth/logout ที่คืนป้ายพวกนี้มา (ดูตาราง routes ด้านบน)
         ต้อง Array.isArray กันไว้ก่อน object-destructure เพราะ endpoint ส่วนใหญ่คืน array ตรงๆ
         (เช่น /api/timesheets) — destructure ทับ array จะกลายเป็น object ที่มี key เป็นเลขอินเดกซ์
         ทำให้ .filter()/.map() ฝั่งหน้าเว็บพังทันที */
      if (!Array.isArray(result) && (result?.__session || result?.__clearSession)) {
        if (result.__session) setSessionCookie(res, result.__session.token, result.__session.expiresAt);
        if (result.__clearSession) clearSessionCookie(res);
        const { __session, __clearSession, ...rest } = result;
        sendJson(res, 200, rest);
      } else {
        sendJson(res, 200, result);
      }
    } catch (error) {
      const status = error.status ?? 500;
      if (status >= 500) console.error(`[${req.method} ${url.pathname}]`, error);
      sendJson(res, status, {
        error: error.message,
        ...(error.blockers ? { blockers: error.blockers } : {}),
      });
    }
    return;
  }

  sendJson(res, 404, { error: `ไม่มี endpoint ${req.method} ${url.pathname}` });
});

getDb(); // เปิดฐานข้อมูลและสร้าง schema ก่อนรับ request

server.listen(PORT, () => {
  const mode = process.env.FLOWACCOUNT_MODE ?? 'dry-run';
  console.log(`ระบบวางบิล Outsource — http://localhost:${PORT}`);
  console.log(`  FlowAccount : ${mode}${mode === 'dry-run' ? ' (ไม่เรียก API จริง)' : ''}`);
  console.log(`  AI (ในเครื่อง) : ${localLlmBaseUrl()} — ข้อความ: ${localTextModel()} · vision: ${localVisionModel()}`);
  console.log(
    hasAnyUser()
      ? '  ผู้ใช้งาน    : login ด้วยบัญชีที่สร้างไว้ (npm run user:create เพื่อเพิ่มคนใหม่)'
      : '  ผู้ใช้งาน    : ยังไม่มีบัญชีเลย — รัน `npm run user:create` ก่อนเข้าใช้เว็บ',
  );
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    /* สาย SSE ถูกเปิดค้างไว้ตลอด ถ้าไม่ปิดให้เอง server.close() จะรอสายที่ไม่มีวันจบ
       กระบวนการเก่าจึงค้างอยู่ทั้งที่ปล่อยพอร์ตไปแล้ว หน้าจอที่ยังเกาะสายเก่าอยู่
       ก็จะเงียบไปเฉยๆ เพราะข่าวเกิดที่กระบวนการใหม่ ปิดสายเองเบราว์เซอร์จะต่อใหม่ทันที */
    for (const res of streams) res.end();
    streams.clear();
    server.close(() => {
      closeDb();
      process.exit(0);
    });
  });
}

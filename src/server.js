/**
 * HTTP server — ไม่ใช้ framework ภายนอกเพื่อให้รันได้ทันทีโดยไม่ต้องติดตั้งอะไรเพิ่ม
 * (Anthropic SDK เป็น dependency เดียว และใช้เฉพาะตอนอ่าน Timesheet PDF)
 */

import './env.js';   // ต้องมาก่อน import อื่น — โมดูลอื่นอ่าน process.env ตอน import

import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, dirname, extname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

import * as svc from './service.js';
import { getDb, closeDb } from './db/index.js';
import { onChange } from './events.js';

const here = dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = join(here, '..', 'public');
/* 3000 มีแอป iPassion Recruit ใช้อยู่ — ค่าเริ่มต้นจึงเป็น 4300 ตามที่คู่มือบอก
   ไม่งั้นรันแล้วชนพอร์ตทุกครั้งที่ยังไม่ได้สร้างไฟล์ .env */
const PORT = Number(process.env.PORT ?? 4300);

/**
 * ผู้ใช้ที่ล็อกอิน — ระบบจริงต้องต่อกับ SSO ของบริษัท
 *
 * ห้ามใส่ชื่อคนจริงเป็นค่าเริ่มต้นเด็ดขาด เดิมตั้งไว้เป็น "กิตติมา สังข์ทอง"
 * ซึ่งเป็นชื่อผู้จัดทำใบว่าจ้างฝั่งลูกค้า ผลคือบันทึกว่าคนคนนั้นกดอนุมัติวางบิล
 * ทั้งที่ไม่เคยแตะระบบ — เป็นการสร้างหลักฐานเท็จในสิ่งที่มีไว้ตรวจสอบย้อนหลัง
 * ถ้ายังไม่ระบุตัวตน ต้องบอกตรงๆ ว่าไม่รู้ว่าใครกด
 */
const ACTOR = process.env.ACTOR?.trim() || 'ยังไม่ได้ระบุผู้ใช้';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
};

const routes = [
  /** ภาพรวม — หน้ารายงาน ไม่ใช่ขั้นตอนงาน แต่ใช้ดูข้อมูลรวมของทั้งระบบได้ */
  ['GET', /^\/api\/dashboard$/, () => svc.dashboard()],

  ['GET', /^\/api\/timesheets$/, (_m, url) =>
    svc.listTimesheets({
      status: url.searchParams.get('status') ?? undefined,
      period: url.searchParams.get('period') ?? undefined,
    })],

  ['GET', /^\/api\/timesheets\/([^/]+)$/, (m) => {
    const sheet = svc.getTimesheet(decodeURIComponent(m[1]));
    if (!sheet) throw httpError(404, `ไม่พบ Timesheet ${m[1]}`);
    return sheet;
  }],

  ['POST', /^\/api\/timesheets\/([^/]+)\/recompute$/, (m) =>
    svc.recomputeTimesheet(decodeURIComponent(m[1]), { actor: ACTOR })],

  ['POST', /^\/api\/timesheets\/([^/]+)\/reject$/, (m, _url, body) => {
    if (!body?.reason) throw httpError(400, 'ต้องระบุเหตุผลที่ตีกลับ');
    return svc.rejectTimesheet(decodeURIComponent(m[1]), { actor: ACTOR, reason: body.reason });
  }],

  /** ขั้นที่ 2 ของโหมด manual — คนกดยืนยันว่าตรวจใบนี้แล้ว */
  ['POST', /^\/api\/timesheets\/([^/]+)\/check$/, (m) =>
    svc.markTimesheetChecked(decodeURIComponent(m[1]), { actor: ACTOR })],

  /**
   * ขั้นที่ 1 ของโหมด manual — อัปโหลดไฟล์เอง ให้ AI อ่านให้ดูก่อน ยังไม่บันทึก
   * แยกจาก /ingest เพราะคนต้องได้ตรวจสิ่งที่ AI อ่านมาก่อนเข้าระบบ
   */
  ['POST', /^\/api\/timesheets\/read$/, async (_m, _url, body) => {
    if (!process.env.ANTHROPIC_API_KEY) {
      throw httpError(400, 'ยังไม่ได้ตั้งค่า ANTHROPIC_API_KEY — ใส่ใน .env ก่อนใช้การอ่านไฟล์ด้วย AI');
    }
    if (!body?.fileBase64) throw httpError(400, 'ยังไม่ได้แนบไฟล์ Timesheet');
    return svc.readTimesheetFile({
      fileBase64: body.fileBase64,
      fileName: body.fileName ?? null,
      expectedPeriod: body.expectedPeriod || null,
    });
  }],

  /** คนตรวจสิ่งที่ AI อ่านแล้วกดยืนยัน → บันทึกเข้าระบบด้วยเส้นเดียวกับ n8n */
  ['POST', /^\/api\/timesheets\/confirm$/, (_m, _url, body) =>
    svc.confirmTimesheet({ ...body, actor: ACTOR })],

  /* ── ขั้นที่ 1 ทางที่สอง: ดึงจากกล่อง Gmail ─────────────── */

  /** รายการอีเมลแจ้งอนุมัติที่ยังไม่ได้เอาเข้าระบบ — คนเลือกเองว่าจะดึงฉบับไหน */
  ['GET', /^\/api\/gmail\/inbox$/, (_m, url) =>
    svc.gmailInbox({
      query: url.searchParams.get('q') || undefined,
      max: Number(url.searchParams.get('max') ?? 15),
    })],

  /** ดึงอีเมล 1 ฉบับ → AI อ่านทั้งเนื้อเมลและไฟล์แนบ → คืนให้คนตรวจ (ยังไม่บันทึก) */
  ['POST', /^\/api\/gmail\/read$/, (_m, _url, body) => {
    if (!process.env.ANTHROPIC_API_KEY) {
      throw httpError(400, 'ยังไม่ได้ตั้งค่า ANTHROPIC_API_KEY — ใส่ใน .env ก่อนใช้การอ่านด้วย AI');
    }
    if (!body?.messageId) throw httpError(400, 'ต้องระบุอีเมลที่จะดึง');
    return svc.readTimesheetFromEmail({
      messageId: body.messageId,
      attachmentId: body.attachmentId ?? null,
    });
  }],

  /**
   * ป้อน Timesheet ด้วยมือ — ทางเข้าของการใช้งานแบบ manual
   * ไม่ต้องมีอีเมล ไม่ต้องมี ANTHROPIC_API_KEY แต่ผ่านการตรวจชุดเดียวกับ n8n
   */
  ['POST', /^\/api\/timesheets\/manual$/, (_m, _url, body) => {
    if (!body?.documentNo) throw httpError(400, 'ต้องระบุเลขที่เอกสารจากใบ Timesheet');
    return svc.enterTimesheetManually({ ...body, actor: ACTOR });
  }],

  /**
   * จุดต่อหลักกับ n8n — รับไฟล์ Timesheet เข้าระบบครบวงจร
   * อ่านด้วย Claude → จับคู่พนักงาน → บันทึก → คำนวณ Manday → บอก nextAction
   * ยิงซ้ำด้วย documentNo เดิมได้ ไม่เกิดข้อมูลซ้ำ
   */
  ['POST', /^\/api\/timesheets\/ingest$/, async (_m, _url, body) => {
    if (!process.env.ANTHROPIC_API_KEY) {
      throw httpError(400, 'ยังไม่ได้ตั้งค่า ANTHROPIC_API_KEY — ใส่ใน .env ก่อนใช้การอ่านไฟล์ด้วย AI');
    }
    return svc.ingestTimesheet({ ...body, actor: body?.actor ?? 'n8n' });
  }],

  /* ── แก้ข้อมูลหลักด้วยมือ ── */
  ['POST', /^\/api\/employees\/([^/]+)\/aliases$/, (m, _url, body) =>
    svc.addEmployeeAlias({
      employeeId: decodeURIComponent(m[1]),
      kind: body?.kind, alias: body?.alias, actor: ACTOR,
    })],

  ['DELETE', /^\/api\/employees\/([^/]+)\/aliases$/, (m, url) =>
    svc.removeEmployeeAlias({
      employeeId: decodeURIComponent(m[1]),
      kind: url.searchParams.get('kind'),
      alias: url.searchParams.get('alias'),
      actor: ACTOR,
    })],

  ['PATCH', /^\/api\/assignments\/([^/]+)$/, (m, _url, body) =>
    svc.updateAssignmentRate({
      assignmentId: decodeURIComponent(m[1]),
      monthlyRate: body?.monthlyRate, quotationNo: body?.quotationNo, actor: ACTOR,
    })],

  ['POST', /^\/api\/holidays$/, (_m, _url, body) =>
    svc.addHoliday({
      date: body?.date, name: body?.name,
      customerId: body?.customerId ?? null, actor: ACTOR,
    })],

  ['DELETE', /^\/api\/holidays$/, (_m, url) =>
    svc.removeHoliday({
      date: url.searchParams.get('date'),
      customerId: url.searchParams.get('customerId') || null,
      actor: ACTOR,
    })],

  /* ── ปิดงาน: คนส่งเมลเองแล้วมายืนยัน ── */
  ['POST', /^\/api\/invoices\/([^/]+)\/sent$/, (m) =>
    svc.markInvoiceEmailSent({ invoiceId: decodeURIComponent(m[1]), actor: ACTOR })],

  /** ให้ n8n ตัวตั้งเวลาถามว่า "วันนี้ต้องวางบิลอะไร" */
  ['GET', /^\/api\/cycles\/ready$/, () => svc.readyCycles()],

  ['GET', /^\/api\/contracts$/, () => svc.listContracts()],
  ['GET', /^\/api\/employees$/, () => svc.listEmployees()],
  ['GET', /^\/api\/invoices$/, () => svc.listInvoices()],
  ['GET', /^\/api\/activity$/, (_m, url) =>
    svc.activityFeed({ limit: Number(url.searchParams.get('limit') ?? 30) })],
  ['GET', /^\/api\/settings$/, () => svc.settingsSnapshot()],
  ['GET', /^\/api\/pulse$/, () => svc.pulse()],
  ['GET', /^\/api\/cycles$/, () => svc.billingCycles()],

  ['GET', /^\/api\/cycles\/([^/]+)\/([0-9]{4}-[0-9]{2})$/, (m) =>
    svc.previewCycleInvoice(decodeURIComponent(m[1]), m[2])],

  ['POST', /^\/api\/cycles\/([^/]+)\/([0-9]{4}-[0-9]{2})\/approve$/, (m) =>
    svc.approveCycle(decodeURIComponent(m[1]), m[2], { actor: ACTOR })],

  /** ขั้นที่ 4 — ให้ AI เรียบเรียงอีเมลจากตัวเลขที่คำนวณไว้ (ยังไม่ส่ง) */
  ['POST', /^\/api\/cycles\/([^/]+)\/([0-9]{4}-[0-9]{2})\/email-draft$/, (m) =>
    svc.draftEmailWithAi(decodeURIComponent(m[1]), m[2], { actor: ACTOR })],

  /**
   * ขั้นที่ 4 — วางร่างไว้ในกล่อง Drafts ของ Gmail
   * ชื่อ endpoint เป็น draft ไม่ใช่ send โดยเจตนา — ระบบไม่มีทางส่งอีเมลออกเอง
   */
  ['POST', /^\/api\/cycles\/([^/]+)\/([0-9]{4}-[0-9]{2})\/gmail-draft$/, (m) =>
    svc.createGmailDraft(decodeURIComponent(m[1]), m[2], { actor: ACTOR })],
];

function httpError(status, message, extra = {}) {
  return Object.assign(new Error(message), { status, ...extra });
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

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host ?? 'localhost'}`);

  if (!url.pathname.startsWith('/api/')) {
    await serveStatic(req, res, url.pathname);
    return;
  }

  // ไม่ผ่านตารางเส้นทางด้านล่าง เพราะสายนี้เปิดค้างไว้ ไม่ได้ตอบ JSON ก้อนเดียวแล้วจบ
  if (url.pathname === '/api/stream' && req.method === 'GET') {
    openStream(req, res);
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
      const result = await handler(match, url, body);
      sendJson(res, 200, result);
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
  console.log(`  Claude      : ${process.env.ANTHROPIC_API_KEY ? 'พร้อมใช้' : 'ยังไม่ตั้ง ANTHROPIC_API_KEY'}`);
  console.log(`  ผู้ใช้       : ${ACTOR}`);
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

/**
 * ตัวเชื่อม LINE Messaging API — ประตูมนุษย์ของขั้น 4.2
 *
 *   ขาออก  ส่ง Flex Message เข้าแชทที่ตั้งไว้ — คำขออนุมัติวางบิล และคิวรอตรวจ Manday
 *          ทั้งสองแบบใช้โครงบับเบิลเดียวกัน (ดู bubble()) และมีปุ่มพาเข้าหน้าที่ต้องทำงานต่อ
 *   ขาเข้า  รับ webhook ตอนคนกดปุ่ม postback (ดู service.processLineWebhook ที่เรียกฟังก์ชันจากไฟล์นี้)
 *          — ใช้เฉพาะตอนไม่ได้ตั้ง APP_BASE_URL ไว้ ดูเหตุผลใน buildApprovalFlex()
 *
 * ไม่มีโค้ดเรียก /message/broadcast หรือส่งอะไรโดยไม่มีคนขอ — ส่งได้แค่ตอน
 * requestCycleApproval() เรียกเท่านั้น และส่งไปที่ LINE_APPROVER_TARGET เดียวที่ตั้งไว้
 *
 * ไม่ใช้ LINE SDK — เรียก REST ตรงด้วย fetch ตามหลัก zero-dependency ของโปรเจกต์
 */

import { createHmac, timingSafeEqual } from 'node:crypto';

const API = 'https://api.line.me/v2/bot';

export class LineError extends Error {
  constructor(message, { status = null, body = null } = {}) {
    super(message);
    this.name = 'LineError';
    this.status = status;
    this.body = body;
  }
}

export function hasLineCredentials() {
  return Boolean(process.env.LINE_CHANNEL_ACCESS_TOKEN && process.env.LINE_CHANNEL_SECRET);
}

function approverIds() {
  return (process.env.LINE_APPROVER_USER_IDS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * ตรวจว่า userId ที่กดปุ่มมา อยู่ในรายชื่อที่อนุญาตให้อนุมัติวางบิลหรือไม่
 * ยังไม่ตั้งรายชื่อ (LINE_APPROVER_USER_IDS ว่าง) = ปิดไว้ก่อนทั้งหมด
 * ปลอดภัยกว่าเปิดรับทุกคนที่บังเอิญรู้ webhook URL
 */
export function isAuthorizedApprover(userId) {
  if (!userId) return false;
  const allow = approverIds();
  return allow.length > 0 && allow.includes(userId);
}

/**
 * ตรวจลายเซ็น LINE ตามสเปก — HMAC-SHA256 ของ raw body ด้วย Channel Secret เข้ารหัส base64
 * ต้องใช้ raw body ตัวที่ยังไม่ผ่าน JSON.parse เท่านั้น ไม่งั้นลายเซ็นไม่ตรง
 */
export function verifyLineSignature(rawBody, signature, channelSecret) {
  if (!signature || !channelSecret || !rawBody) return false;
  const expected = createHmac('sha256', channelSecret).update(rawBody).digest('base64');
  const a = Buffer.from(expected);
  const b = Buffer.from(String(signature));
  return a.length === b.length && timingSafeEqual(a, b);
}

const POSTBACK_RE = /^(approve|reject):(.+):(\d{4}-\d{2})$/;

/** ข้อมูลที่ฝังไว้ในปุ่ม — ตอนกดจะย้อนกลับมาที่ postback.data ของ webhook event */
export function buildApprovalPostback(action, contractId, period) {
  return `${action}:${contractId}:${period}`;
}

export function parseApprovalPostback(data) {
  const m = POSTBACK_RE.exec(String(data ?? ''));
  if (!m) return null;
  return { decision: m[1] === 'approve' ? 'approved' : 'rejected', contractId: m[2], period: m[3] };
}

/* คนละ prefix กับ postback อนุมัติวางบิลด้านบน (ขึ้นต้น "ticket:" เสมอ) กันสับสน/ชนกันตอน parse —
   action: 'start' (เลือกหมวดปัญหา, value = category เช่น 'bug') หรือ 'resolve' (value = ticket id) */
const TICKET_POSTBACK_RE = /^ticket:(start|resolve):(.+)$/;

export function buildTicketPostback(action, value) {
  return `ticket:${action}:${value}`;
}

export function parseTicketPostback(data) {
  const m = TICKET_POSTBACK_RE.exec(String(data ?? ''));
  if (!m) return null;
  return { action: m[1], value: m[2] };
}

/* คนละ prefix กับ postback อื่นๆ ด้านบน (ขึ้นต้น "tsmethod:" เสมอ) — ตอบคำถาม "เลือกวิธีส่ง Timesheet"
   จากการ์ดเตือน Timesheet ยังไม่ส่ง (8 ก.ย. 69 ตามที่ขอ, แบบ mockup "2. Timesheet Submission Flow")
   self_obs/self_email/proxy_email ตรงกับค่า submission_method ที่มีอยู่แล้วในตาราง timesheets
   (ดู ADDED_COLUMNS ใน db/index.js) ส่วน snooze ไม่ใช่ submission_method จริง แค่ปุ่ม "ส่งภายหลัง" */
const TS_METHOD_POSTBACK_RE = /^tsmethod:(self_obs|self_email|proxy_email|snooze):(.+):(\d{4}-\d{2})$/;

export function buildTimesheetMethodPostback(method, contractId, period) {
  return `tsmethod:${method}:${contractId}:${period}`;
}

export function parseTimesheetMethodPostback(data) {
  const m = TS_METHOD_POSTBACK_RE.exec(String(data ?? ''));
  if (!m) return null;
  return { method: m[1], contractId: m[2], period: m[3] };
}

export class LineClient {
  constructor({
    channelAccessToken = process.env.LINE_CHANNEL_ACCESS_TOKEN,
    // userId หรือ groupId ของแชทที่จะส่งคำขออนุมัติไปให้ — ตั้งเป็นกลุ่มเฉพาะฝ่ายบัญชี
    // อย่าตั้งเป็นกลุ่มรวมทีม เพราะข้อความมีตัวเลขเงินเดือน
    approverTarget = process.env.LINE_APPROVER_TARGET,
    fetchImpl = globalThis.fetch,
  } = {}) {
    this.token = channelAccessToken;
    this.to = approverTarget;
    this.fetch = fetchImpl;
  }

  async call(path, body, { method = 'POST' } = {}) {
    if (!this.token) {
      throw new LineError(
        'ยังไม่ได้เชื่อมต่อ LINE — ใส่ LINE_CHANNEL_ACCESS_TOKEN ใน .env (ดูวิธีขอในหัวข้อ LINE ของ README)',
        { status: 400 },
      );
    }
    const response = await this.fetch(`${API}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${this.token}`,
        ...(method === 'GET' ? {} : { 'Content-Type': 'application/json' }),
      },
      ...(method === 'GET' ? {} : { body: JSON.stringify(body) }),
    });
    const text = await response.text();
    const parsed = text ? safeJson(text) : null;
    if (!response.ok) {
      throw new LineError(`เรียก LINE API ไม่สำเร็จ (${path})`, { status: response.status, body: parsed });
    }
    return parsed;
  }

  /**
   * ชื่อที่แสดงของคนที่เคยทักบอทมาแล้ว (เห็น userId จาก webhook) — ใช้โชว์ในดรอปดาวน์เลือก
   * ผู้รับแจ้งเตือน ไม่ต้องให้คนก็อป userId มาวางเอง
   * คืน null ถ้าคนนั้นบล็อกบอทหรือเลิกเป็นเพื่อนไปแล้ว (LINE ตอบ 404) — ไม่ถือเป็น error
   */
  async getProfile(userId) {
    try {
      return await this.call(`/profile/${encodeURIComponent(userId)}`, null, { method: 'GET' });
    } catch (error) {
      if (error instanceof LineError && error.status === 404) return null;
      throw error;
    }
  }

  /**
   * ส่งสรุปรอบบิล + ปุ่มอนุมัติ/ตีกลับ เข้า LINE — ส่งให้ **ทุกคน** ในรายชื่อผู้รับแจ้งเตือน
   * ช่องทาง LINE (targets) ไม่ใช่แค่คนแรก ใครก็ตามในรายชื่อกดปุ่มอนุมัติ/ตีกลับได้ (ยังต้องอยู่ใน
   * LINE_APPROVER_USER_IDS ด้วย — ดู isAuthorizedApprover) แต่ละคนได้รับข้อความเดียวกันแยกกัน
   * ไม่มีการรอผลตรงนี้ — คนกดปุ่มแล้ว LINE จะยิง webhook กลับมาต่างหาก (ดู service.processLineWebhook)
   */
  async pushApprovalRequest({
    contractId, period, customerName, projectName, periodLabel, headcount, paymentAmount,
    approveUrl = null, targets,
  }) {
    const list = this.resolveTargets(
      targets,
      'ยังไม่มีปลายทาง LINE ให้ส่งขออนุมัติ — เพิ่มผู้รับแจ้งเตือนช่องทาง LINE ไว้ที่หน้าจัดการระบบก่อน',
    );
    const flex = buildApprovalFlex({
      contractId, period, customerName, projectName, periodLabel, headcount, paymentAmount, approveUrl,
    });
    const messages = [
      { type: 'flex', altText: `ขออนุมัติวางบิล ${customerName} รอบ ${periodLabel}`, contents: flex },
    ];
    return this.pushToAll(list, messages);
  }

  /**
   * แจ้งว่ามี Timesheet รออยู่ในคิว "ตรวจ Manday" — บับเบิลหน้าตาเดียวกับคำขออนุมัติวางบิล
   * มีปุ่มกดเข้าหน้าตรวจได้เลย ไม่ใช่ข้อความเปล่าๆกับลิงก์โล้นๆให้ก็อปไปวางเอง
   *
   * รับมาเป็นหลายบับเบิล (กลุ่มละลูกค้า) — เกินหนึ่งจะส่งเป็น carousel เลื่อนดูได้ในฟองเดียว
   */
  async pushNeedsCheck({ bubbles, altText, targets }) {
    if (!bubbles?.length) return { sentTo: [] };
    const list = this.resolveTargets(
      targets,
      'ยังไม่มีปลายทาง LINE ให้แจ้งเตือน — เพิ่มผู้รับแจ้งเตือนช่องทาง LINE ไว้ก่อน',
    );
    const contents = bubbles.length === 1
      ? bubbles[0]
      : { type: 'carousel', contents: bubbles };

    const messages = [{ type: 'flex', altText, contents }];
    return this.pushToAll(list, messages);
  }

  /**
   * ยิงเข้าทุกคนในรายชื่อแบบแยกอิสระจากกัน (ไม่ใช้ Promise.all ตรงๆ) — เดิมถ้ามีปลายทางเดียวใน
   * รายชื่อพิมพ์ userId ผิด/เป็น LINE ID แทน userId จริง (เจอจริงบน production — รายชื่อ "B" ตั้งเป็น
   * "bnmr26" ซึ่ง LINE ตอบ 400 "The property, 'to', in the request body is invalid") Promise.all จะ
   * reject ทั้งก้อนทันที ทั้งที่คนอื่นในรายชื่อได้รับข้อความไปแล้วจริง (ส่งไม่ได้ย้อนกลับ) ผลคือระบบ
   * มองว่า "ส่งไม่สำเร็จ" ทั้งที่มีคนเห็นข้อความจริง แล้วไม่สร้าง cycle_approvals/ไม่ปิดงานต่อเนื่องเลย
   * ตอนนี้ถือว่าสำเร็จถ้ามีอย่างน้อยหนึ่งคนได้รับ ส่วนคนที่ส่งไม่ได้ยังโผล่ใน failed ให้ตามแก้รายชื่อทีหลัง
   */
  async pushToAll(list, messages) {
    const results = await Promise.allSettled(list.map((to) => this.call('/message/push', { to, messages })));
    const sentTo = list.filter((_, i) => results[i].status === 'fulfilled');
    const failed = list
      .map((to, i) => (results[i].status === 'rejected' ? { to, error: results[i].reason?.message ?? String(results[i].reason) } : null))
      .filter(Boolean);
    if (sentTo.length === 0) {
      throw new LineError(
        `ส่งเข้า LINE ไม่สำเร็จเลยสักคน — ${failed.map((f) => `${f.to}: ${f.error}`).join(' · ')}`,
        { status: 502, body: failed },
      );
    }
    return { sentTo, failed };
  }

  /** ปลายทางที่จะส่งจริง — รายชื่อจากหน้าจัดการระบบมาก่อน ไม่มีค่อยตกไปใช้ค่าใน .env */
  resolveTargets(targets, emptyMessage) {
    const list = targets?.length ? targets : (this.to ? [this.to] : []);
    if (!list.length) throw new LineError(emptyMessage, { status: 400 });
    return list;
  }

  /** ตอบกลับสั้นๆ ยืนยันว่าระบบรับคำสั่งแล้ว — ใช้ replyToken จาก event เดิม ใช้ได้ครั้งเดียว
   *  quickReply ใส่ได้ตอนอยากโชว์ปุ่มลัดใต้ข้อความ (ดู EMPLOYEE_QUICK_REPLY) — ไม่ใส่ก็ได้ตามเดิม */
  async reply(replyToken, text, quickReply) {
    const message = { type: 'text', text };
    if (quickReply) message.quickReply = quickReply;
    return this.call('/message/reply', { replyToken, messages: [message] });
  }

  /** เหมือน reply() แต่ส่งเป็น Flex bubble/carousel แทนข้อความล้วน — ใช้ตอบคำสั่ง "สถานะ" ของพนักงาน */
  async replyFlex(replyToken, altText, contents, quickReply) {
    const message = { type: 'flex', altText, contents };
    if (quickReply) message.quickReply = quickReply;
    return this.call('/message/reply', { replyToken, messages: [message] });
  }

  /**
   * ส่งข้อความหา userId คนเดียวตรงๆ — ต่างจาก pushPlainText/pushNeedsCheck ที่ส่งเข้ารายชื่อ
   * ผู้รับแจ้งเตือนฝ่ายบัญชี (targets) เสมอ ใช้กับแจ้งเตือนสถานะ Timesheet ส่วนตัวของพนักงานแต่ละคน
   * (1 ก.ย. 69 ตามที่ขอ) — เงียบไม่ throw ถ้ายังไม่ได้ผูกบัญชีไลน์ (userId ว่าง) เรียกได้โดยไม่ต้องเช็คก่อนทุกที่
   */
  async pushToUser(userId, text, quickReply) {
    if (!userId) return null;
    const message = { type: 'text', text };
    if (quickReply) message.quickReply = quickReply;
    return this.call('/message/push', { to: userId, messages: [message] });
  }

  /** เหมือน pushToUser() แต่ส่งเป็น Flex bubble แทนข้อความล้วน — ใช้กับการ์ดสถานะ/ตีกลับส่วนตัว */
  async pushFlexToUser(userId, altText, contents, quickReply) {
    if (!userId) return null;
    const message = { type: 'flex', altText, contents };
    if (quickReply) message.quickReply = quickReply;
    return this.call('/message/push', { to: userId, messages: [message] });
  }

  /**
   * ส่งข้อความธรรมดา ไม่มีปุ่ม ให้ **ทุกคน** ในรายชื่อผู้รับแจ้งเตือนช่องทาง LINE (targets)
   * ใช้แจ้งเตือนที่ไม่ต้องมีคนกดตอบ (ข้อ 2.6 แจ้งทีมเมื่อ Manday ไม่ผ่าน)
   */
  async pushPlainText(text, { targets } = {}) {
    const list = this.resolveTargets(
      targets,
      'ยังไม่มีปลายทาง LINE ให้แจ้งเตือน — เพิ่มผู้รับแจ้งเตือนช่องทาง LINE ไว้ก่อน',
    );
    await Promise.all(list.map((to) => this.call('/message/push', { to, messages: [{ type: 'text', text }] })));
    return { sentTo: list };
  }
}

function baht(amount) {
  return new Intl.NumberFormat('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    .format(amount ?? 0);
}

function summaryRow(label, value) {
  return {
    type: 'box',
    layout: 'baseline',
    contents: [
      { type: 'text', text: label, size: 'sm', color: '#77839A', flex: 2 },
      { type: 'text', text: value, size: 'sm', flex: 3, align: 'end', weight: 'bold', wrap: true },
    ],
  };
}

/* สีประจำแต่ละเรื่อง — คนละสีกันเพื่อให้แยกออกตั้งแต่เหลือบเห็นในรายการแชท ไม่ต้องอ่านหัวข้อก่อน
   เดิมใช้สีน้ำเงินทั้งคู่ เลื่อนผ่านแล้วดูเหมือนข้อความเดียวกันซ้ำสองครั้ง
     BRAND  น้ำเงิน = เรื่องเงิน/วางบิล (ตรงกับสีหลักของเว็บ)
     TEAL   เขียวเข้ม = เรื่องตรวจสอบ/คิวงานที่รอคนทำ */
const BRAND = '#0078D4';
const SKY = '#5AC8FA';
const TEAL = '#1B998B';
const MINT = '#5FE3C9';
const RED = '#BA1A1A';
const PINK = '#F08A8A';
const GREEN = '#067647';
const LIME = '#4CD988';

/* คู่สีไล่อ่อน→เข้มของแต่ละกลุ่มเรื่อง ใช้กับทั้งแถบหัวการ์ดและปุ่ม ให้เป็นชุดเดียวกันทั้งใบ
   (8 ก.ย. 69 ตามที่ขอ "ไล่สีอ่อนสีเข้มสวยๆ เหมือน Timesheet ยังไม่ส่ง" ทั่วทุกการ์ด) */
const GRADIENT = {
  blue: { startColor: SKY, endColor: BRAND },
  teal: { startColor: MINT, endColor: TEAL },
  red: { startColor: PINK, endColor: RED },
  green: { startColor: LIME, endColor: GREEN },
};

/**
 * โครงบับเบิลกลางของทุกการแจ้งเตือน — แถบหัวสีประจำเรื่อง + ชื่อลูกค้า/โครงการ + แถวรายละเอียด + ปุ่ม
 * ให้ทุกข้อความที่เด้งเข้า LINE วางโครงชุดเดียวกัน คนอ่านจำรูปแบบได้ ไม่ต้องอ่านใหม่ทุกครั้ง
 * ไม่มีปุ่มก็ไม่ใส่ footer เลย (LINE ไม่รับ footer ที่ contents ว่าง)
 */
function bubble({
  title, customerName, projectName, rows, buttons = [], color = BRAND, footerLayout = 'horizontal',
  headerGradient = null,
}) {
  return {
    type: 'bubble',
    header: {
      type: 'box',
      layout: 'vertical',
      paddingAll: '16px',
      ...(headerGradient
        ? { background: { type: 'linearGradient', angle: '135deg', ...headerGradient } }
        : { backgroundColor: color }),
      contents: [{ type: 'text', text: title, color: '#FFFFFF', weight: 'bold', size: 'md' }],
    },
    body: {
      type: 'box',
      layout: 'vertical',
      spacing: 'sm',
      paddingAll: '16px',
      contents: [
        { type: 'text', text: customerName, weight: 'bold', size: 'lg', wrap: true },
        ...(projectName ? [{ type: 'text', text: projectName, size: 'sm', color: '#77839A', wrap: true }] : []),
        { type: 'separator', margin: 'md' },
        ...rows,
      ],
    },
    ...(buttons.length
      ? {
        footer: {
          type: 'box',
          layout: footerLayout,
          spacing: 'sm',
          paddingAll: '16px',
          contents: buttons,
        },
      }
      : {}),
  };
}

/** ปุ่มกดแล้วเปิดเว็บระบบ — ปุ่มหลักของทุกบับเบิล พาไปหน้าที่ต้องทำงานต่อโดยตรง
 *  สีเดียวกับแถบหัวเสมอ ทั้งใบจะได้เป็นชุดสีเดียว ไม่ใช่หัวสีหนึ่งปุ่มอีกสีหนึ่ง */
function linkButton(label, uri, color = BRAND) {
  return { type: 'button', style: 'primary', color, height: 'sm', action: { type: 'uri', label, uri } };
}

/**
 * ปุ่มไล่สีอ่อน→เข้ม (8 ก.ย. 69 ตามที่ขอ "ปุ่มด้วย ไล่สีเข้มอ่อนให้สวยๆ") — LINE Flex ปุ่ม native
 * (type: 'button') รับได้แค่สีทึบสีเดียว ไม่รองรับ gradient เลย ต้องสร้างเป็น box ที่ผูก action ของตัวเอง
 * โดยตรงแทน (เหมือน choiceRow) ถึงจะใส่ background: linearGradient ได้ — ใช้แทน linkButton() ได้ทุกที่
 * ที่อยากได้ปุ่มไล่สี ไม่ว่า action จะเป็น uri หรือ postback ก็ตาม
 */
function gradientButton(label, action, gradient = GRADIENT.blue) {
  return {
    type: 'box', layout: 'vertical', action, paddingAll: '12px', cornerRadius: '10px',
    justifyContent: 'center', alignItems: 'center',
    background: { type: 'linearGradient', angle: '135deg', ...gradient },
    contents: [{ type: 'text', text: label, color: '#FFFFFF', weight: 'bold', size: 'md', align: 'center' }],
  };
}

function gradientLinkButton(label, uri, gradient = GRADIENT.blue) {
  return gradientButton(label, { type: 'uri', label, uri }, gradient);
}

export function buildApprovalFlex({
  contractId, period, customerName, projectName, periodLabel, headcount, paymentAmount,
  approveUrl = null,
}) {
  /* มี APP_BASE_URL ตั้งไว้ → ปุ่มเดียวพาเข้าหน้า "วางบิล & ร่างอีเมล" ของรอบนั้นเลย
     ให้คนเห็นตัวเลขเต็มๆกับร่างอีเมลก่อนตัดสินใจ ไม่ใช่กดอนุมัติจากในแชทโดยเห็นแค่ยอดรวม
     ไม่ได้ตั้งไว้ → ไม่มี URL ให้กดเข้าเว็บ ตกกลับไปใช้ปุ่มอนุมัติ/ตีกลับในแชทแบบเดิม
     (ทางฝั่งรับ postback ยังอยู่ครบ ดู parseApprovalPostback / service.processLineWebhook) */
  const buttons = approveUrl
    ? [gradientLinkButton('อนุมัติวางบิล', approveUrl, GRADIENT.blue)]
    : [
      gradientButton(
        'อนุมัติ',
        { type: 'postback', label: 'อนุมัติ', data: buildApprovalPostback('approve', contractId, period) },
        GRADIENT.green,
      ),
      {
        type: 'button',
        style: 'secondary',
        height: 'sm',
        action: { type: 'postback', label: 'ตีกลับ', data: buildApprovalPostback('reject', contractId, period) },
      },
    ];

  return bubble({
    title: 'ขออนุมัติวางบิล',
    customerName,
    projectName,
    headerGradient: GRADIENT.blue,
    rows: [
      summaryRow('รอบบิล', periodLabel),
      summaryRow('จำนวนพนักงาน', `${headcount} คน`),
      summaryRow('ยอดรับชำระ', `${baht(paymentAmount)} บาท`),
    ],
    buttons,
  });
}

/**
 * บับเบิล "ตรวจ Manday" — หนึ่งใบต่อหนึ่งลูกค้า
 * ไล่เลขเอกสารทีละบรรทัด แล้วปิดท้ายด้วยรอบเดือน ปุ่มล่างพาเข้าหน้าคิวตรวจโดยตรง
 */
export function buildNeedsCheckFlex({ customerName, projectName, documentNos, periodLabel, queueUrl }) {
  return bubble({
    title: 'ตรวจ Manday',
    customerName,
    projectName,
    headerGradient: GRADIENT.teal,
    rows: [
      ...documentNos.map((no) => summaryRow('เลขเอกสาร', no)),
      summaryRow('ประจำเดือน', periodLabel),
    ],
    buttons: queueUrl ? [gradientLinkButton('ตรวจ Manday', queueUrl, GRADIENT.teal)] : [],
  });
}

/**
 * บับเบิลสถานะ Timesheet ส่วนตัวของพนักงาน — ตอบคำสั่ง "สถานะ" (ดู service.handleEmployeeLineMessage)
 * รับข้อมูลที่แปลง/จัดรูปแบบวันที่มาแล้วจากฝั่ง service.js (ไฟล์นี้ไม่รู้เรื่อง thaiDate/thaiMonth เอง
 * ตามแบบ buildApprovalFlex/buildNeedsCheckFlex ที่รับ label สำเร็จรูปเช่นกัน)
 *
 * ⚠️ ห้ามใส่ยอดเงิน/เงินเดือนในบับเบิลนี้เด็ดขาด (7 ก.ย. 69 ตามที่ขอ) — พนักงานเห็นได้แค่สถานะ/วันที่
 * เท่านั้น เรื่องเงินเป็นข้อมูลของฝ่ายบัญชี ไม่ใช่ของพนักงานเจ้าของ Timesheet
 */
export function buildEmployeeStatusFlex({ contracts, progressUrl }) {
  const bubbles = contracts.map((c) => bubble({
    title: 'สถานะ Timesheet ของฉัน',
    customerName: c.customerName,
    projectName: c.projectName,
    headerGradient: GRADIENT.teal,
    rows: [
      summaryRow('รอบปัจจุบัน', c.currentPeriodLabel),
      summaryRow('สถานะ', c.currentStatusLabel),
      ...(c.currentStatusDetail ? [summaryRow('รายละเอียด', c.currentStatusDetail)] : []),
      ...(c.recentPeriods?.length ? [{ type: 'separator', margin: 'md' }] : []),
      ...(c.recentPeriods ?? []).map((p) => summaryRow(p.periodLabel, p.badge)),
    ],
    buttons: progressUrl ? [gradientLinkButton('ดูรายละเอียดทุกรอบ', progressUrl, GRADIENT.teal)] : [],
  }));
  return bubbles.length === 1 ? bubbles[0] : { type: 'carousel', contents: bubbles };
}

/* วงกลมไอคอนแต่ละขั้นไล่สีอ่อน→เข้มด้วย (8 ก.ย. 69 ตามที่ขอ "มีมิติ มีความไล่สี") — ขั้นที่ยังไม่ถึง
   (future) เอาไอคอนนาฬิกาออกตามที่ขอ เหลือแค่วงกลมโปร่งขอบเทาเรียบๆ ไม่มีไอคอนข้างในเลย ดูสงบตาไม่รก */
const BILLING_STEP_STYLE = {
  done: { gradient: GRADIENT.teal, icon: '✓' },
  current: { gradient: GRADIENT.blue, icon: '●' },
  future: { gradient: null, icon: '' },
};

/** แถวหนึ่งขั้นตอนของ timeline วางบิล — วงกลมไอคอน + เส้นเชื่อมลงขั้นถัดไป (ไม่มีเส้นในขั้นสุดท้าย) +
 *  ชื่อขั้น/รายละเอียด/วันที่ ทางขวา */
function billingStepRow(step, index, isLast) {
  const style = BILLING_STEP_STYLE[step.state];
  const circle = style.gradient
    ? {
      type: 'box', layout: 'vertical', width: '24px', height: '24px', cornerRadius: '12px',
      background: { type: 'linearGradient', angle: '135deg', ...style.gradient },
      justifyContent: 'center', alignItems: 'center',
      contents: [{ type: 'text', text: style.icon, size: 'xs', color: '#FFFFFF', align: 'center', gravity: 'center' }],
    }
    : {
      type: 'box', layout: 'vertical', width: '24px', height: '24px', cornerRadius: '12px',
      backgroundColor: '#FFFFFF', borderColor: '#C7CDD6', borderWidth: 'medium',
      justifyContent: 'center', alignItems: 'center', contents: [{ type: 'text', text: ' ', size: 'xs' }],
    };
  return {
    type: 'box', layout: 'horizontal', spacing: 'md',
    contents: [
      { type: 'box', layout: 'vertical', width: '28px', alignItems: 'center',
        contents: [
          circle,
          ...(isLast ? [] : [{ type: 'box', layout: 'vertical', width: '2px', height: '28px', backgroundColor: '#D8DEE6', margin: 'xs', contents: [] }]),
        ] },
      { type: 'box', layout: 'vertical', flex: 1, paddingBottom: isLast ? '0px' : 'md',
        contents: [
          { type: 'box', layout: 'horizontal',
            contents: [
              { type: 'text', text: `${index + 1}. ${step.label}`, weight: 'bold', size: 'sm', flex: 1, wrap: true },
              ...(step.dateLabel ? [{ type: 'text', text: step.dateLabel, size: 'xs', color: '#77839A', align: 'end', gravity: 'center' }] : []),
            ] },
          { type: 'text', text: step.sub, size: 'xs', color: '#77839A', wrap: true, margin: 'xs' },
        ] },
    ],
  };
}

/**
 * บับเบิล "สถานะการวางบิลของฉัน" — ตอบคำสั่ง "สถานะการวางบิล" แยกจาก "สถานะ"/"สรุปรอบวางบิล" ปกติ (8 ก.ย.
 * 69 ตามที่ขอ, แบบ mockup) โชว์เป็น flow 5 ขั้นของรอบบิลปัจจุบัน (Timesheet → ตรวจ Manday → ออกใบแจ้งหนี้
 * → วางบิลส่งลูกค้า → รับชำระเงิน) พร้อม progress bar — รับ steps สำเร็จรูปจาก service.buildBillingCycleFlexInput
 *
 * ⚠️ ไม่มียอดเงินเช่นเดียวกับ buildEmployeeStatusFlex — ขั้นตอนที่ 5 (รับชำระเงิน) เป็นแค่วันที่คาดการณ์
 * (จาก due_date ของใบแจ้งหนี้) เพราะระบบไม่มีช่องยืนยันว่าลูกค้าโอนเงินจริงหรือยัง จึงไม่มีสถานะ "เสร็จ" ให้
 * ขั้นนี้เลย จะขึ้นเป็น "ขั้นตอนปัจจุบัน" เองก็ต่อเมื่อขั้น 1-4 เสร็จหมดแล้วเท่านั้น
 */
export function buildBillingCycleFlex({ contracts }) {
  const bubbles = contracts.map(billingCycleBubble);
  return bubbles.length === 1 ? bubbles[0] : { type: 'carousel', contents: bubbles };
}

function billingCycleBubble({ customerName, projectName, periodLabel, progressPercent, steps }) {
  const bar = {
    type: 'box', layout: 'vertical', height: '6px', backgroundColor: '#E2E6EB', cornerRadius: '3px', margin: 'md',
    contents: [
      {
        type: 'box', layout: 'vertical', height: '6px', width: `${progressPercent}%`, cornerRadius: '3px',
        background: { type: 'linearGradient', angle: '0deg', ...GRADIENT.teal }, contents: [],
      },
    ],
  };
  return bubble({
    title: 'สถานะการวางบิลของฉัน',
    customerName,
    projectName,
    headerGradient: GRADIENT.teal,
    rows: [
      summaryRow('รอบวางบิล', periodLabel),
      bar,
      { type: 'separator', margin: 'md' },
      ...steps.map((step, i) => billingStepRow(step, i, i === steps.length - 1)),
    ],
    buttons: [],
  });
}

/** บับเบิลแจ้งตีกลับส่วนตัว — เดิมส่งเป็นข้อความล้วนผ่าน pushToUser() (ดู service.pushEmployeeStatusUpdate)
 *  อัปเกรดเฉพาะเคสนี้เป็นการ์ดพร้อมปุ่ม เพราะเป็นเคสที่ต้องให้คนทำอะไรต่อจริง (ส่งฉบับแก้ไข) */
export function buildRejectedFlex({ customerName, projectName, periodLabel, reason, uploadUrl }) {
  return bubble({
    title: 'ตรวจ Manday ไม่ผ่าน • ตีกลับให้แก้ไข',
    customerName,
    projectName,
    color: RED,
    rows: [
      summaryRow('รอบที่ตีกลับ', periodLabel),
      ...(reason ? [summaryRow('เหตุผล', reason)] : []),
    ],
    buttons: uploadUrl ? [linkButton('ส่ง Timesheet ฉบับแก้ไข', uploadUrl, RED)] : [],
  });
}

/**
 * บับเบิลเตือน "Timesheet ยังไม่ส่ง" — ส่งซ้ำได้ทุกวันจนกว่าจะส่งจริง (ดู
 * service.sendOverdueTimesheetReminders) กติกาเดียวกันทุกคน: ต้องส่งภายใน 3 วันหลังสิ้นเดือน
 *
 * 4 ปุ่มให้เลือกวิธีส่ง (8 ก.ย. 69 ตามที่ขอ, แบบ mockup "2. Timesheet Submission Flow") — ทุกปุ่มเป็น
 * postback ไม่ใช่ URI แล้ว (เดิมมีปุ่มเดียวลิงก์ตรงไปหน้าอัปโหลด) เพราะแม้แต่ทาง "ส่งผ่านระบบ OBS" ก็ต้อง
 * เด้งการ์ดสรุปให้ดูก่อนค่อยลิงก์ออกจริง (ดู buildTimesheetObsRedirectFlex) — พนักงานกดเลือกได้ที่
 * service.handleTimesheetMethodPostback ไม่ได้ทำอะไรในไฟล์นี้เอง
 */
/**
 * แถวตัวเลือกแบบ list-item (ไอคอนสี่เหลี่ยม + label + ลูกศร ›) แทนปุ่ม native ธรรมดา (8 ก.ย. 69 ตามที่
 * ขอแก้ แบบ mockup "2. Timesheet Submission Flow") — เหตุผลที่ต้องทำเอง ไม่ใช้ type:'button' ปกติ: label
 * ยาว 3-4 ปุ่มถ้าวางแนวนอน (ค่าเริ่มต้นของ bubble()'s footer) จะถูกบีบจนตัดคำเหลือ "ส่ง..." (บั๊กที่เจอจริง
 * บน production) ทั้งแถวกดได้เพราะ box รองรับ action ของตัวเองตรงๆ ไม่ต้องพึ่ง type:'button' */
function choiceRow({ icon, label, iconBg, action }) {
  return {
    type: 'box', layout: 'horizontal', alignItems: 'center', spacing: 'md',
    paddingAll: '12px', backgroundColor: '#F3F5F8', cornerRadius: '12px', action,
    contents: [
      { type: 'box', layout: 'vertical', width: '32px', height: '32px', cornerRadius: '8px',
        backgroundColor: iconBg, justifyContent: 'center', alignItems: 'center', flex: 0,
        contents: [{ type: 'text', text: icon, size: 'sm', color: '#FFFFFF', align: 'center', gravity: 'center' }] },
      { type: 'text', text: label, weight: 'bold', size: 'sm', flex: 1, gravity: 'center', wrap: false, color: '#1A1A1A' },
    ],
  };
}

export function buildOverdueReminderFlex({ customerName, projectName, periodLabel, dueDate, contractId, period }) {
  const postback = (method) => buildTimesheetMethodPostback(method, contractId, period);
  return bubble({
    title: 'Timesheet ยังไม่ส่ง',
    customerName,
    projectName,
    headerGradient: { startColor: SKY, endColor: BRAND },
    rows: [
      summaryRow('รอบที่ต้องส่ง', periodLabel),
      summaryRow('กำหนดส่งภายใน', dueDate),
    ],
    footerLayout: 'vertical',
    buttons: [
      choiceRow({
        icon: '🖥️', label: 'ส่งผ่านระบบ OBS', iconBg: BRAND,
        action: { type: 'postback', label: 'ส่งผ่านระบบ OBS', data: postback('self_obs') },
      }),
      choiceRow({
        icon: '✉️', label: 'ส่งผ่าน Email', iconBg: '#77839A',
        action: { type: 'postback', label: 'ส่งผ่าน Email', data: postback('self_email') },
      }),
      choiceRow({
        icon: '👤', label: 'ให้ผู้ดูแลเป็นคนส่ง', iconBg: '#77839A',
        action: { type: 'postback', label: 'ให้ผู้ดูแลเป็นคนส่ง', data: postback('proxy_email') },
      }),
      {
        type: 'box', layout: 'vertical', alignItems: 'center', margin: 'sm',
        action: { type: 'postback', label: 'ส่งภายหลัง', data: postback('snooze') },
        contents: [{ type: 'text', text: 'ส่งภายหลัง (เตือนอีกครั้งพรุ่งนี้)', size: 'xs', color: '#77839A', decoration: 'underline' }],
      },
    ],
  });
}

/** การ์ดยืนยันหลังกด "ส่งผ่านระบบ OBS" — สรุปข้อมูลก่อนค่อยลิงก์ไปหน้าอัปโหลดจริง (แบบ mockup "ระบบส่ง
 *  Timesheet (OBS Portal)") uploadUrl มาจาก service.uploadLink() เดิม ไม่มีเงินอยู่แล้วเพราะเป็นแค่ข้อมูล
 *  พนักงาน/รอบบิล/ลูกค้า */
export function buildTimesheetObsRedirectFlex({ employeeName, customerName, projectName, periodLabel, uploadUrl }) {
  return bubble({
    title: 'ส่ง Timesheet ผ่านระบบ OBS',
    customerName,
    projectName,
    headerGradient: GRADIENT.blue,
    rows: [
      summaryRow('ชื่อพนักงาน', employeeName),
      summaryRow('รอบบิล Timesheet', periodLabel),
    ],
    buttons: uploadUrl ? [gradientLinkButton('Send Timesheet', uploadUrl, GRADIENT.blue)] : [],
  });
}

/** การ์ดยืนยันหลังกด "ส่งผ่าน Email" — บอกอีเมลปลายทางที่ตั้งไว้ในหน้า "จัดการระบบ" (channel: 'email' ใน
 *  notification_recipients ผ่าน service.notificationEmailTargets() — ทุกคน ไม่ใช่แค่คนแรก 9 ก.ย. 69
 *  ตามที่ขอ) ไม่ส่งอีเมลจริงจากระบบ แค่บอกพนักงานว่าต้องส่งไปที่ไหนเอง — emailTargets ว่างได้ถ้ายังไม่มีใคร
 *  ตั้งอีเมลไว้เลย ต้องมีข้อความ fallback */
export function buildTimesheetEmailConfirmFlex({ customerName, projectName, periodLabel, emailTargets }) {
  return bubble({
    title: 'บันทึกการส่งผ่าน Email เรียบร้อย',
    customerName,
    projectName,
    headerGradient: GRADIENT.teal,
    rows: [
      summaryRow('ผู้รับผิดชอบ', 'ฝ่ายบัญชีและการเงิน'),
      summaryRow('รอบบิล Timesheet', periodLabel),
      summaryRow(
        'Email',
        emailTargets?.length ? emailTargets.join(', ') : 'ยังไม่ได้ตั้งอีเมลปลายทางในระบบ',
      ),
    ],
    buttons: [],
  });
}

/** การ์ดยืนยันหลังกด "ให้ผู้ดูแลเป็นคนส่ง" — ไม่มีแนวคิด "ผู้ดูแลโครงการ/Supervisor" แยกในฐานข้อมูล
 *  จึงแจ้งเข้ารายชื่อฝ่ายบัญชี/แอดมินชุดเดียวกับ lineApproverTargets() (ดู
 *  service.handleTimesheetMethodPostback) ให้ไปกรอกแทนผ่านเมนู "กรอกเอง" ที่มีอยู่แล้ว */
export function buildTimesheetProxyConfirmFlex({ employeeName, customerName, projectName, periodLabel }) {
  return bubble({
    title: 'มอบหมายผู้ดูแลระบบเรียบร้อย',
    customerName,
    projectName,
    headerGradient: GRADIENT.teal,
    rows: [
      summaryRow('ชื่อพนักงาน', employeeName),
      summaryRow('รอบบิล / เดือนปี', periodLabel),
      { type: 'separator', margin: 'md' },
      {
        type: 'text', margin: 'md', wrap: true, size: 'sm', color: '#454545',
        text: 'ระบบได้ส่งการแจ้งเตือนไปยังฝ่ายดูแล เพื่อดำเนินการส่งและตรวจ Timesheet แทนคุณเรียบร้อยแล้ว',
      },
    ],
    buttons: [],
  });
}

/**
 * ปุ่มลัดใต้ข้อความบอตฝั่งพนักงาน (8 ก.ย. 69 ตามที่ขอ, แบบ mockup "1. Main Chat & Dashboard") — แตะแทน
 * พิมพ์ได้เลย ทุกปุ่มส่งข้อความจริงเข้าไป (type: 'message') จึงวิ่งผ่าน handleEmployeeLineMessage()
 * เหมือนพิมพ์เองทุกอย่าง ไม่ต้องมี logic แยก "สรุปรอบวางบิล"/"สถานะการวางบิล" เป็นคำพ้องของ "สถานะ"
 * (การ์ดเดียวกัน ไม่มียอดเงิน — ดู buildEmployeeStatusFlex)
 *
 * ⚠️ ห้ามแนบปุ่มชุดนี้กับข้อความที่ถามหา "รายละเอียดปัญหา" ต่อ (หลังเลือกหมวดแจ้งปัญหาแล้ว) เพราะ
 * ข้อความถัดไปจากพนักงาน (รวมถึงข้อความที่มาจากการแตะปุ่มลัด) จะถูกเก็บเป็นคำอธิบายปัญหาทันที
 * (ดู handleEmployeeLineMessage's line_pending_ticket_category check) — แตะ "สถานะ" ตอนนั้นจะกลายเป็น
 * ข้อความแจ้งปัญหาผิดๆ ไปโดยไม่ตั้งใจ
 */
export const EMPLOYEE_QUICK_REPLY = {
  items: [
    { type: 'action', action: { type: 'message', label: 'ส่ง Timesheet', text: 'ส่ง Timesheet' } },
    { type: 'action', action: { type: 'message', label: 'สรุปรอบวางบิล', text: 'สรุปรอบวางบิล' } },
    { type: 'action', action: { type: 'message', label: 'สถานะการวางบิล', text: 'สถานะการวางบิล' } },
    { type: 'action', action: { type: 'message', label: 'Help', text: 'Help' } },
  ],
};

/** หมวดปัญหาที่เลือกได้ — คีย์สั้นๆ เก็บลง DB, label ภาษาไทยใช้แสดงผลเท่านั้น (เปลี่ยนคำแปลทีหลังได้
 *  โดยไม่กระทบข้อมูลเก่า) ใช้ร่วมกันทั้งฝั่งสร้างการ์งและฝั่ง service.js (ดู TICKET_CATEGORIES ที่นั่น) */
export const TICKET_CATEGORIES = {
  bug: 'ระบบขัดข้อง (Bug)',
  manday: 'Manday ไม่ถูกต้อง',
  timesheet: 'Timesheet มีปัญหา',
  suggestion: 'ข้อเสนอแนะ',
};

/** บับเบิล "แจ้งปัญหา" — ให้เลือกหมวดก่อน ปุ่มเรียงแนวตั้งเพราะมี 4 ปุ่ม (มากกว่า bubble() ปกติที่ทำแค่
 *  1-2 ปุ่มแนวนอน) ไม่ใช้ bubble() ร่วม เขียนเองตรงๆ เพราะโครงปุ่มต่างจากที่อื่นในไฟล์นี้ */
export function buildTicketCategoryFlex() {
  return {
    type: 'bubble',
    header: {
      type: 'box', layout: 'vertical', backgroundColor: BRAND, paddingAll: '16px',
      contents: [{ type: 'text', text: 'แจ้งปัญหา', color: '#FFFFFF', weight: 'bold', size: 'md' }],
    },
    body: {
      type: 'box', layout: 'vertical', spacing: 'sm', paddingAll: '16px',
      contents: [
        { type: 'text', text: 'เลือกประเภทปัญหาที่พบ', size: 'sm', color: '#77839A', wrap: true },
        { type: 'separator', margin: 'md' },
      ],
    },
    footer: {
      type: 'box', layout: 'vertical', spacing: 'sm', paddingAll: '16px',
      contents: Object.entries(TICKET_CATEGORIES).map(([key, label]) => ({
        type: 'button', style: 'secondary', height: 'sm',
        action: { type: 'postback', label, data: buildTicketPostback('start', key) },
      })),
    },
  };
}

/** บับเบิลแจ้งฝ่ายบัญชี/admin ว่ามีตั๋วใหม่เข้ามา พร้อมปุ่มกดแก้แล้วได้ทันที
 *  (สิทธิ์กดจริงเช็คที่ service.processLineWebhook เหมือนปุ่มอนุมัติวางบิล — isAuthorizedApprover) */
export function buildTicketNotifyFlex({ employeeName, categoryLabel, description, ticketId }) {
  return bubble({
    title: 'แจ้งปัญหาใหม่',
    customerName: employeeName,
    projectName: categoryLabel,
    color: '#B36B00',
    rows: [
      summaryRow('เลขที่ตั๋ว', `#${ticketId}`),
      summaryRow('รายละเอียด', description),
    ],
    buttons: [{
      type: 'button', style: 'primary', color: '#067647', height: 'sm',
      action: { type: 'postback', label: 'ทำเครื่องหมายว่าแก้แล้ว', data: buildTicketPostback('resolve', ticketId) },
    }],
  });
}

function safeJson(text) {
  try { return JSON.parse(text); } catch { return { raw: text }; }
}

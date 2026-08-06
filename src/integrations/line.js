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
    await Promise.all(list.map((to) => this.call('/message/push', { to, messages })));
    return { sentTo: list };
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
    await Promise.all(list.map((to) => this.call('/message/push', { to, messages })));
    return { sentTo: list };
  }

  /** ปลายทางที่จะส่งจริง — รายชื่อจากหน้าจัดการระบบมาก่อน ไม่มีค่อยตกไปใช้ค่าใน .env */
  resolveTargets(targets, emptyMessage) {
    const list = targets?.length ? targets : (this.to ? [this.to] : []);
    if (!list.length) throw new LineError(emptyMessage, { status: 400 });
    return list;
  }

  /** ตอบกลับสั้นๆ ยืนยันว่าระบบรับคำสั่งแล้ว — ใช้ replyToken จาก event เดิม ใช้ได้ครั้งเดียว */
  async reply(replyToken, text) {
    return this.call('/message/reply', { replyToken, messages: [{ type: 'text', text }] });
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
const TEAL = '#1B998B';

/**
 * โครงบับเบิลกลางของทุกการแจ้งเตือน — แถบหัวสีประจำเรื่อง + ชื่อลูกค้า/โครงการ + แถวรายละเอียด + ปุ่ม
 * ให้ทุกข้อความที่เด้งเข้า LINE วางโครงชุดเดียวกัน คนอ่านจำรูปแบบได้ ไม่ต้องอ่านใหม่ทุกครั้ง
 * ไม่มีปุ่มก็ไม่ใส่ footer เลย (LINE ไม่รับ footer ที่ contents ว่าง)
 */
function bubble({ title, customerName, projectName, rows, buttons = [], color = BRAND }) {
  return {
    type: 'bubble',
    header: {
      type: 'box',
      layout: 'vertical',
      backgroundColor: color,
      paddingAll: '16px',
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
          layout: 'horizontal',
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

export function buildApprovalFlex({
  contractId, period, customerName, projectName, periodLabel, headcount, paymentAmount,
  approveUrl = null,
}) {
  /* มี APP_BASE_URL ตั้งไว้ → ปุ่มเดียวพาเข้าหน้า "วางบิล & ร่างอีเมล" ของรอบนั้นเลย
     ให้คนเห็นตัวเลขเต็มๆกับร่างอีเมลก่อนตัดสินใจ ไม่ใช่กดอนุมัติจากในแชทโดยเห็นแค่ยอดรวม
     ไม่ได้ตั้งไว้ → ไม่มี URL ให้กดเข้าเว็บ ตกกลับไปใช้ปุ่มอนุมัติ/ตีกลับในแชทแบบเดิม
     (ทางฝั่งรับ postback ยังอยู่ครบ ดู parseApprovalPostback / service.processLineWebhook) */
  const buttons = approveUrl
    ? [linkButton('อนุมัติวางบิล', approveUrl)]
    : [
      {
        type: 'button',
        style: 'primary',
        color: '#067647',
        height: 'sm',
        action: { type: 'postback', label: 'อนุมัติ', data: buildApprovalPostback('approve', contractId, period) },
      },
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
    color: TEAL,
    rows: [
      ...documentNos.map((no) => summaryRow('เลขเอกสาร', no)),
      summaryRow('ประจำเดือน', periodLabel),
    ],
    buttons: queueUrl ? [linkButton('ตรวจ Manday', queueUrl, TEAL)] : [],
  });
}

function safeJson(text) {
  try { return JSON.parse(text); } catch { return { raw: text }; }
}

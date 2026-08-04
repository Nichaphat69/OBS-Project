/**
 * ตัวเชื่อม LINE Messaging API — ประตูมนุษย์ของขั้น 4.2
 *
 *   ขาออก  ส่ง Flex Message สรุปรอบบิล + ปุ่ม "อนุมัติ"/"ตีกลับ" เข้าแชทที่ตั้งไว้
 *   ขาเข้า  รับ webhook ตอนคนกดปุ่ม (ดู service.processLineWebhook ที่เรียกฟังก์ชันจากไฟล์นี้)
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
    contractId, period, customerName, projectName, periodLabel, headcount, paymentAmount, targets,
  }) {
    const list = targets?.length ? targets : (this.to ? [this.to] : []);
    if (!list.length) {
      throw new LineError(
        'ยังไม่มีปลายทาง LINE ให้ส่งขออนุมัติ — เพิ่มผู้รับแจ้งเตือนช่องทาง LINE ไว้ที่หน้าจัดการระบบก่อน',
        { status: 400 },
      );
    }
    const flex = buildApprovalFlex({
      contractId, period, customerName, projectName, periodLabel, headcount, paymentAmount,
    });
    const messages = [
      { type: 'flex', altText: `ขออนุมัติวางบิล ${customerName} รอบ ${periodLabel}`, contents: flex },
    ];
    await Promise.all(list.map((to) => this.call('/message/push', { to, messages })));
    return { sentTo: list };
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
    const list = targets?.length ? targets : (this.to ? [this.to] : []);
    if (!list.length) {
      throw new LineError('ยังไม่มีปลายทาง LINE ให้แจ้งเตือน — เพิ่มผู้รับแจ้งเตือนช่องทาง LINE ไว้ก่อน', { status: 400 });
    }
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

function buildApprovalFlex({
  contractId, period, customerName, projectName, periodLabel, headcount, paymentAmount,
}) {
  return {
    type: 'bubble',
    header: {
      type: 'box',
      layout: 'vertical',
      backgroundColor: '#0078D4',
      paddingAll: '16px',
      contents: [{ type: 'text', text: 'ขออนุมัติวางบิล', color: '#FFFFFF', weight: 'bold', size: 'md' }],
    },
    body: {
      type: 'box',
      layout: 'vertical',
      spacing: 'sm',
      paddingAll: '16px',
      contents: [
        { type: 'text', text: customerName, weight: 'bold', size: 'lg', wrap: true },
        { type: 'text', text: projectName, size: 'sm', color: '#77839A', wrap: true },
        { type: 'separator', margin: 'md' },
        summaryRow('รอบบิล', periodLabel),
        summaryRow('จำนวนพนักงาน', `${headcount} คน`),
        summaryRow('ยอดรับชำระ', `${baht(paymentAmount)} บาท`),
      ],
    },
    footer: {
      type: 'box',
      layout: 'horizontal',
      spacing: 'sm',
      paddingAll: '16px',
      contents: [
        {
          type: 'button',
          style: 'primary',
          color: '#067647',
          action: { type: 'postback', label: 'อนุมัติ', data: buildApprovalPostback('approve', contractId, period) },
        },
        {
          type: 'button',
          style: 'secondary',
          action: { type: 'postback', label: 'ตีกลับ', data: buildApprovalPostback('reject', contractId, period) },
        },
      ],
    },
  };
}

function safeJson(text) {
  try { return JSON.parse(text); } catch { return { raw: text }; }
}

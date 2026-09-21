/**
 * ตัวเชื่อม LINE Messaging API — ported from src/integrations/line.js.
 *
 * Covers: signature verification, all four postback codecs (`approve`/`reject` billing-approval,
 * `ticket:`, `tsmethod:`, and the employee-status ones ported in 5.5.4), the employee quick-reply,
 * and every flex builder + LineClient push/reply method the ported features need — including the
 * billing-approval gate (`buildApprovalFlex`/`pushApprovalRequest`, Phase 5.6) and the
 * "ตรวจ Manday" queue notification (`buildNeedsCheckFlex`/`pushNeedsCheck`, Phase 5.6).
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import { loggedFetch } from './apiActivityLog.js';

const API = 'https://api.line.me/v2/bot';

export class LineError extends Error {
  status: number | null;
  body: unknown;
  constructor(message: string, { status = null, body = null }: { status?: number | null; body?: unknown } = {}) {
    super(message);
    this.name = 'LineError';
    this.status = status;
    this.body = body;
  }
}

export function hasLineCredentials(): boolean {
  return Boolean(process.env.LINE_CHANNEL_ACCESS_TOKEN && process.env.LINE_CHANNEL_SECRET);
}

/** basicId ของ OA แทบไม่เปลี่ยนเลยตลอดอายุ channel — cache ไว้ในโปรเซสกันยิง GET /info ซ้ำทุกครั้งที่
 * พนักงานเปิดหน้า onboarding (cache ข้าม request ได้ปลอดภัยเพราะ endpoint นี้ไม่มี query param ต่างกัน) */
let cachedAddFriendUrl: Promise<string> | null = null;

export async function getLineAddFriendUrl(client: LineClient = new LineClient()): Promise<string> {
  if (!cachedAddFriendUrl) {
    cachedAddFriendUrl = client
      .getBotInfo()
      // LINE คืน basicId มาพร้อม "@" อยู่แล้ว (เช่น "@278pbetd") — ตัดออกก่อนแล้วเติมกลับเองให้แน่ใจ
      // ว่าไม่ซ้ำ ไม่งั้น encodeURIComponent จะแปลง "@" เป็น "%40" จนลิงก์ใช้ไม่ได้
      .then(({ basicId }) => `https://line.me/R/ti/p/@${basicId.replace(/^@/, '')}?openExternalBrowser=1`)
      .catch((error) => {
        cachedAddFriendUrl = null; // อย่า cache ผลที่ error ไว้ ให้ลองใหม่ครั้งหน้า
        throw error;
      });
  }
  return cachedAddFriendUrl;
}

function approverIds(): string[] {
  return (process.env.LINE_APPROVER_USER_IDS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

/** ตรวจว่า userId ที่กดปุ่มมา อยู่ในรายชื่อที่อนุญาตให้จัดการตั๋ว/อนุมัติหรือไม่ — ยังไม่ตั้งรายชื่อ = ปิดไว้ก่อนทั้งหมด */
export function isAuthorizedApprover(userId: string | null | undefined): boolean {
  if (!userId) return false;
  const allow = approverIds();
  return allow.length > 0 && allow.includes(userId);
}

/** ตรวจลายเซ็น LINE — HMAC-SHA256 ของ raw body ด้วย Channel Secret เข้ารหัส base64 ต้องใช้ raw body
 * ตัวที่ยังไม่ผ่าน JSON.parse เท่านั้น ไม่งั้นลายเซ็นไม่ตรง */
export function verifyLineSignature(rawBody: Buffer | null | undefined, signature: string | null | undefined, channelSecret: string | null | undefined): boolean {
  if (!signature || !channelSecret || !rawBody) return false;
  const expected = createHmac('sha256', channelSecret).update(rawBody).digest('base64');
  const a = Buffer.from(expected);
  const b = Buffer.from(String(signature));
  return a.length === b.length && timingSafeEqual(a, b);
}

/** ข้อมูลที่ฝังไว้ในปุ่ม "อนุมัติ"/"ตีกลับ" — ตอนกดจะย้อนกลับมาที่ postback.data ของ webhook event
 * (ประตูอนุมัติวางบิลผ่าน LINE — ขั้น 4.2, ported from src/integrations/line.js) */
const APPROVAL_POSTBACK_RE = /^(approve|reject):(.+):(\d{4}-\d{2})$/;

export function buildApprovalPostback(action: 'approve' | 'reject', contractId: string, period: string): string {
  return `${action}:${contractId}:${period}`;
}

export function parseApprovalPostback(data: string | null | undefined): { decision: 'approved' | 'rejected'; contractId: string; period: string } | null {
  const m = APPROVAL_POSTBACK_RE.exec(String(data ?? ''));
  if (!m) return null;
  return { decision: m[1] === 'approve' ? 'approved' : 'rejected', contractId: m[2], period: m[3] };
}

/* คนละ prefix กับ postback อนุมัติวางบิล/เลือกวิธีส่ง Timesheet — ขึ้นต้น "ticket:" เสมอ
   action: 'start' (เลือกหมวดปัญหา, value = category) หรือ 'resolve' (value = ticket id) */
const TICKET_POSTBACK_RE = /^ticket:(start|resolve):(.+)$/;

export function buildTicketPostback(action: 'start' | 'resolve', value: string | number): string {
  return `ticket:${action}:${value}`;
}

export function parseTicketPostback(data: string | null | undefined): { action: string; value: string } | null {
  const m = TICKET_POSTBACK_RE.exec(String(data ?? ''));
  if (!m) return null;
  return { action: m[1], value: m[2] };
}

/* คนละ prefix กับ postback อื่นๆ ด้านบน (ขึ้นต้น "tsmethod:" เสมอ) — ตอบคำถาม "เลือกวิธีส่ง Timesheet"
   จากการ์ดเตือน Timesheet ยังไม่ส่ง self_obs/self_email/proxy_email ตรงกับค่า submission_method ที่มี
   อยู่แล้วในตาราง timesheets ส่วน snooze ไม่ใช่ submission_method จริง แค่ปุ่ม "ส่งภายหลัง" */
const TS_METHOD_POSTBACK_RE = /^tsmethod:(self_obs|self_email|proxy_email|snooze):(.+):(\d{4}-\d{2})$/;

export type TimesheetMethod = 'self_obs' | 'self_email' | 'proxy_email' | 'snooze';

export function buildTimesheetMethodPostback(method: TimesheetMethod, contractId: string, period: string): string {
  return `tsmethod:${method}:${contractId}:${period}`;
}

export function parseTimesheetMethodPostback(data: string | null | undefined): { method: TimesheetMethod; contractId: string; period: string } | null {
  const m = TS_METHOD_POSTBACK_RE.exec(String(data ?? ''));
  if (!m) return null;
  return { method: m[1] as TimesheetMethod, contractId: m[2], period: m[3] };
}

interface QuickReply {
  items: Array<{ type: 'action'; action: { type: 'message'; label: string; text: string } }>;
}

export class LineClient {
  private token?: string;
  private fetchImpl: typeof fetch;

  constructor({ channelAccessToken = process.env.LINE_CHANNEL_ACCESS_TOKEN, fetchImpl = globalThis.fetch }: { channelAccessToken?: string; fetchImpl?: typeof fetch } = {}) {
    this.token = channelAccessToken;
    this.fetchImpl = fetchImpl;
  }

  async call(path: string, body: unknown, { method = 'POST' }: { method?: string } = {}): Promise<any> {
    if (!this.token) {
      throw new LineError('ยังไม่ได้เชื่อมต่อ LINE — ใส่ LINE_CHANNEL_ACCESS_TOKEN ใน .env', { status: 400 });
    }
    const response = await loggedFetch(
      'line',
      `${API}${path}`,
      {
        method,
        headers: {
          Authorization: `Bearer ${this.token}`,
          ...(method === 'GET' ? {} : { 'Content-Type': 'application/json' }),
        },
        ...(method === 'GET' ? {} : { body: JSON.stringify(body) }),
      },
      this.fetchImpl,
    );
    const text = await response.text();
    const parsed = text ? safeJson(text) : null;
    if (!response.ok) {
      throw new LineError(`เรียก LINE API ไม่สำเร็จ (${path})`, { status: response.status, body: parsed });
    }
    return parsed;
  }

  /** ชื่อที่แสดงของคนที่เคยทักบอทมาแล้ว — คืน null ถ้าบล็อกบอท/เลิกเป็นเพื่อนแล้ว (LINE ตอบ 404) ไม่ถือเป็น error */
  async getProfile(userId: string): Promise<{ displayName?: string } | null> {
    try {
      return await this.call(`/profile/${encodeURIComponent(userId)}`, null, { method: 'GET' });
    } catch (error) {
      if (error instanceof LineError && error.status === 404) return null;
      throw error;
    }
  }

  /** ข้อมูล OA (basicId ใช้สร้างลิงก์แอดเพื่อน) — ตรงกับที่เคยยิงทดสอบ GET /v2/bot/info มาก่อน */
  async getBotInfo(): Promise<{ basicId: string; displayName?: string }> {
    return this.call('/info', null, { method: 'GET' });
  }

  async pushToAll(list: string[], messages: unknown[]): Promise<{ sentTo: string[]; failed: Array<{ to: string; error: string }> }> {
    const results = await Promise.allSettled(list.map((to) => this.call('/message/push', { to, messages })));
    const sentTo = list.filter((_, i) => results[i].status === 'fulfilled');
    const failed = list
      .map((to, i) => (results[i].status === 'rejected' ? { to, error: (results[i] as PromiseRejectedResult).reason?.message ?? String((results[i] as PromiseRejectedResult).reason) } : null))
      .filter((x): x is { to: string; error: string } => x !== null);
    if (sentTo.length === 0) {
      throw new LineError(`ส่งเข้า LINE ไม่สำเร็จเลยสักคน — ${failed.map((f) => `${f.to}: ${f.error}`).join(' · ')}`, { status: 502, body: failed });
    }
    return { sentTo, failed };
  }

  resolveTargets(targets: string[] | undefined, emptyMessage: string): string[] {
    const list = targets?.length ? targets : [];
    if (!list.length) throw new LineError(emptyMessage, { status: 400 });
    return list;
  }

  async reply(replyToken: string, text: string, quickReply?: QuickReply): Promise<any> {
    const message: any = { type: 'text', text };
    if (quickReply) message.quickReply = quickReply;
    return this.call('/message/reply', { replyToken, messages: [message] });
  }

  async replyFlex(replyToken: string, altText: string, contents: unknown, quickReply?: QuickReply): Promise<any> {
    const message: any = { type: 'flex', altText, contents };
    if (quickReply) message.quickReply = quickReply;
    return this.call('/message/reply', { replyToken, messages: [message] });
  }

  /** ส่งข้อความหา userId คนเดียวตรงๆ — เงียบไม่ throw ถ้ายังไม่ได้ผูกบัญชีไลน์ (userId ว่าง) */
  async pushToUser(userId: string | null | undefined, text: string, quickReply?: QuickReply): Promise<any> {
    if (!userId) return null;
    const message: any = { type: 'text', text };
    if (quickReply) message.quickReply = quickReply;
    return this.call('/message/push', { to: userId, messages: [message] });
  }

  async pushFlexToUser(userId: string | null | undefined, altText: string, contents: unknown, quickReply?: QuickReply): Promise<any> {
    if (!userId) return null;
    const message: any = { type: 'flex', altText, contents };
    if (quickReply) message.quickReply = quickReply;
    return this.call('/message/push', { to: userId, messages: [message] });
  }

  /** ส่งสรุปรอบบิล + ปุ่มอนุมัติ/ตีกลับ เข้า LINE — ส่งให้ **ทุกคน** ในรายชื่อผู้รับแจ้งเตือนช่องทาง LINE
   * (targets) ไม่ใช่แค่คนแรก ใครก็ตามในรายชื่อกดปุ่มอนุมัติ/ตีกลับได้ (ยังต้องอยู่ใน
   * LINE_APPROVER_USER_IDS ด้วย — ดู isAuthorizedApprover) แต่ละคนได้รับข้อความเดียวกันแยกกัน ไม่รอผล
   * ตรงนี้ — คนกดปุ่มแล้ว LINE จะยิง webhook กลับมาต่างหาก */
  async pushApprovalRequest({
    contractId,
    period,
    customerName,
    projectName,
    periodLabel,
    headcount,
    paymentAmount,
    approveUrl = null,
    targets,
  }: {
    contractId: string;
    period: string;
    customerName: string;
    projectName?: string | null;
    periodLabel: string;
    headcount: number;
    paymentAmount: number | null;
    approveUrl?: string | null;
    targets?: string[];
  }): Promise<{ sentTo: string[]; failed: Array<{ to: string; error: string }> }> {
    const list = this.resolveTargets(targets, 'ยังไม่มีปลายทาง LINE ให้ส่งขออนุมัติ — เพิ่มผู้รับแจ้งเตือนช่องทาง LINE ไว้ที่หน้าจัดการระบบก่อน');
    const flex = buildApprovalFlex({ contractId, period, customerName, projectName, periodLabel, headcount, paymentAmount, approveUrl });
    const messages = [{ type: 'flex', altText: `ขออนุมัติวางบิล ${customerName} รอบ ${periodLabel}`, contents: flex }];
    return this.pushToAll(list, messages);
  }

  /** แจ้งว่ามี Timesheet รออยู่ในคิว "ตรวจ Manday" — บับเบิลหน้าตาเดียวกับคำขออนุมัติวางบิล มีปุ่มกดเข้า
   * หน้าตรวจได้เลย รับมาเป็นหลายบับเบิล (กลุ่มละลูกค้า) เกินหนึ่งจะส่งเป็น carousel เลื่อนดูได้ในฟองเดียว */
  async pushNeedsCheck({ bubbles, altText, targets }: { bubbles: unknown[]; altText: string; targets?: string[] }): Promise<{ sentTo: string[]; failed: Array<{ to: string; error: string }> }> {
    if (!bubbles?.length) return { sentTo: [], failed: [] };
    const list = this.resolveTargets(targets, 'ยังไม่มีปลายทาง LINE ให้แจ้งเตือน — เพิ่มผู้รับแจ้งเตือนช่องทาง LINE ไว้ก่อน');
    const contents = bubbles.length === 1 ? bubbles[0] : { type: 'carousel', contents: bubbles };
    const messages = [{ type: 'flex', altText, contents }];
    return this.pushToAll(list, messages);
  }

  /** ส่งข้อความธรรมดา ไม่มีปุ่ม ให้ **ทุกคน** ในรายชื่อผู้รับแจ้งเตือนช่องทาง LINE (targets) — ใช้แจ้งเตือน
   * ที่ไม่ต้องมีคนกดตอบ (เช่น Manday ไม่ผ่านตรวจตอนอ่านไฟล์เข้าระบบ) */
  async pushPlainText(text: string, { targets }: { targets?: string[] } = {}): Promise<{ sentTo: string[] }> {
    const list = this.resolveTargets(targets, 'ยังไม่มีปลายทาง LINE ให้แจ้งเตือน — เพิ่มผู้รับแจ้งเตือนช่องทาง LINE ไว้ก่อน');
    await Promise.all(list.map((to) => this.call('/message/push', { to, messages: [{ type: 'text', text }] })));
    return { sentTo: list };
  }

  /** เวอร์ชันทั่วไปของ pushNeedsCheck — ส่ง Flex bubble เดียว (ไม่ทำ carousel) ให้ทุกคนในรายชื่อผู้รับ
   * แจ้งเตือน ใช้แทน pushPlainText ทุกจุดที่อยากได้กล่อง gradient แทนข้อความธรรมดาไม่มีกล่อง (17 ก.ย. 69
   * ตามที่ user ขอ — ทุกการ์ดแจ้งเตือนต้องมีกล่อง ไม่ใช่ข้อความลอยๆ) */
  async pushFlexToAll(
    bubbleContents: unknown,
    altText: string,
    { targets }: { targets?: string[] } = {},
  ): Promise<{ sentTo: string[]; failed: Array<{ to: string; error: string }> }> {
    const list = this.resolveTargets(targets, 'ยังไม่มีปลายทาง LINE ให้แจ้งเตือน — เพิ่มผู้รับแจ้งเตือนช่องทาง LINE ไว้ก่อน');
    return this.pushToAll(list, [{ type: 'flex', altText, contents: bubbleContents }]);
  }
}

function summaryRow(label: string, value: string) {
  return {
    type: 'box',
    layout: 'baseline',
    contents: [
      { type: 'text', text: label, size: 'sm', color: '#77839A', flex: 2 },
      { type: 'text', text: value, size: 'sm', flex: 3, align: 'end', weight: 'bold', wrap: true },
    ],
  };
}

const BRAND = '#0078D4';
const SKY = '#5AC8FA';
const TEAL = '#1B998B';
const MINT = '#5FE3C9';
const GREEN = '#067647';
const LIME = '#4CD988';
const AMBER_LIGHT = '#FFC875';
const AMBER = '#B36B00';
const RED_LIGHT = '#FF8A80';
const RED = '#C0392B';

/* คู่สีไล่อ่อน→เข้มของแต่ละกลุ่มเรื่อง — ใช้กับทั้งแถบหัวการ์ดและปุ่ม ให้เป็นชุดเดียวกันทั้งใบ */
const GRADIENT = {
  blue: { startColor: SKY, endColor: BRAND },
  teal: { startColor: MINT, endColor: TEAL },
  green: { startColor: LIME, endColor: GREEN },
  amber: { startColor: AMBER_LIGHT, endColor: AMBER },
  red: { startColor: RED_LIGHT, endColor: RED },
};

function baht(amount: number | null | undefined): string {
  return new Intl.NumberFormat('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(amount ?? 0);
}

interface Gradient {
  startColor: string;
  endColor: string;
}

function bubble({
  title,
  customerName,
  projectName,
  rows,
  buttons = [],
  color = BRAND,
  footerLayout = 'horizontal',
  headerGradient = null,
}: {
  title: string;
  customerName: string;
  projectName?: string | null;
  rows: unknown[];
  buttons?: unknown[];
  color?: string;
  footerLayout?: string;
  headerGradient?: Gradient | null;
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
      ? { footer: { type: 'box', layout: footerLayout, spacing: 'sm', paddingAll: '16px', contents: buttons } }
      : {}),
  };
}

/** ปุ่มไล่สีอ่อน→เข้ม — LINE Flex ปุ่ม native (type:'button') รับได้แค่สีทึบสีเดียว ไม่รองรับ gradient
 * เลย ต้องสร้างเป็น box ที่ผูก action ของตัวเองแทนถึงจะใส่ background: linearGradient ได้ */
function gradientButton(label: string, action: unknown, gradient: Gradient = GRADIENT.blue) {
  return {
    type: 'box',
    layout: 'vertical',
    action,
    paddingAll: '12px',
    cornerRadius: '10px',
    justifyContent: 'center',
    alignItems: 'center',
    background: { type: 'linearGradient', angle: '135deg', ...gradient },
    contents: [{ type: 'text', text: label, color: '#FFFFFF', weight: 'bold', size: 'md', align: 'center' }],
  };
}

function gradientLinkButton(label: string, uri: string, gradient: Gradient = GRADIENT.blue) {
  return gradientButton(label, { type: 'uri', label, uri }, gradient);
}

/** ประตูอนุมัติวางบิลผ่าน LINE (ขั้น 4.2) — ported from src/integrations/line.js buildApprovalFlex().
 * มี APP_BASE_URL ตั้งไว้ → ปุ่มเดียวพาเข้าหน้า "วางบิล & ร่างอีเมล" ของรอบนั้นเลย ให้คนเห็นตัวเลขเต็มๆ
 * กับร่างอีเมลก่อนตัดสินใจ ไม่ใช่กดอนุมัติจากในแชทโดยเห็นแค่ยอดรวม — ไม่ได้ตั้งไว้ → ตกกลับไปใช้ปุ่ม
 * อนุมัติ/ตีกลับ postback ในแชทแบบเดิม (ฝั่งรับ postback ยังอยู่ครบ ดู parseApprovalPostback) */
export function buildApprovalFlex({
  contractId,
  period,
  customerName,
  projectName,
  periodLabel,
  headcount,
  paymentAmount,
  approveUrl = null,
}: {
  contractId: string;
  period: string;
  customerName: string;
  projectName?: string | null;
  periodLabel: string;
  headcount: number;
  paymentAmount: number | null;
  approveUrl?: string | null;
}) {
  const buttons = approveUrl
    ? [gradientLinkButton('อนุมัติวางบิล', approveUrl, GRADIENT.blue)]
    : [
        gradientButton('อนุมัติ', { type: 'postback', label: 'อนุมัติ', data: buildApprovalPostback('approve', contractId, period) }, GRADIENT.green),
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
    rows: [summaryRow('รอบบิล', periodLabel), summaryRow('จำนวนพนักงาน', `${headcount} คน`), summaryRow('ยอดรับชำระ', `${baht(paymentAmount)} บาท`)],
    buttons,
  });
}

/** บับเบิล "ตรวจ Manday" — หนึ่งใบต่อหนึ่งลูกค้า ไล่เลขเอกสารทีละบรรทัด แล้วปิดท้ายด้วยรอบเดือน ปุ่มล่าง
 * พาเข้าหน้าคิวตรวจโดยตรง — ported from src/integrations/line.js buildNeedsCheckFlex() */
export function buildNeedsCheckFlex({
  customerName,
  projectName,
  documentNos,
  periodLabel,
  queueUrl,
}: {
  customerName: string;
  projectName?: string | null;
  documentNos: string[];
  periodLabel: string;
  queueUrl?: string | null;
}) {
  return bubble({
    title: 'ตรวจ Manday',
    customerName,
    projectName,
    headerGradient: GRADIENT.teal,
    rows: [...documentNos.map((no) => summaryRow('เลขเอกสาร', no)), summaryRow('ประจำเดือน', periodLabel)],
    buttons: queueUrl ? [gradientLinkButton('ตรวจ Manday', queueUrl, GRADIENT.teal)] : [],
  });
}

/** บับเบิล "ตรวจ Manday ไม่ผ่าน" — เดิมเป็นข้อความธรรมดาไม่มีกล่อง (pushPlainText) ผ่าน notifyCheckFailed()
 * ใน ingestService.ts เปลี่ยนมาเป็นกล่อง gradient แดงให้เหมือนการ์ดแจ้งเตือนใบอื่นๆ ทั้งหมด (17 ก.ย. 69
 * ตามที่ user ขอ) — แสดงรายการที่ตรวจไม่ผ่านเป็นข้อความบรรทัดเดียวกัน (เดิมคั่นด้วย "\n• " ในข้อความ
 * ธรรมดา ตอนนี้ใช้ wrap:true แทนเพื่อให้ยาวได้หลายรายการโดยไม่ล้นกล่อง) */
export function buildCheckFailedFlex({
  employeeName,
  periodLabel,
  documentNo,
  failures,
  queueUrl,
}: {
  employeeName: string;
  periodLabel: string;
  documentNo: string;
  failures: string[];
  queueUrl?: string | null;
}) {
  return bubble({
    title: 'ตรวจ Manday ไม่ผ่าน',
    customerName: employeeName,
    headerGradient: GRADIENT.red,
    rows: [
      summaryRow('เลขที่เอกสาร', documentNo),
      summaryRow('ประจำเดือน', periodLabel),
      { type: 'separator', margin: 'md' },
      {
        type: 'text',
        margin: 'md',
        wrap: true,
        size: 'sm',
        color: '#454545',
        text: failures.map((f) => `• ${f}`).join('\n'),
      },
    ],
    buttons: queueUrl ? [gradientLinkButton('เข้าไปแก้ไข', queueUrl, GRADIENT.red)] : [],
  });
}

/** การ์ดแจ้งพนักงานเจ้าของใบว่า Timesheet ถูกตีกลับ — ส่งเข้าไลน์ส่วนตัว ไม่ใช่กลุ่มผู้อนุมัติ
 * ported from line.js buildRejectedFlex() (หัวการ์ดเป็นไล่สีแดงแบบเดียวกับการ์ดอื่นในพอร์ตนี้
 * แทนสีทึบ RED ของต้นฉบับ ตรงกับที่ buildCheckFailedFlex ทำไว้แล้ว) */
export function buildRejectedFlex({
  customerName,
  projectName,
  periodLabel,
  reason,
  uploadUrl,
}: {
  customerName: string;
  projectName?: string | null;
  periodLabel: string;
  reason?: string | null;
  uploadUrl?: string | null;
}) {
  return bubble({
    title: 'ตรวจ Manday ไม่ผ่าน • ตีกลับให้แก้ไข',
    customerName,
    projectName,
    headerGradient: GRADIENT.red,
    rows: [
      summaryRow('รอบที่ตีกลับ', periodLabel),
      ...(reason ? [summaryRow('เหตุผล', reason)] : []),
    ],
    buttons: uploadUrl ? [gradientLinkButton('ส่ง Timesheet ฉบับแก้ไข', uploadUrl, GRADIENT.red)] : [],
  });
}

/** แถวตัวเลือกแบบไอคอน+ป้ายกำกับ แนวนอน — ใช้แทนปุ่ม native หลายปุ่มเรียงแนวนอน เพราะพื้นที่ไม่พอ
 * label จะถูกบีบจนตัดคำ (เจอจริงบน production) */
function choiceRow({ icon, label, iconBg, action }: { icon: string; label: string; iconBg: string; action: unknown }) {
  return {
    type: 'box',
    layout: 'horizontal',
    alignItems: 'center',
    spacing: 'md',
    paddingAll: '12px',
    backgroundColor: '#F3F5F8',
    cornerRadius: '12px',
    action,
    contents: [
      {
        type: 'box',
        layout: 'vertical',
        width: '32px',
        height: '32px',
        cornerRadius: '8px',
        backgroundColor: iconBg,
        justifyContent: 'center',
        alignItems: 'center',
        flex: 0,
        contents: [{ type: 'text', text: icon, size: 'sm', color: '#FFFFFF', align: 'center', gravity: 'center' }],
      },
      { type: 'text', text: label, weight: 'bold', size: 'sm', flex: 1, gravity: 'center', wrap: false, color: '#1A1A1A' },
    ],
  };
}

/** ปุ่มลัดใต้ข้อความบอตฝั่งพนักงาน — ⚠️ ห้ามแนบกับข้อความที่ถามหา "รายละเอียดปัญหา" ต่อ (ดู
 * lineWebhookService.ts's line_pending_ticket_category check) เพราะข้อความถัดไปจะถูกเก็บเป็นคำอธิบาย
 * ปัญหาทันที ไม่ว่าจะพิมพ์เองหรือแตะปุ่มลัดนี้ */
export const EMPLOYEE_QUICK_REPLY: QuickReply = {
  items: [
    { type: 'action', action: { type: 'message', label: 'ส่ง Timesheet', text: 'ส่ง Timesheet' } },
    { type: 'action', action: { type: 'message', label: 'สรุปรอบวางบิล', text: 'สรุปรอบวางบิล' } },
    { type: 'action', action: { type: 'message', label: 'สถานะการวางบิล', text: 'สถานะการวางบิล' } },
    { type: 'action', action: { type: 'message', label: 'Help', text: 'Help' } },
  ],
};

/** หมวดปัญหาที่เลือกได้ — คีย์สั้นๆ เก็บลง DB, label ภาษาไทยใช้แสดงผลเท่านั้น */
export const TICKET_CATEGORIES: Record<string, string> = {
  bug: 'ระบบขัดข้อง (Bug)',
  manday: 'Manday ไม่ถูกต้อง',
  timesheet: 'Timesheet มีปัญหา',
  suggestion: 'ข้อเสนอแนะ',
};

export function buildTicketCategoryFlex() {
  return {
    type: 'bubble',
    header: {
      type: 'box',
      layout: 'vertical',
      background: { type: 'linearGradient', angle: '135deg', ...GRADIENT.blue },
      paddingAll: '16px',
      contents: [{ type: 'text', text: 'แจ้งปัญหา', color: '#FFFFFF', weight: 'bold', size: 'md' }],
    },
    body: {
      type: 'box',
      layout: 'vertical',
      spacing: 'sm',
      paddingAll: '16px',
      contents: [
        { type: 'text', text: 'เลือกประเภทปัญหาที่พบ', size: 'sm', color: '#77839A', wrap: true },
        { type: 'separator', margin: 'md' },
      ],
    },
    footer: {
      type: 'box',
      layout: 'vertical',
      spacing: 'sm',
      paddingAll: '16px',
      contents: Object.entries(TICKET_CATEGORIES).map(([key, label]) => ({
        type: 'button',
        style: 'secondary',
        height: 'sm',
        action: { type: 'postback', label, data: buildTicketPostback('start', key) },
      })),
    },
  };
}

export function buildTicketNotifyFlex({
  employeeName,
  categoryLabel,
  description,
  ticketId,
}: {
  employeeName: string;
  categoryLabel: string;
  description: string;
  ticketId: number;
}) {
  return bubble({
    title: 'แจ้งปัญหาใหม่',
    customerName: employeeName,
    projectName: categoryLabel,
    headerGradient: GRADIENT.amber,
    rows: [summaryRow('เลขที่ตั๋ว', `#${ticketId}`), summaryRow('รายละเอียด', description)],
    buttons: [
      {
        type: 'button',
        style: 'primary',
        color: '#067647',
        height: 'sm',
        action: { type: 'postback', label: 'ทำเครื่องหมายว่าแก้แล้ว', data: buildTicketPostback('resolve', ticketId) },
      },
    ],
  });
}

/** การ์ดเตือน "Timesheet ยังไม่ส่ง" — ให้เลือกวิธีส่ง 3 ทาง + ส่งภายหลัง ปุ่มเรียงแนวตั้งเพราะมี 4 ตัวเลือก
 * (choiceRow แนวนอนแทนปุ่ม native เพราะ 3+ ปุ่มเรียงแนวนอนจะถูกบีบจนตัดคำ — ดู choiceRow) */
export function buildOverdueReminderFlex({
  customerName,
  projectName,
  periodLabel,
  dueDate,
  contractId,
  period,
}: {
  customerName: string;
  projectName?: string | null;
  periodLabel: string;
  dueDate: string;
  contractId: string;
  period: string;
}) {
  const postback = (method: TimesheetMethod) => buildTimesheetMethodPostback(method, contractId, period);
  return bubble({
    title: 'Timesheet ยังไม่ส่ง',
    customerName,
    projectName,
    headerGradient: { startColor: SKY, endColor: BRAND },
    footerLayout: 'vertical',
    rows: [summaryRow('รอบที่ต้องส่ง', periodLabel), summaryRow('กำหนดส่งภายใน', dueDate)],
    buttons: [
      choiceRow({ icon: '🖥️', label: 'ส่งผ่านระบบ OBS', iconBg: BRAND, action: { type: 'postback', label: 'ส่งผ่านระบบ OBS', data: postback('self_obs') } }),
      choiceRow({ icon: '✉️', label: 'ส่งผ่าน Email', iconBg: '#77839A', action: { type: 'postback', label: 'ส่งผ่าน Email', data: postback('self_email') } }),
      choiceRow({ icon: '👤', label: 'ให้ผู้ดูแลเป็นคนส่ง', iconBg: '#77839A', action: { type: 'postback', label: 'ให้ผู้ดูแลเป็นคนส่ง', data: postback('proxy_email') } }),
      {
        type: 'box',
        layout: 'vertical',
        alignItems: 'center',
        margin: 'sm',
        action: { type: 'postback', label: 'ส่งภายหลัง', data: postback('snooze') },
        contents: [{ type: 'text', text: 'ส่งภายหลัง (เตือนอีกครั้งพรุ่งนี้)', size: 'xs', color: '#77839A', decoration: 'underline' }],
      },
    ],
  });
}

/** บับเบิลตอบคำสั่ง "สถานะ"/"สรุปรอบวางบิล" — ported from src/integrations/line.js buildEmployeeStatusFlex().
 * รับ input สำเร็จรูปจาก myProgressService.ts's buildEmployeeStatusFlexInput() ⚠️ ห้ามมียอดเงินติดมา
 * ด้วยเด็ดขาด (ดูคอมเมนต์ต้นทาง) — ไฟล์นี้แค่ต่อ Flex JSON เฉยๆ ไม่ตรวจ/กรองอะไรเพิ่ม */
export function buildEmployeeStatusFlex({
  contracts,
  progressUrl,
}: {
  contracts: Array<{
    customerName: string;
    projectName?: string | null;
    currentPeriodLabel: string;
    currentStatusLabel: string;
    currentStatusDetail: string | null;
    recentPeriods: Array<{ periodLabel: string; badge: string }>;
  }>;
  progressUrl: string | null;
}) {
  const bubbles = contracts.map((c) =>
    bubble({
      title: 'สถานะ Timesheet ของฉัน',
      customerName: c.customerName,
      projectName: c.projectName,
      headerGradient: GRADIENT.teal,
      rows: [
        summaryRow('รอบปัจจุบัน', c.currentPeriodLabel),
        summaryRow('สถานะ', c.currentStatusLabel),
        ...(c.currentStatusDetail ? [summaryRow('รายละเอียด', c.currentStatusDetail)] : []),
        ...(c.recentPeriods.length ? [{ type: 'separator', margin: 'md' }] : []),
        ...c.recentPeriods.map((p) => summaryRow(p.periodLabel, p.badge)),
      ],
      buttons: progressUrl ? [gradientLinkButton('ดูรายละเอียดทุกรอบ', progressUrl, GRADIENT.teal)] : [],
    }),
  );
  return bubbles.length === 1 ? bubbles[0] : { type: 'carousel', contents: bubbles };
}

/* วงกลมไอคอนแต่ละขั้นไล่สีอ่อน→เข้ม — ขั้นที่ยังไม่ถึง (future) เหลือแค่วงกลมโปร่งขอบเทาเรียบๆ ไม่มีไอคอน */
const BILLING_STEP_STYLE: Record<'done' | 'current' | 'future', { gradient: Gradient | null; icon: string }> = {
  done: { gradient: GRADIENT.teal, icon: '✓' },
  current: { gradient: GRADIENT.blue, icon: '●' },
  future: { gradient: null, icon: '' },
};

interface BillingStep {
  label: string;
  sub: string;
  dateLabel: string | null;
  state: 'done' | 'current' | 'future';
}

/** แถวหนึ่งขั้นตอนของ timeline วางบิล — วงกลมไอคอน + เส้นเชื่อมลงขั้นถัดไป (ไม่มีเส้นในขั้นสุดท้าย) */
function billingStepRow(step: BillingStep, index: number, isLast: boolean) {
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
      {
        type: 'box', layout: 'vertical', width: '28px', alignItems: 'center',
        contents: [
          circle,
          ...(isLast ? [] : [{ type: 'box', layout: 'vertical', width: '2px', height: '28px', backgroundColor: '#D8DEE6', margin: 'xs', contents: [] }]),
        ],
      },
      {
        type: 'box', layout: 'vertical', flex: 1, paddingBottom: isLast ? '0px' : 'md',
        contents: [
          {
            type: 'box', layout: 'horizontal',
            contents: [
              { type: 'text', text: `${index + 1}. ${step.label}`, weight: 'bold', size: 'sm', flex: 1, wrap: true },
              ...(step.dateLabel ? [{ type: 'text', text: step.dateLabel, size: 'xs', color: '#77839A', align: 'end', gravity: 'center' }] : []),
            ],
          },
          { type: 'text', text: step.sub, size: 'xs', color: '#77839A', wrap: true, margin: 'xs' },
        ],
      },
    ],
  };
}

interface BillingCycleContract {
  customerName: string;
  projectName?: string | null;
  periodLabel: string;
  progressPercent: number;
  steps: BillingStep[];
}

function billingCycleBubble({ customerName, projectName, periodLabel, progressPercent, steps }: BillingCycleContract) {
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

/**
 * บับเบิลตอบคำสั่ง "สถานะการวางบิล" — ported from src/integrations/line.js buildBillingCycleFlex().
 * แยกจาก "สถานะ" ปกติ โชว์เป็น flow 5 ขั้นของรอบบิลปัจจุบัน (Timesheet → ตรวจ Manday → ออกใบแจ้งหนี้ →
 * วางบิลส่งลูกค้า → รับชำระเงิน) พร้อม progress bar ⚠️ ไม่มียอดเงินเช่นเดียวกับ buildEmployeeStatusFlex
 */
export function buildBillingCycleFlex({ contracts }: { contracts: BillingCycleContract[] }) {
  const bubbles = contracts.map(billingCycleBubble);
  return bubbles.length === 1 ? bubbles[0] : { type: 'carousel', contents: bubbles };
}

/** เลือก "ส่งผ่านระบบ OBS" — พาไปหน้าอัปโหลดของเว็บใหม่โดยตรง ถ้าไม่ได้ตั้ง WEB_BASE_URL ไว้ (เช่น
 * รันในเครื่องที่มือถือเข้าไม่ถึง) จะไม่มีปุ่มเลย เพราะลิงก์เสียแย่กว่าไม่มีลิงก์ */
export function buildTimesheetObsRedirectFlex({
  employeeName,
  customerName,
  projectName,
  periodLabel,
  uploadUrl,
}: {
  employeeName: string;
  customerName?: string | null;
  projectName?: string | null;
  periodLabel: string;
  uploadUrl: string | null;
}) {
  return bubble({
    title: 'ส่ง Timesheet ผ่านระบบ OBS',
    customerName: customerName ?? '',
    projectName,
    headerGradient: GRADIENT.blue,
    rows: [summaryRow('ชื่อพนักงาน', employeeName), summaryRow('รอบบิล Timesheet', periodLabel)],
    buttons: uploadUrl ? [gradientLinkButton('Send Timesheet', uploadUrl, GRADIENT.blue)] : [],
  });
}

/** เลือก "ส่งผ่าน Email" — บอกที่อยู่อีเมลปลายทางที่ตั้งไว้ (หน้าจัดการระบบ) ไม่ได้ส่งอีเมลอะไรให้เอง
 * แค่บอกให้พนักงานส่งเอง */
export function buildTimesheetEmailConfirmFlex({
  customerName,
  projectName,
  periodLabel,
  emailTargets,
}: {
  customerName?: string | null;
  projectName?: string | null;
  periodLabel: string;
  emailTargets: string[];
}) {
  return bubble({
    title: 'บันทึกการส่งผ่าน Email เรียบร้อย',
    customerName: customerName ?? '',
    projectName,
    headerGradient: GRADIENT.teal,
    buttons: [],
    rows: [
      summaryRow('ผู้รับผิดชอบ', 'ฝ่ายบัญชีและการเงิน'),
      summaryRow('รอบบิล Timesheet', periodLabel),
      summaryRow('Email', emailTargets.length ? emailTargets.join(', ') : 'ยังไม่ได้ตั้งอีเมลปลายทางในระบบ'),
    ],
  });
}

/** เลือก "ให้ผู้ดูแลเป็นคนส่ง" — ไม่มี concept "หัวหน้างาน" แยกในฐานข้อมูล จึงแจ้งไปที่รายชื่อ
 * ฝ่ายบัญชี/admin เดียวกับ lineApproverTargets() */
export function buildTimesheetProxyConfirmFlex({
  employeeName,
  customerName,
  projectName,
  periodLabel,
}: {
  employeeName: string;
  customerName?: string | null;
  projectName?: string | null;
  periodLabel: string;
}) {
  return bubble({
    title: 'มอบหมายผู้ดูแลระบบเรียบร้อย',
    customerName: customerName ?? '',
    projectName,
    headerGradient: GRADIENT.teal,
    buttons: [],
    rows: [
      summaryRow('ชื่อพนักงาน', employeeName),
      summaryRow('รอบบิล / เดือนปี', periodLabel),
      { type: 'separator', margin: 'md' },
      {
        type: 'text',
        margin: 'md',
        wrap: true,
        size: 'sm',
        color: '#454545',
        text: 'ระบบได้ส่งการแจ้งเตือนไปยังฝ่ายดูแล เพื่อดำเนินการส่งและตรวจ Timesheet แทนคุณเรียบร้อยแล้ว',
      },
    ],
  });
}

/** แจ้งฝ่ายบัญชี/admin (lineApproverTargets) ว่าพนักงานเลือกช่องทาง "ส่งผ่าน Email"/"ให้ผู้ดูแลเป็นคนส่ง"
 * — เดิมเป็นข้อความธรรมดาไม่มีกล่องทั้งคู่ (`pushToAll(..., [{type:'text', ...}])` ใน
 * lineWebhookService.ts) เปลี่ยนมาเป็นกล่อง gradient ให้เหมือนการ์ดแจ้งเตือนใบอื่น (17 ก.ย. 69 ตามที่
 * user ขอ) — คนละใบกับ buildTimesheetEmailConfirmFlex/buildTimesheetProxyConfirmFlex ด้านบนที่ตอบกลับ
 * ตัวพนักงานเอง (ใบนั้นมีอยู่แล้วเป็น gradient ตั้งแต่แรก ไม่ต้องแก้) */
export function buildTimesheetMethodNotifyFlex({
  employeeName,
  periodLabel,
  method,
}: {
  employeeName: string;
  periodLabel: string;
  method: 'self_email' | 'proxy_email';
}) {
  const isProxy = method === 'proxy_email';
  return bubble({
    title: isProxy ? 'ขอมอบหมายส่ง Timesheet แทน' : 'แจ้งส่ง Timesheet ทางอีเมล',
    customerName: employeeName,
    headerGradient: GRADIENT.blue,
    buttons: [],
    rows: [
      summaryRow('รอบบิล Timesheet', periodLabel),
      { type: 'separator', margin: 'md' },
      {
        type: 'text',
        margin: 'md',
        wrap: true,
        size: 'sm',
        color: '#454545',
        text: isProxy
          ? `${employeeName} ขอมอบหมายให้ผู้ดูแลส่ง Timesheet รอบ ${periodLabel} แทน — กรอกเองในระบบได้เลยครับ (เมนู "กรอกเอง")`
          : `${employeeName} แจ้งว่าจะส่ง Timesheet รอบ ${periodLabel} ทางอีเมล — เตรียมรับและกรอกเข้าระบบเมื่อได้รับครับ`,
      },
    ],
  });
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

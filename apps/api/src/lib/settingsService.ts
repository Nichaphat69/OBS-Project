/**
 * ภาพรวมการเชื่อมต่อ/เงื่อนไขวางบิล — ported from service.js's settingsSnapshot()/
 * setFlowAccountConnected(). Backs the "จัดการระบบ → ภาพรวม" tab and the FlowAccount env chip
 * on the top bar.
 *
 * ยังไม่พอร์ต company/emailIngest/holidays settings ที่ต้นฉบับคืนมาด้วย — ไม่มี UI ไหนในสแต็กใหม่
 * (หรือแม้แต่ต้นฉบับเอง) อ่านค่า company/emailIngest จากจุดนี้ ส่วน holidays ผูกกับ master-data ที่ยัง
 * ไม่พอร์ต (รอ Phase 5.5.6) จึงยังไม่เพิ่ม field เปล่าๆ ที่ไม่มีใครใช้จริง
 */
import { getSetting, setSetting } from './dashboardService.js';
import { hasGmailCredentials } from './gmailClient.js';
import { DEFAULT_GMAIL_QUERY } from './gmailService.js';
import { hasLineCredentials } from './lineClient.js';
import { lineApproverTargets } from './notificationRecipientsService.js';
import { logAudit } from './audit.js';

const LOCAL_LLM_BASE_URL = process.env.LOCAL_LLM_BASE_URL ?? 'http://localhost:1234/v1';
const LOCAL_TEXT_MODEL = process.env.LOCAL_LLM_MODEL ?? 'gemma-2-2b-it';
const LOCAL_VISION_MODEL = process.env.LOCAL_LLM_VISION_MODEL ?? 'gemma-3-4b-it';

export class SettingsError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

export interface SettingsSnapshot {
  flowaccount: { mode?: string; documentType?: string };
  billingRules: { billOnDayOfNextMonth?: number; requireAllTimesheets?: boolean; requireHumanCheck?: boolean };
  env: {
    flowAccountMode: string;
    hasFlowAccountCredentials: boolean;
    localLlmBaseUrl: string;
    localTextModel: string;
    localVisionModel: string;
    hasGmail: boolean;
    gmailQuery: string;
    hasLine: boolean;
    lineRecipientCount: number;
    appBaseUrl: string | null;
  };
}

/** ported from service.js settingsSnapshot() */
export async function settingsSnapshot(): Promise<SettingsSnapshot> {
  const [flowaccount, billingRules, lineTargets] = await Promise.all([
    getSetting<{ mode?: string; documentType?: string }>('flowaccount', {}),
    getSetting<{ billOnDayOfNextMonth?: number; requireAllTimesheets?: boolean; requireHumanCheck?: boolean }>('billing_rules', {}),
    lineApproverTargets(),
  ]);

  return {
    flowaccount,
    billingRules,
    env: {
      flowAccountMode: process.env.FLOWACCOUNT_MODE ?? 'dry-run',
      hasFlowAccountCredentials: Boolean(process.env.FLOWACCOUNT_CLIENT_ID && process.env.FLOWACCOUNT_CLIENT_SECRET),
      localLlmBaseUrl: LOCAL_LLM_BASE_URL,
      localTextModel: LOCAL_TEXT_MODEL,
      localVisionModel: LOCAL_VISION_MODEL,
      hasGmail: hasGmailCredentials(),
      gmailQuery: DEFAULT_GMAIL_QUERY,
      /* LINE กับ APP_BASE_URL — ไม่มีสองอย่างนี้ ปุ่มในข้อความแจ้งเตือนจะกดเข้าเว็บไม่ได้
         หน้าจัดการระบบต้องบอกได้ว่าตั้งครบหรือยัง ไม่ใช่ต้องไปเปิด .env ดูเอง */
      hasLine: hasLineCredentials(),
      lineRecipientCount: lineTargets.length,
      appBaseUrl: process.env.APP_BASE_URL ?? null,
    },
  };
}

export interface ReaderChoice {
  id: string;
  label: string;
  /** ตั้งค่า credential ครบพร้อมใช้จริงไหม — ตัวที่ยังไม่พร้อมเลือกไม่ได้ */
  configured: boolean;
  /** ตัวที่ระบบกำลังใช้อยู่จริง (ตัวเดียวเท่านั้นที่เป็น true) */
  active: boolean;
}

/**
 * รายชื่อเครื่องอ่านทั้งหมดพร้อมสถานะ — หน้า "ตัวอ่าน Timesheet" วาดสองแท็บจากรายการนี้
 *
 * `active` คำนวณจาก `pickReader()` ตัวเดียวกับที่ ingest ใช้จริง ไม่ใช่อ่านค่า setting ตรงๆ
 * เพื่อให้หน้าจอบอก "ตัวที่ใช้อยู่จริง" ไม่ใช่ "ตัวที่เคยเลือกไว้" — สองอย่างนี้ต่างกันได้เมื่อ
 * ตัวที่เลือกไว้ถูกถอน credential ออกทีหลัง แล้วระบบ fallback ไปใช้ตัวอื่นเงียบๆ
 */
export async function listReaders(): Promise<ReaderChoice[]> {
  const { READERS, pickReader } = await import('./extractionService.js');
  const activeId = (await pickReader()).id;
  return READERS.map((r) => ({
    id: r.id,
    label: r.label,
    configured: r.isConfigured(),
    active: r.id === activeId,
  }));
}

/** เลือกเครื่องอ่านที่จะใช้ทั้งระบบ — มีผลกับไฟล์ที่อ่านหลังจากนี้ ไม่ย้อนไปแตะใบที่อ่านไปแล้ว */
export async function setActiveReader(id: string, { actor }: { actor: string }): Promise<ReaderChoice[]> {
  const { readerById, ACTIVE_READER_SETTING } = await import('./extractionService.js');
  const reader = readerById(id);
  if (!reader) throw new SettingsError(`ไม่รู้จักเครื่องอ่าน "${id}"`);
  if (!reader.isConfigured()) {
    throw new SettingsError(`${reader.label} ยังตั้งค่าไม่ครบ — ใส่ค่าที่ต้องใช้ใน .env ก่อนจึงจะเลือกได้`);
  }

  await setSetting(ACTIVE_READER_SETTING, { id });
  await logAudit({ actor, action: 'set_active_reader', entityType: 'settings', entityId: ACTIVE_READER_SETTING, detail: { id, label: reader.label } });
  return listReaders();
}

/**
 * เปิด/ปิดสวิตช์เชื่อมต่อ FlowAccount จากแถบบนของเว็บ — ปิด = dry-run (ไม่ยิงออกไปหา FlowAccount จริง
 * เลยสักคำขอ) เปิด = ใช้โหมดจริงตามที่ตั้งไว้ใน .env (FLOWACCOUNT_MODE เช่น sandbox/live) ตัวแปรเดียวกับ
 * ที่ newFlowAccountClient() ใช้อยู่แล้ว จึงมีผลทันทีกับทั้งการดึงข้อมูลและตอนกดอนุมัติวางบิลจริง
 */
export async function setFlowAccountConnected(enabled: boolean, { actor }: { actor: string }): Promise<{ mode: string }> {
  const hasCredentials = Boolean(process.env.FLOWACCOUNT_CLIENT_ID && process.env.FLOWACCOUNT_CLIENT_SECRET);
  const realMode = process.env.FLOWACCOUNT_MODE ?? 'dry-run';
  if (enabled && (!hasCredentials || realMode === 'dry-run')) {
    throw new SettingsError('เชื่อมต่อไม่ได้ — ยังไม่ได้ตั้ง FLOWACCOUNT_CLIENT_ID/SECRET/MODE (sandbox หรือ live) ใน .env');
  }
  const current = await getSetting<{ documentType?: string }>('flowaccount', { documentType: 'billing-note' });
  const mode = enabled ? realMode : 'dry-run';
  await setSetting('flowaccount', { ...current, mode });
  await logAudit({ actor, action: 'set_flowaccount_connected', entityType: 'settings', entityId: 'flowaccount', detail: { mode } });
  return { mode };
}

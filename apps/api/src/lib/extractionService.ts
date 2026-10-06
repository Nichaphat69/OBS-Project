/**
 * ตัวอ่านไฟล์ Timesheet — เลือกเครื่องอ่านให้อัตโนมัติ แล้วแปลงผลลัพธ์ให้เป็นรูปกลางรูปเดียว
 *
 * ports from src/extract/timesheet.js's `extractTimesheet()` — ต้นฉบับใช้ ABBYY Vantage ก่อนเสมอ
 * เมื่อตั้งค่าไว้ แล้วตกไปใช้ local vision/text LLM (localExtractionService.ts) เมื่อไม่ได้ตั้ง
 * พฤติกรรมนั้นยังเหมือนเดิมทุกประการ เพียงแต่เขียนเป็นรายการตัวอ่านแทน if/else เพื่อให้เพิ่มเครื่องอ่าน
 * เจ้าใหม่ (Clear Read) ได้ด้วยการเพิ่มสมาชิกในรายการ ไม่ต้องแก้ตรรกะการเลือก
 *
 * กติกาของรายการ `READERS`: เรียงตามลำดับที่อยากให้ลอง ตัวแรกที่ `isConfigured()` เป็น true ได้ใช้งาน
 * ตัวสุดท้ายในรายการต้องเป็น fallback ที่ใช้ได้เสมอ (local-LLM) ไม่งั้นจะไม่มีตัวอ่านเลยเมื่อไม่ได้ตั้งค่าอะไร
 *
 * การตรวจผลลัพธ์จงใจต่างกันตามเส้นทาง: ABBYY มี `mapAbbyyResult()` ที่ผลิต `notes[]` อธิบายทุกจุดที่
 * ไม่แน่ใจอยู่แล้ว (ฟิลด์หาย คอลัมน์ตารางไม่น่าเชื่อถือ จำนวนวันลาไม่ตรง) จึงยกมาเป็น issue ระดับ `warn`
 * ตรงๆ ส่วนเส้น local-LLM ใช้ `verifyExtraction()` เต็มรูปแบบ เพราะเส้นนั้นอ่านทีละหน้าจริงและต้องการ
 * การตรวจความสอดคล้องข้ามหน้า
 */
import { toInternalDetailKey, type TimesheetFieldMap } from '@obs/domain';
import { AbbyyClient, hasAbbyyCredentials, mapAbbyyResult } from './abbyyClient.js';
import { ClearReadClient, hasClearReadCredentials, mapClearReadResult } from './clearReadClient.js';
import { getFieldMapForSkill } from './abbyySkillsService.js';
import type { Extractor, ExtractorResult } from './ingestService.js';

export class ExtractionError extends Error {
  status: number;
  constructor(message: string, status = 502) {
    super(message);
    this.status = status;
  }
}

export interface ReaderOptions {
  expectedPeriod?: string;
  /** Skill/แม่แบบของเครื่องอ่านที่ผูกกับสัญญานี้ — ผู้เรียกส่งมาจาก `contract.abbyySkillId` */
  templateId?: string | null;
  /** ผังชื่อฟิลด์ของลูกค้ารายนี้ — ตัวอ่านรับไปใช้โดยไม่สนว่าเก็บไว้ที่ไหน (ดู TimesheetFieldMap) */
  fieldMap?: TimesheetFieldMap | null;
  /** ชื่อไฟล์/ชนิดไฟล์ที่ส่งให้เครื่องอ่าน — ใช้ตอนไฟล์ไม่ใช่ PDF (ภาพสแกน) ไม่ส่งมา = PDF เหมือนเดิม */
  fileName?: string | null;
  mimeType?: string | null;
}

/**
 * เครื่องอ่านเอกสารหนึ่งเจ้า
 *
 * `read()` ต้องคืนผลในรูปกลาง (`ExtractorResult`) แล้ว — การแปลงจากรูปของเครื่องอ่านเจ้านั้นเป็นหน้าที่
 * ของตัวมันเอง ไม่ใช่ของผู้เรียก ส่วนคีย์รายวันที่ชื่อไม่ตรงสเปกสามตัว (day/remarks/workType) ชั้นนี้
 * แปลงให้เองหลังได้ผลมา ตัวอ่านเจ้าใหม่จึงเขียนด้วยคีย์ตามสเปกได้เลย
 */
export interface TimesheetReader {
  id: string;
  label: string;
  /** ตั้งค่าครบพร้อมใช้งานจริงไหม — ตัวที่ตอบ false จะถูกข้ามไปใช้ตัวถัดไปในรายการ */
  isConfigured(): boolean;
  read(source: Buffer, opts: ReaderOptions): Promise<ExtractorResult>;
}

const abbyyReader: TimesheetReader = {
  id: 'abbyy',
  label: 'ABBYY Vantage',
  isConfigured: hasAbbyyCredentials,
  async read(source, { expectedPeriod, templateId, fieldMap, fileName, mimeType }) {
    // ไม่ได้ส่ง Skill มาหรือสัญญานั้นยังไม่ได้ตั้งไว้ → ปล่อยให้ AbbyyClient ใช้ ABBYY_SKILL_ID จาก .env
    // ตามพฤติกรรมเดิมก่อนมี multi-skill
    const client = new AbbyyClient(templateId ? { skillId: templateId } : {});
    const { rawResult } = await client.extractDocument(source, fileName || 'timesheet.pdf', mimeType || 'application/pdf');
    // ผู้เรียกส่ง fieldMap มาให้แล้วก็ใช้เลย ไม่ส่งมาค่อยไปหาเอาจากสารบัญ Skill — เผื่อเส้นทางที่เรียก
    // ตัวอ่านตรงโดยไม่ผ่าน extractTimesheet()
    const map = fieldMap ?? (await getFieldMapForSkill(templateId));
    const data: any = mapAbbyyResult(rawResult, map as any);

    if (expectedPeriod && data.period && data.period !== expectedPeriod) {
      data.notes = [...(data.notes ?? []), `รอบเดือนที่อ่านได้ (${data.period}) ไม่ตรงกับที่คาดไว้ (${expectedPeriod}) — ตรวจสอบก่อนยืนยัน`];
    }

    return {
      data,
      verification: { ok: true, issues: (data.notes ?? []).map((message: string) => ({ severity: 'warn', message })) },
      usage: null,
      // ติด Skill ที่ใช้ไปกับชื่อตัวอ่านด้วย — ค่านี้ถูกเก็บลง timesheets.extraction.model ตอนยืนยัน และเป็น
      // ร่องรอยเดียวที่บอกได้ว่าตัวเลขในใบนี้มาจากการแมปชุดไหน พอระบบรองรับหลายฟอร์แมต/หลายบริษัท
      // "อ่านด้วย ABBYY" อย่างเดียวตอบไม่ได้ว่าทำไมฟอร์มนี้อ่านเพี้ยน (ก่อน refactor multi-reader เคยมี
      // ท้ายชื่อแบบนี้อยู่แล้ว เช่น "abbyy:Timesheet" — ใส่กลับเข้ามา)
      model: templateId ? `abbyy:${templateId}` : 'abbyy',
      rawResponse: rawResult,
    } satisfies ExtractorResult;
  },
};

const clearReadReader: TimesheetReader = {
  id: 'clear-read',
  label: 'Clear Read',
  isConfigured: hasClearReadCredentials,
  async read(source, { expectedPeriod, templateId }) {
    const client = new ClearReadClient();
    // ลำดับการเลือกแม่แบบ: ที่ส่งมากับคำขอ → ที่เลือกไว้ในหน้าตัวอ่าน → CLEAR_READ_TEMPLATE_ID ใน .env
    // (ตัวสุดท้ายคือ client จัดการเองถ้าได้ null) — เจ้าของระบบสั่งไว้ว่าเลือกในหน้าตัวอ่านแล้วต้อง
    // เปลี่ยนแม่แบบที่ใช้อ่านจริงด้วย ไม่ใช่แค่เปิดดูเฉยๆ
    const chosen = templateId ?? (await activeClearReadTemplateId());
    const detail = await client.readDocument(source, { templateId: chosen });
    const data: any = mapClearReadResult(detail, { expectedPeriod });

    return {
      data,
      verification: { ok: true, issues: (data.notes ?? []).map((message: string) => ({ severity: 'warn', message })) },
      usage: null,
      // เหตุผลเดียวกับฝั่ง ABBYY ด้านบน — แม่แบบที่ใช้อ่านคือสิ่งที่ต้องรู้เวลาไล่ว่าฟอร์มไหนอ่านเพี้ยน
      model: chosen ? `clear-read:${chosen}` : 'clear-read',
      rawResponse: detail,
    } satisfies ExtractorResult;
  },
};

const localLlmReader: TimesheetReader = {
  id: 'local-llm',
  label: 'โมเดลในเครื่อง (LM Studio/Ollama)',
  // ตัวสุดท้ายของรายการ — เป็น fallback ที่ต้องใช้ได้เสมอ ไม่งั้นจะไม่มีตัวอ่านเลยเมื่อไม่ได้ตั้งค่าอะไร
  isConfigured: () => true,
  async read(source, { expectedPeriod }) {
    // โหลดตอนใช้จริงเท่านั้น — localExtractionService ลาก pdf-to-img/pdfjs-dist (หลายสิบ MB) มาด้วยทั้งสาย
    const { extractTimesheetViaLocalLlm } = await import('./localExtractionService.js');
    const { data, verification, usage, model } = await extractTimesheetViaLocalLlm(source, { expectedPeriod });
    return { data: data as any, verification, usage, model } satisfies ExtractorResult;
  },
};

/** เรียงตามลำดับที่อยากให้ลอง — ตัวแรกที่ตั้งค่าครบได้ใช้งาน
 * ABBYY มาก่อนเพราะเป็นเส้นที่ตั้งค่าไว้จริงและพิสูจน์กับของจริงมานานแล้ว, Clear Read ถัดมา,
 * local-LLM ต้องอยู่ท้ายสุดเสมอเพราะ isConfigured() เป็น true ตลอด (เป็น fallback ตัวสุดท้าย) */
export const READERS: TimesheetReader[] = [abbyyReader, clearReadReader, localLlmReader];

/** คีย์ใน settings ที่เก็บว่าเลือกเครื่องอ่านตัวไหนไว้ทั้งระบบ */
export const ACTIVE_READER_SETTING = 'active_reader';

/** แม่แบบ Clear Read ที่เลือกไว้จากหน้า "ตัวอ่าน Timesheet" — เก็บในตาราง settings ไม่ใช่ .env
 * เพราะเจ้าของระบบต้องเปลี่ยนเองได้จากหน้าเว็บโดยไม่ต้องแก้ไฟล์แล้วรีสตาร์ต
 * ยังไม่เคยเลือก = ตกไปใช้ CLEAR_READ_TEMPLATE_ID จาก .env เหมือนเดิม */
export const ACTIVE_CLEAR_READ_TEMPLATE_SETTING = 'active_clear_read_template';

/** แม่แบบที่ระบบใช้อ่านอยู่จริง — null แปลว่ายังไม่ได้เลือก ให้ ClearReadClient ใช้ค่าจาก .env เอง */
export async function activeClearReadTemplateId(): Promise<string | null> {
  const { getSetting } = await import('./dashboardService.js');
  const saved = await getSetting<{ id?: string }>(ACTIVE_CLEAR_READ_TEMPLATE_SETTING, {});
  return saved.id ?? null;
}

export function readerById(id: string | null | undefined): TimesheetReader | null {
  return READERS.find((r) => r.id === id) ?? null;
}

/**
 * เลือกเครื่องอ่านที่จะใช้ — ยึดตัวที่ผู้ใช้เลือกไว้ในหน้า "ตัวอ่าน Timesheet" ก่อนเสมอ
 *
 * ตกไปใช้การไล่ตามลำดับ `READERS` เฉพาะตอนที่ยังไม่เคยเลือก หรือเลือกตัวที่ตั้งค่าไม่ครบ/ไม่รู้จักแล้ว
 * (เช่นถอน credential ออกทีหลัง) — จงใจให้ fallback เงียบๆ แทนที่จะ throw เพราะการอ่าน Timesheet
 * ไม่ควรหยุดทั้งระบบเพราะค่าตั้งค่าค้างอยู่ แต่ผู้เรียกเห็นได้ว่าใช้ตัวไหนจริงจาก `model` ในผลลัพธ์
 */
export async function pickReader(
  preferredId?: string | null,
  { strict = false }: { strict?: boolean } = {},
): Promise<TimesheetReader> {
  /* strict = ผู้ใช้เจาะจงมาเองว่าจะลองตัวไหน (ปุ่ม "ลองอ่านด้วย...") — ห้าม fallback เงียบๆ เด็ดขาด
     เพราะจุดประสงค์คือ "อยากรู้ว่าตัวนี้อ่านได้แค่ไหน" ถ้าตกไปใช้ตัวอื่นแล้วไม่บอก คนจะเข้าใจว่าได้
     ทดสอบ Clear Read ไปแล้วทั้งที่จริงเป็นผลของ ABBYY — ตรงข้ามกับตอนทำงานปกติที่ fallback ถูกต้อง */
  if (strict && preferredId) {
    const wanted = readerById(preferredId);
    if (!wanted) throw new ExtractionError(`ไม่รู้จักเครื่องอ่าน "${preferredId}"`, 400);
    if (!wanted.isConfigured()) {
      throw new ExtractionError(`${wanted.label} ยังตั้งค่าไม่ครบ จึงลองอ่านด้วยตัวนี้ไม่ได้`, 400);
    }
    return wanted;
  }

  let id = preferredId ?? null;
  if (id === undefined || id === null) {
    // import แบบ dynamic — dashboardService ลาก Prisma มาทั้งสาย ส่วนไฟล์นี้ถูก import โดยเส้นที่ไม่ต้องใช้ DB ด้วย
    const { getSetting } = await import('./dashboardService.js');
    const saved = await getSetting<{ id?: string }>(ACTIVE_READER_SETTING, {});
    id = saved.id ?? null;
  }

  const chosen = readerById(id);
  if (chosen?.isConfigured()) return chosen;

  const reader = READERS.find((r) => r.isConfigured());
  if (!reader) throw new ExtractionError('ยังไม่ได้ตั้งค่าเครื่องอ่านเอกสารสักตัว');
  return reader;
}

/**
 * แปลงคีย์รายวันจากชื่อตามสเปกกลางเป็นชื่อที่ `ExtractedDay` ใช้จริง (day→dayOfWeek, remarks→remark,
 * workType→type) — คีย์อื่นผ่านตามเดิม จึงไม่มีผลกับตัวอ่านที่คืนคีย์ภายในอยู่แล้วอย่าง ABBYY
 *
 * มีไว้เพื่อให้ตัวอ่านเจ้าใหม่เขียน mapping ด้วยคีย์ตามสเปกได้เลย โดยไม่ต้องรอ rename ข้ามไฟล์
 * (ดู DETAIL_SPEC_KEY_ALIASES ใน @obs/domain สำหรับที่มาของข้อยกเว้นสามตัวนี้)
 */
export function normalizeDetailKeys(data: any): any {
  if (!Array.isArray(data?.days)) return data;
  data.days = data.days.map((row: Record<string, unknown>) => {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(row)) {
      const internal = toInternalDetailKey(key);
      // ค่าที่มาด้วยคีย์ภายในอยู่แล้วชนะเสมอ — กันเคสที่แถวมีทั้งสองชื่อแล้วตัวที่มาทีหลังทับของเดิม
      if (internal in out && key !== internal) continue;
      out[internal] = value;
    }
    return out;
  });
  return data;
}

export const extractTimesheet: Extractor = async (source, { expectedPeriod, abbyySkillId, clearReadTemplateId, readerId } = {}) => {
  if (!Buffer.isBuffer(source)) {
    throw new ExtractionError('ต้องมีไฟล์ PDF ให้อ่าน', 400);
  }

  // ระบุ readerId มา = ลองอ่านครั้งนี้ด้วยตัวนั้นโดยเฉพาะ ไม่แตะค่าที่ตั้งไว้ทั้งระบบ และไม่ fallback
  const reader = await pickReader(readerId ?? null, { strict: Boolean(readerId) });
  // ส่งเฉพาะแม่แบบของเครื่องอ่านที่ถูกเลือกจริง — Skill ของ ABBYY กับแม่แบบของ Clear Read เป็นคนละ
  // ระบบ ส่งข้ามกันไม่ได้ ตัวอ่านที่ไม่มีแม่แบบผูกไว้จะตกไปใช้ค่าจาก .env ของตัวเองต่อ
  const templateId = reader.id === 'clear-read' ? clearReadTemplateId : reader.id === 'abbyy' ? abbyySkillId : null;
  const result = await reader.read(source, { expectedPeriod, templateId });
  return { ...result, data: normalizeDetailKeys(result.data) };
};

/**
 * อ่านภาพสแกน (JPG/PNG/TIFF) — ส่งให้ ABBYY เท่านั้น (6 ต.ค. 69)
 *
 * เจาะจง ABBYY เพราะ Clear Read และโมเดลในเครื่องของระบบนี้สร้างมารับ PDF (Clear Read ส่งเป็น PDF ทั้งก้อน, local-LLM
 * แปลง PDF เป็นภาพทีละหน้าเอง) ภาพเดี่ยวส่งเข้าไปแล้วไม่มีหลักประกันว่าอ่านได้ — ถ้าไม่ได้ตั้งค่า ABBYY ให้บอกตรงๆ
 * ไม่ลอบตกไปใช้ตัวอื่นแล้วได้ผลมั่ว ⚠️ ทางนี้ยังไม่เคยทดสอบกับ ABBYY จริง (ไม่มีไฟล์ภาพตัวอย่าง) ผลลัพธ์ผ่านขั้นรีวิวเสมอ
 */
export async function extractTimesheetFromImage(
  source: Buffer,
  { expectedPeriod, abbyySkillId, fileName, mimeType }: { expectedPeriod?: string; abbyySkillId?: string | null; fileName?: string | null; mimeType: string },
) {
  if (!abbyyReader.isConfigured()) {
    throw new ExtractionError('ภาพสแกนอ่านได้เฉพาะด้วย ABBYY Vantage ซึ่งยังตั้งค่าไม่ครบ — ส่งเป็น PDF หรือ Excel แทน', 400);
  }
  const result = await abbyyReader.read(source, { expectedPeriod, templateId: abbyySkillId ?? null, fileName, mimeType });
  return { ...result, data: normalizeDetailKeys(result.data) };
}

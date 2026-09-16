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
  async read(source, { expectedPeriod, templateId, fieldMap }) {
    // ไม่ได้ส่ง Skill มาหรือสัญญานั้นยังไม่ได้ตั้งไว้ → ปล่อยให้ AbbyyClient ใช้ ABBYY_SKILL_ID จาก .env
    // ตามพฤติกรรมเดิมก่อนมี multi-skill
    const client = new AbbyyClient(templateId ? { skillId: templateId } : {});
    const { rawResult } = await client.extractDocument(source, 'timesheet.pdf');
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
      model: 'abbyy',
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
    // templateId ของสัญญาเป็นของ ABBYY (Skill) คนละระบบกับ Clear Read — ส่งต่อให้เฉพาะตอนที่หน้าตา
    // เป็น UUID ของ Clear Read จริงๆ ไม่งั้นปล่อยให้ client ใช้ CLEAR_READ_TEMPLATE_ID จาก .env แทน
    const detail = await client.readDocument(source, {
      templateId: templateId && /^[0-9a-f-]{36}$/i.test(templateId) ? templateId : null,
    });
    const data: any = mapClearReadResult(detail, { expectedPeriod });

    return {
      data,
      verification: { ok: true, issues: (data.notes ?? []).map((message: string) => ({ severity: 'warn', message })) },
      usage: null,
      model: 'clear-read',
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

export function pickReader(): TimesheetReader {
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
function normalizeDetailKeys(data: any): any {
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

export const extractTimesheet: Extractor = async (source, { expectedPeriod, abbyySkillId } = {}) => {
  if (!Buffer.isBuffer(source)) {
    throw new ExtractionError('ต้องมีไฟล์ PDF ให้อ่าน', 400);
  }

  const reader = pickReader();
  const result = await reader.read(source, { expectedPeriod, templateId: abbyySkillId });
  return { ...result, data: normalizeDetailKeys(result.data) };
};

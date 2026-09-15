/**
 * อ่านข้อมูลจากไฟล์ Timesheet PDF ด้วยโมเดล vision ที่รันในเครื่อง (LM Studio/Ollama) — ported
 * (narrowed) from src/extract/timesheet.js. ทางสำรองเมื่อไม่ได้ตั้งค่า ABBYY (ดู extractionService.ts).
 *
 * มีสองทาง เลือกอัตโนมัติตามตัวเอกสาร:
 * 1. ทางเร็ว (ค่าเริ่มต้น) — อ่านชั้นข้อความใน PDF ตรงๆ ด้วย pdfjs แล้วส่งข้อความให้โมเดล เอกสารเกือบ
 *    ทั้งหมด export มาจาก Excel จึงมีชั้นข้อความสมบูรณ์อยู่แล้ว เร็วกว่าและแม่นกว่าการให้โมเดลมองรูปมาก
 * 2. ทางสำรอง — ไฟล์ที่เป็นภาพสแกนจริง (ไม่มีชั้นข้อความ) ต้องแปลงเป็นรูปแล้วส่งให้โมเดล vision
 *
 * Narrowed vs. the original: this port only handles ONE employee's timesheet per PDF (matching the
 * `Extractor` interface's single-`ExtractedData` shape — see ingestService.ts) — the original's
 * `groupPagesByEmployee`/`mergeDocumentsByEmployee` (splitting a PDF containing several employees'
 * sheets concatenated into multiple `documents[]`) is out of scope, the same narrowing already made
 * for the ABBYY path in extractionService.ts (ABBYY's API itself only ever returns one document per
 * transaction, so both extraction paths agree on this scope cut).
 *
 * ⚠️ พอร์ตแบบ code-complete แต่ยังไม่ได้พิสูจน์ด้วยข้อมูลจริงในสภาพแวดล้อมนี้ (Phase 5.7) — เครื่องที่รัน
 * โมเดล (LOCAL_LLM_BASE_URL) เชื่อมต่อจากเซสชันที่พอร์ตไม่ได้ ต้อง deploy ไปรันบน production จริงก่อน
 */
import { pdf } from 'pdf-to-img';
import { callLocalJSON, localVisionModel, localTextModel } from './localLlmClient.js';
import { normalizePeriod, normalizeDate, classifyDayKind, classifyLeaveType } from '@obs/domain';
import { extractPdfText, employeeNameIn, periodIn, signatureNamesIn, dayRowsIn } from './pdfTextService.js';

const TIMESHEET_SCHEMA = {
  type: 'object',
  properties: {
    vendor: { type: ['string', 'null'], description: 'Vendor ที่ระบุในเอกสาร เช่น iPassion Co.,Ltd. — ไม่เห็นในหน้านี้ให้เป็น null' },
    clientName: { type: ['string', 'null'], description: 'Client Name ที่ระบุในเอกสาร — ไม่เห็นในหน้านี้ให้เป็น null' },
    projectName: { type: ['string', 'null'], description: 'ไม่เห็นในหน้านี้ให้เป็น null' },
    employeeName: { type: ['string', 'null'], description: 'Employee Name ตามที่เขียนในเอกสาร ห้ามแก้การสะกด — ไม่เห็นในหน้านี้ให้เป็น null' },
    position: { type: ['string', 'null'], description: 'Position ตามที่เขียนในเอกสาร ห้ามแปลหรือแก้ — ไม่เห็นในหน้านี้ให้เป็น null' },
    period: { type: ['string', 'null'], description: 'เดือนของ Timesheet ในรูปแบบ YYYY-MM เช่น 2026-01 — ไม่เห็นในหน้านี้ให้เป็น null' },
    documentNo: {
      type: ['string', 'null'],
      description: 'เลขที่เอกสารจากหน้าอีเมลแจ้งอนุมัติที่แนบมาท้ายไฟล์ (บรรทัด "เลขที่เอกสาร : 2026010087") — ไม่มีหน้านั้นในหน้านี้ให้เป็น null',
    },
    approvalStatus: { type: ['string', 'null'], description: 'สถานะจากหน้าอีเมลแจ้งอนุมัติ (บรรทัด "สถานะ : อนุมัติ") — ไม่เห็นให้เป็น null' },
    totalWorkDays: {
      type: 'integer',
      description:
        'จำนวนวันทำงานจากช่องสรุปท้ายตาราง ไม่ต้องนับแถวเอง — ชื่อช่องต่างกันไปตามฟอร์ม เช่น Total Work days · '
        + 'Total base man-day · No. Manday · Summary Work Days · Claim to APHD (ถ้าช่องสรุปเป็นชั่วโมงรวมให้ใส่ในช่อง totalHours แทน) — ไม่เห็นให้เป็น 0',
    },
    totalLeaveDays: { type: 'integer', description: 'จำนวนวันลาจากช่องสรุปท้ายตาราง เช่น Leave/Sick (days) หรือคอลัมน์ Leave — ไม่เห็นให้เป็น 0' },
    totalHours: {
      type: ['number', 'null'],
      description: 'ชั่วโมงรวมจากช่องสรุป เช่น "Total duration (hour in decimal) 160.00" — ฟอร์มที่สรุปเป็นวันไม่มีช่องนี้ ให้เป็น null',
    },
    days: {
      type: 'array',
      description: 'ทุกแถวในตารางที่เห็นในหน้านี้ เรียงตามวันที่ — ไม่มีตารางในหน้านี้ให้เป็น []',
      items: {
        type: 'object',
        properties: {
          date: { type: 'string', description: 'วันที่ในรูปแบบ YYYY-MM-DD' },
          timeIn: { type: ['string', 'null'], description: 'เวลาเข้า เช่น 8:30 ถ้าไม่มีให้เป็น null' },
          timeOut: { type: ['string', 'null'] },
          label: {
            type: ['string', 'null'],
            description: 'ป้ายกำกับของแถวเมื่อไม่ได้ทำงาน คัดตามที่เขียนในเอกสารทุกตัวอักษร เช่น Holiday, Weekend, Sick leave — วันทำงานปกติให้เป็น null',
          },
          type: { type: ['string', 'null'], description: 'ค่าในคอลัมน์ Type (ถ้าฟอร์มนี้มี) — ไม่มีคอลัมน์นี้ให้เป็น null' },
          remark: { type: ['string', 'null'], description: 'ค่าในคอลัมน์ Remark / Remarks / Note / Location / Place ของแถวนี้ — ไม่มีให้เป็น null' },
          jobDescription: { type: ['string', 'null'] },
        },
        required: ['date', 'timeIn', 'timeOut', 'label', 'type', 'remark', 'jobDescription'],
        additionalProperties: false,
      },
    },
    leaveDays: {
      type: 'array',
      description: 'เฉพาะวันที่ลาที่เห็นในหน้านี้ แยกประเภทตามคำที่เขียนในเอกสาร — ไม่มีให้เป็น []',
      items: {
        type: 'object',
        properties: {
          date: { type: 'string' },
          type: { type: 'string', enum: ['sick', 'personal', 'vacation', 'unpaid', 'unknown'], description: 'Sick leave→sick, ลากิจ→personal, ลาพักร้อน→vacation' },
          rawLabel: { type: 'string', description: 'ข้อความที่เขียนในเอกสารตามจริง' },
        },
        required: ['date', 'type', 'rawLabel'],
        additionalProperties: false,
      },
    },
    signedByEmployee: { type: 'boolean', description: "หน้านี้มีลายเซ็นหรือชื่อพนักงานในช่อง Employee's Signature หรือไม่ — ไม่มีช่องนี้ในหน้านี้ให้เป็น false" },
    employeeSignatureName: {
      type: ['string', 'null'],
      description: "ชื่อที่เขียน/พิมพ์อยู่ข้างลายเซ็นในช่อง Employee's Signature — อ่านลายเซ็นไม่ออกหรือไม่มีชื่อกำกับให้เป็น null ห้ามเดา",
    },
    signedByProjectManager: { type: 'boolean', description: "หน้านี้มีลายเซ็นในช่อง Project Manager's Signature (TLI) หรือไม่ — ไม่มีช่องนี้ในหน้านี้ให้เป็น false" },
    projectManagerSignatureName: {
      type: ['string', 'null'],
      description: "ชื่อที่เขียน/พิมพ์อยู่ข้างลายเซ็นในช่อง Project Manager's Signature (TLI) — อ่านลายเซ็นไม่ออกหรือไม่มีชื่อกำกับให้เป็น null ห้ามเดา",
    },
    notes: { type: 'array', description: 'สิ่งที่อ่านไม่ชัด ขัดแย้งกันเอง หรือควรให้คนตรวจ เฉพาะในหน้านี้', items: { type: 'string' } },
  },
  required: [
    'vendor', 'clientName', 'projectName', 'employeeName', 'position', 'period',
    'documentNo', 'approvalStatus', 'totalWorkDays', 'totalLeaveDays', 'totalHours', 'days', 'leaveDays',
    'signedByEmployee', 'employeeSignatureName', 'signedByProjectManager', 'projectManagerSignatureName', 'notes',
  ],
  additionalProperties: false,
};

const SYSTEM_PROMPT = `คุณคือผู้ช่วยฝ่ายบัญชีที่อ่านเอกสาร Timesheet ของพนักงาน Outsource

หน้าที่ของคุณคืออ่านค่าที่ปรากฏในเอกสารและถอดออกมาให้ตรงตามที่เขียนไว้ ไม่ใช่คำนวณหรือแก้ไขให้ถูก

กฎที่ต้องทำตาม
- เอกสารอาจถูกแบ่งส่งมาให้ดูทีละหน้า แต่ละหน้าอาจไม่มีข้อมูลบางช่องเลย —
  ช่องไหนไม่เห็นในหน้าที่กำลังดูอยู่ ให้ตอบ null (หรือ 0/false/[] ตามชนิดข้อมูล) ห้ามเดาห้ามแต่งขึ้นเอง
- ชื่อพนักงานและตำแหน่ง ให้คัดตามที่เขียนในเอกสารทุกตัวอักษร ห้ามแปล ห้ามแก้การสะกด ห้ามเติมคำนำหน้า
- ถ้าเห็นลายเซ็นและมีชื่อเขียน/พิมพ์กำกับข้างๆลายเซ็นนั้นด้วย (ไม่ใช่ลายมือเขียนอย่างเดียวที่อ่านไม่ออก)
  ให้คัดชื่อนั้นมาใส่ employeeSignatureName / projectManagerSignatureName ตามช่อง — เห็นแต่ลายเซ็นอ่านไม่ออก
  หรือไม่มีชื่อกำกับเลยให้เป็น null ห้ามเดาชื่อขึ้นมาเอง
- totalWorkDays และ totalLeaveDays ให้อ่านจากช่องสรุปท้ายตารางที่เอกสารเขียนไว้เท่านั้น ห้ามนับแถวเอง
- วันที่ให้คัดมาตามที่เอกสารเขียน ไม่ต้องแปลงรูปแบบเอง (ระบบมีตัวแปลงอยู่แล้ว)
  เช่นเอกสารเขียน "1/1/2569" ก็ตอบ "1/1/2569" · เขียน "18-Jan-26" ก็ตอบ "18-Jan-26"
  ขอแค่คัดให้ครบตัวอักษร อย่าตัดทิ้งและอย่าเติมเอง
- ถ้าอ่านค่าใดไม่ชัดเจน ให้บันทึกลง notes อย่าเดา
- timeIn/timeOut ต้องเป็นของแถว/วันที่นั้นแถวเดียวเท่านั้น ห้ามยกเวลาจากแถวก่อนหน้าหรือแถวถัดไปมาใส่
  ถ้าแถวนั้นเขียนแค่ Weekend/Leave/Holiday โดยไม่มีเวลากำกับเองในแถวนั้น ให้ timeIn และ timeOut เป็น
  null ทั้งคู่ แม้แถวก่อนหรือหลังจะมีเวลาก็ตาม

ฟอร์ม Timesheet ของลูกค้าแต่ละรายไม่เหมือนกัน — สิ่งที่ต่างกันและต้องเผื่อไว้
- ชื่อหัวเอกสารอาจเป็น Timesheet · TimeSheet · Working Report · Monthly Timesheet หรือไม่มีเลย
- ชื่อพนักงานอยู่ในช่องชื่อต่างกัน: Employee Name · Name · Resource Name · Outsource Name
- ตำแหน่งอยู่ในช่อง: Position · Contract Role · Role
- ชื่อลูกค้าอยู่ในช่อง: Client Name · Customer · Project หรืออยู่แค่ในโลโก้หัวกระดาษ
- คอลัมน์รายละเอียดงานชื่อได้หลายแบบ: Job Description · Job Discription (สะกดผิดในต้นฉบับ) ·
  CONTENT · ACTIVITY · Description · Notes — ทั้งหมดถือเป็น jobDescription เหมือนกัน
- คำบอกว่าไม่ได้ทำงานอาจอยู่คนละคอลัมน์กันในแต่ละฟอร์ม — เห็นตรงไหนให้ใส่ตรงนั้นตามช่องของมัน (label / type / remark) อย่าย้ายที่
- บางฟอร์มมีคอลัมน์เพิ่ม เช่น Site, Location, Place, Base hours, Additional hours, OT, Break
  ให้ใส่ค่าที่เกี่ยวกับสถานที่/หมายเหตุลง remark ส่วนคอลัมน์ชั่วโมงไม่ต้องใส่ในแถว
- ถ้าไฟล์มีหน้าอีเมลแจ้งอนุมัติแนบมาด้วย (หัวเรื่อง "แจ้งอนุมัติเอกสาร TimeSheet")
  ให้อ่าน "เลขที่เอกสาร" ลง documentNo และ "สถานะ" ลง approvalStatus
  หน้านั้นไม่มีตารางรายวัน ให้ days และ leaveDays เป็น [] ตามปกติ`;

/** แปลง PDF (Buffer) เป็นรูปภาพทีละหน้า — pdf-to-img รับ path หรือ data URL ไม่รับ Buffer ตรงๆ */
async function pdfToImages(pdfBuffer: Buffer): Promise<Buffer[]> {
  const dataUrl = `data:application/pdf;base64,${pdfBuffer.toString('base64')}`;
  const doc = await pdf(dataUrl, { scale: 2 });
  try {
    const pages: Buffer[] = [];
    for await (const page of doc) pages.push(page as Buffer);
    return pages;
  } finally {
    (doc as any).destroy?.();
  }
}

const HEADER_KEYS = [
  'vendor', 'clientName', 'projectName', 'employeeName', 'position', 'period',
  'documentNo', 'approvalStatus', 'employeeSignatureName', 'projectManagerSignatureName',
] as const;

/**
 * เลือกค่าที่หน้าส่วนใหญ่อ่านตรงกัน — หัวเอกสารพิมพ์ซ้ำอยู่ทุกหน้าของ Timesheet ฉบับเดียวกัน เท่ากับได้
 * อ่านค่าเดียวกันหลายรอบ โหวตแล้วเสียงข้างมากชนะ แทนที่จะหยิบ "ค่าแรกที่ไม่ว่าง" ซึ่งพังทั้งฉบับถ้าหน้า
 * แรกอ่านเพี้ยน
 */
function pickByVote(values: string[] | undefined): string | null {
  if (!values?.length) return null;

  const groups = new Map<string, { count: number; samples: string[] }>();
  for (const raw of values) {
    const value = String(raw).trim();
    if (!value) continue;
    const key = value.toLowerCase().replace(/\s+/g, ' ');
    const group = groups.get(key) ?? { count: 0, samples: [] };
    group.count += 1;
    group.samples.push(value);
    groups.set(key, group);
  }
  if (!groups.size) return null;

  const best = [...groups.values()].sort((a, b) => b.count - a.count || b.samples[0].length - a.samples[0].length)[0];

  const bySpelling = new Map<string, number>();
  for (const sample of best.samples) bySpelling.set(sample, (bySpelling.get(sample) ?? 0) + 1);
  return [...bySpelling.entries()].sort((a, b) => b[1] - a[1])[0][0];
}

const EMPTY_PAGE_DATA = {
  vendor: null, clientName: null, projectName: null, employeeName: null, position: null, period: null,
  documentNo: null, approvalStatus: null, failedPages: [] as number[], totalPages: 0,
  totalWorkDays: 0, totalLeaveDays: 0, totalHours: null as number | null, days: [] as any[], leaveDays: [] as any[],
  otDays: [] as any[],
  signedByEmployee: false, employeeSignatureName: null as string | null,
  signedByProjectManager: false, projectManagerSignatureName: null as string | null, notes: [] as string[],
};

/**
 * หน้าอีเมลแจ้งอนุมัติ Timesheet ที่แนบท้ายไฟล์มาด้วย (ไม่ใช่ตารางรายวัน) — ตรวจจับด้วย regex ตรงๆ ไม่
 * ต้องพึ่งโมเดลเลย เพราะข้อมูลที่ต้องการ (เลขเอกสาร/สถานะ) เขียนเป็นรูปแบบตายตัวอยู่แล้ว
 */
function parseApprovalEmailPage(text: string): typeof EMPTY_PAGE_DATA | null {
  const compact = text.replace(/\s+/g, '');
  if (!/แจ้งอนุมัติเอกสารTimeSheet/.test(compact)) return null;
  return {
    ...EMPTY_PAGE_DATA,
    documentNo: (text.match(/เลข[^\d]{0,20}(\d{5,})/)?.[1] ?? null) as any,
    approvalStatus: (compact.match(/สถานะ:?(ไม่อนุมัติ|รออนุมัติ|อนุมัติ)/)?.[1] ?? null) as any,
  };
}

interface PageResult {
  pageIndex: number;
  data?: any;
  error?: string;
  usage?: { prompt_tokens?: number; completion_tokens?: number } | null;
}

/**
 * รวมผลจากหลายหน้าเป็นก้อนเดียว — เอาค่าที่หน้าส่วนใหญ่อ่านตรงกันของแต่ละฟิลด์หัวเอกสาร, รวม
 * days/leaveDays ทุกหน้าแล้ว dedupe ด้วยวันที่, ลายเซ็นถือว่ามีถ้าหน้าไหนหน้าหนึ่งบอกว่ามี
 */
function mergePageResults(pageResults: PageResult[]) {
  const merged: any = { ...EMPTY_PAGE_DATA, days: [], leaveDays: [], notes: [] };
  const votes: Record<string, string[]> = {};
  const notes: string[] = [];
  const failedPages: number[] = [];
  const rawDays: any[] = [];
  const rawLeaves: any[] = [];
  const rawTotalLeaveClaims: number[] = [];

  for (const { pageIndex, data, error } of pageResults) {
    if (error) {
      failedPages.push(pageIndex);
      notes.push(`อ่านหน้า ${pageIndex} ไม่สำเร็จ: ${error}`);
      continue;
    }

    for (const key of HEADER_KEYS) {
      if (data[key]) (votes[key] ??= []).push(String(data[key]));
    }
    merged.totalWorkDays = Math.max(merged.totalWorkDays, data.totalWorkDays || 0);
    rawTotalLeaveClaims.push(data.totalLeaveDays || 0);
    if (merged.totalHours === null && Number.isFinite(data.totalHours)) merged.totalHours = data.totalHours;

    rawDays.push(...(data.days ?? []));
    rawLeaves.push(...(data.leaveDays ?? []));

    if (data.signedByEmployee) merged.signedByEmployee = true;
    if (data.signedByProjectManager) merged.signedByProjectManager = true;
    for (const note of data.notes ?? []) notes.push(`[หน้า ${pageIndex}] ${note}`);
  }

  for (const key of HEADER_KEYS) merged[key] = pickByVote(votes[key]);

  if (merged.employeeSignatureName && votes.employeeName) {
    const all = [...votes.employeeName, merged.employeeSignatureName];
    merged.employeeName = pickByVote(all) ?? merged.employeeName;
  }

  merged.period = normalizePeriod(merged.period);
  const period = /^\d{4}-\d{2}$/.test(merged.period ?? '') ? merged.period : null;

  const dayByDate = new Map<string, any>();
  const unreadable: string[] = [];
  for (const day of rawDays) {
    const date = normalizeDate(day.date, period);
    if (!date) {
      if (day.date) unreadable.push(String(day.date));
      continue;
    }
    const statusLikeJobDescription =
      day.jobDescription && day.jobDescription.length <= 20 && !day.jobDescription.includes('\n') ? day.jobDescription : null;
    const kind = classifyDayKind(day.label, day.type, day.remark, statusLikeJobDescription);
    const row = {
      ...day,
      date,
      kind,
      label: day.label ?? (kind === 'work' ? null : (day.type ?? day.remark ?? statusLikeJobDescription)),
    };
    const existing = dayByDate.get(date);
    if (!existing || (!existing.timeIn && row.timeIn) || (!existing.label && row.label)) {
      dayByDate.set(date, row);
    }
  }
  if (unreadable.length) {
    notes.push(`อ่านวันที่ไม่ออก ${unreadable.length} แถว: ${[...new Set(unreadable)].slice(0, 5).join(', ')}`);
  }

  const leaveByDate = new Map<string, any>();
  for (const leave of rawLeaves) {
    const date = normalizeDate(leave.date, period);
    if (!date) continue;
    const tableKind = dayByDate.get(date)?.kind;
    if (tableKind === 'holiday' || tableKind === 'weekend') continue;
    leaveByDate.set(date, { ...leave, date, type: classifyLeaveType(leave.rawLabel ?? leave.type) });
  }

  for (const row of dayByDate.values()) {
    if (row.kind === 'leave' && !leaveByDate.has(row.date)) {
      const raw = row.label ?? row.type ?? row.remark ?? '';
      leaveByDate.set(row.date, { date: row.date, type: classifyLeaveType(raw), rawLabel: String(raw) });
    }
  }

  merged.days = [...dayByDate.values()].sort((a, b) => a.date.localeCompare(b.date));
  merged.leaveDays = [...leaveByDate.values()].sort((a, b) => a.date.localeCompare(b.date));

  if (rawTotalLeaveClaims.some((n) => n !== merged.leaveDays.length)) {
    const claimed = Math.max(...rawTotalLeaveClaims);
    notes.push(
      `โมเดลอ่านช่องสรุปวันลาได้ ${claimed} วัน แต่นับจากตารางได้ ${merged.leaveDays.length} วัน `
      + 'ใช้ตัวเลขที่นับจากตารางแทน (แม่นยำกว่า) — ตรวจดูอีกครั้งว่าตรงกับเอกสารจริง',
    );
  }
  merged.totalLeaveDays = merged.leaveDays.length;

  if (merged.totalWorkDays > 31) {
    if (merged.totalHours === null) merged.totalHours = merged.totalWorkDays;
    notes.push(
      `ช่องสรุปวันทำงานอ่านได้ ${merged.totalWorkDays} ซึ่งเกินจำนวนวันในเดือน — `
      + 'น่าจะเป็นชั่วโมงรวมไม่ใช่จำนวนวัน ระบบย้ายไปเป็นชั่วโมงแล้ว ให้คนตรวจยืนยันอีกครั้ง',
    );
    merged.totalWorkDays = 0;
  }

  merged.notes = notes;
  merged.failedPages = failedPages;
  merged.totalPages = pageResults.length;

  return merged;
}

function nameKey(name: string | null | undefined): string {
  return String(name ?? '').toLowerCase().replace(/[^a-z฀-๿]/g, '');
}

/**
 * โมเดลบางครั้งคืนสตริง "null" (4 ตัวอักษร) แทน JSON null สำหรับช่องที่มันไม่รู้จะใส่อะไร — แปลงเป็น
 * null จริงตั้งแต่รับผลจากโมเดลมาเลย กันไม่ให้ "null" ปลอมไปแข่งโหวตกับคำตอบจริงได้ (ดู pickByVote)
 */
function nullifyLiteralNullStrings(value: any): any {
  if (typeof value === 'string') return value.trim().toLowerCase() === 'null' ? null : value;
  if (Array.isArray(value)) return value.map(nullifyLiteralNullStrings);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, nullifyLiteralNullStrings(v)]));
  }
  return value;
}

interface PageRequest {
  model: string;
  userContent: string | Array<Record<string, unknown>>;
  shortCircuitData?: any;
  nameOverride?: string | null;
  periodOverride?: string | null;
  employeeSignatureNameOverride?: string | null;
  projectManagerSignatureNameOverride?: string | null;
  dayRowsOverride?: Array<{ date: string; timeIn: string | null; timeOut: string | null; jobDescription: string | null }> | null;
}

// เซิร์ฟเวอร์ LM Studio แบ่ง context รวมออกเป็นส่วนเท่าๆกันตามจำนวนคำขอพร้อมกัน ยิ่งยิงพร้อมกันมาก แต่ละ
// คำขอยิ่งได้ context น้อยลง — จำกัดไว้ 2 คำขอพร้อมกันกันไม่ให้หน้าที่มีข้อมูลเยอะโดน "Context size exceeded"
const MAX_CONCURRENT_PAGES = 2;

async function runPages(
  pageCount: number,
  buildRequest: (pageIndex0: number) => PageRequest,
  { expectedPeriod, fetchImpl, modelLabel }: { expectedPeriod?: string; fetchImpl?: typeof fetch; modelLabel: (model: string) => string },
) {
  let model = '';
  const settled: PageResult[] = [];
  let next = 0;

  async function worker() {
    while (next < pageCount) {
      const i = next;
      next += 1;
      const pageIndex = i + 1;
      const req = buildRequest(i);
      if (req.shortCircuitData) {
        settled.push({ pageIndex, data: req.shortCircuitData, usage: null });
        continue;
      }
      model = req.model;
      try {
        const result = await callLocalJSON({
          model: req.model, system: SYSTEM_PROMPT, userContent: req.userContent, schema: TIMESHEET_SCHEMA,
          maxTokens: 3000, fetchImpl,
        });
        result.data = nullifyLiteralNullStrings(result.data);
        if (req.nameOverride) result.data.employeeName = req.nameOverride;
        if (req.periodOverride) result.data.period = req.periodOverride;
        if (req.employeeSignatureNameOverride) result.data.employeeSignatureName = req.employeeSignatureNameOverride;
        if (req.projectManagerSignatureNameOverride) result.data.projectManagerSignatureName = req.projectManagerSignatureNameOverride;
        if (req.dayRowsOverride) {
          result.data.days = req.dayRowsOverride
            .filter((r) => r.timeIn)
            .map((r) => ({ date: r.date, timeIn: r.timeIn, timeOut: r.timeOut, label: null, type: null, remark: null, jobDescription: r.jobDescription }));
        }

        if (result.data.employeeName && result.data.position && nameKey(result.data.employeeName) === nameKey(result.data.position)) {
          settled.push({
            pageIndex,
            error: `อ่านชื่อพนักงานไม่น่าเชื่อถือ (ได้ "${result.data.employeeName}" ซ้ำกับตำแหน่งเป๊ะ) — น่าจะอ่านหน้านี้ผิด`,
          });
        } else {
          settled.push({ pageIndex, data: result.data, usage: result.usage });
        }
      } catch (error: any) {
        settled.push({ pageIndex, error: error.message });
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(MAX_CONCURRENT_PAGES, pageCount) }, () => worker()));

  settled.sort((a, b) => a.pageIndex - b.pageIndex);

  if (settled.every((p) => p.error)) {
    throw new Error(`อ่าน Timesheet ไม่สำเร็จเลยสักหน้า (${pageCount} หน้า): ${settled.map((p) => p.error).join(' · ')}`);
  }

  const totalUsage = settled.reduce((acc: { prompt_tokens: number; completion_tokens: number } | null, p) => {
    if (!p.usage) return acc;
    return {
      prompt_tokens: (acc?.prompt_tokens ?? 0) + (p.usage.prompt_tokens ?? 0),
      completion_tokens: (acc?.completion_tokens ?? 0) + (p.usage.completion_tokens ?? 0),
    };
  }, null);

  const data = mergePageResults(settled);
  return { data, model: modelLabel(model), usage: totalUsage };
}

/**
 * ตรวจผลที่โมเดลอ่านมาด้วยโค้ด — จับความไม่สอดคล้องภายในเอกสารเอง ไม่ได้ตรวจกับปฏิทินหรือสัญญา (นั่น
 * เป็นหน้าที่ของ recomputeTimesheet)
 */
function verifyExtraction(data: any, { expectedPeriod }: { expectedPeriod?: string } = {}) {
  const issues: Array<{ severity: string; message: string }> = [];

  if (data.failedPages?.length) {
    issues.push({
      severity: 'fail',
      message: `อ่านไม่สำเร็จ ${data.failedPages.length} หน้าจาก ${data.totalPages ?? '?'} หน้า (หน้า ${data.failedPages.join(', ')}) — ข้อมูลยังไม่ครบทั้งเอกสาร ให้กดอ่านใหม่อีกครั้ง`,
    });
  }

  if (expectedPeriod && data.period !== expectedPeriod) {
    issues.push({ severity: 'fail', message: `เอกสารเป็นรอบ ${data.period} แต่ระบบคาดว่าเป็น ${expectedPeriod}` });
  }

  const periodOk = /^\d{4}-\d{2}$/.test(data.period ?? '');
  if (!periodOk) {
    issues.push({ severity: 'fail', message: `รูปแบบเดือนไม่ถูกต้อง: "${data.period ?? 'ไม่มีข้อมูล'}"` });
  }

  if (data.leaveDays.length !== data.totalLeaveDays) {
    issues.push({ severity: 'fail', message: `ช่องสรุประบุวันลา ${data.totalLeaveDays} วัน แต่รายการวันลามี ${data.leaveDays.length} รายการ` });
  }

  const rowsWithTime = data.days.filter((d: any) => d.timeIn && d.timeOut).length;
  if (rowsWithTime !== data.totalWorkDays) {
    issues.push({ severity: 'warn', message: `ช่องสรุประบุวันทำงาน ${data.totalWorkDays} วัน แต่แถวที่มีเวลาเข้า-ออกมี ${rowsWithTime} แถว` });
  }

  if (data.days.length > 0) {
    const dayByDate = new Map(data.days.map((d: any) => [d.date, d]));
    for (const leave of data.leaveDays) {
      const row: any = dayByDate.get(leave.date);
      if (!row) {
        issues.push({ severity: 'fail', message: `วันลา ${leave.date} ไม่มีแถวในตาราง` });
      } else if ((row.timeIn || row.timeOut) && !isPartialDayLeave(leave)) {
        issues.push({ severity: 'fail', message: `${leave.date} เป็นวันลา แต่มีเวลาเข้า-ออกในตาราง` });
      }
    }
  }

  if (periodOk) {
    for (const row of data.days) {
      if (!row.date?.startsWith(data.period)) {
        issues.push({ severity: 'fail', message: `วันที่ ${row.date} ไม่อยู่ในเดือน ${data.period}` });
      }
    }
  }

  if (!data.signedByEmployee) issues.push({ severity: 'warn', message: 'ไม่พบลายเซ็นพนักงาน' });
  if (!data.signedByProjectManager) issues.push({ severity: 'warn', message: 'ไม่พบลายเซ็นผู้อนุมัติฝั่งลูกค้า' });

  for (const note of data.notes ?? []) issues.push({ severity: 'warn', message: `โมเดลบันทึกไว้: ${note}` });

  return { ok: !issues.some((i) => i.severity === 'fail'), issues };
}

/** วันลาแบบครึ่งวัน/เป็นชั่วโมง (เช่น "Leave 2 Hrs") มีเวลาเข้า-ออกจริงในตารางได้ตามปกติ — ต่างจากวันลา
 * เต็มวันที่ไม่ควรมีเวลาเข้า-ออกเลย */
function isPartialDayLeave(leave: any): boolean {
  return /\d+(\.\d+)?\s*(hrs?|hours?|ชม\.?|ชั่วโมง)/i.test(leave.rawLabel ?? '');
}

export async function extractTimesheetViaLocalLlm(
  pdfBuffer: Buffer,
  { expectedPeriod, fetchImpl }: { expectedPeriod?: string; fetchImpl?: typeof fetch } = {},
) {
  const hint = expectedPeriod
    ? ` รอบบิลที่ระบบคาดไว้คือ ${expectedPeriod} — ถ้าเอกสารไม่ใช่เดือนนี้ ให้ใส่เดือนตามเอกสารและบันทึกลง notes`
    : '';

  let text: Awaited<ReturnType<typeof extractPdfText>> | null = null;

  try {
    text = await extractPdfText(pdfBuffer);
    if (text.hasText) {
      const { data, model, usage } = await runPages(
        text.pages.length,
        (i) => {
          const approvalPage = parseApprovalEmailPage(text!.pages[i]);
          if (approvalPage) return { model: '', userContent: '', shortCircuitData: approvalPage };
          const nameOverride = employeeNameIn(text!.pages[i]);
          const signatures = signatureNamesIn(text!.pages[i], nameOverride);
          const periodOverride = periodIn(text!.pages[i]);
          return {
            model: localTextModel(),
            userContent:
              `ข้างล่างนี้คือข้อความที่ดึงมาจากหน้าที่ ${i + 1}/${text!.pages.length} ของเอกสาร Timesheet `
              + `(เอกสารอาจถูกแบ่งเป็นหลายหน้า) อ่านเฉพาะข้อมูลที่เห็นในหน้านี้ตาม schema ที่กำหนด${hint}\n\n${text!.pages[i]}`,
            nameOverride,
            periodOverride,
            employeeSignatureNameOverride: signatures.employeeSignatureName,
            projectManagerSignatureNameOverride: signatures.projectManagerSignatureName,
            dayRowsOverride: dayRowsIn(text!.pages[i], periodOverride ?? expectedPeriod ?? null),
          };
        },
        { expectedPeriod, fetchImpl, modelLabel: (model) => `local:${model} (ชั้นข้อความ)` },
      );
      return { data, verification: verifyExtraction(data, { expectedPeriod }), usage, model };
    }
  } catch (error: any) {
    console.warn('[extract] อ่านชั้นข้อความไม่สำเร็จ ใช้โมเดล vision แทน —', error.message);
  }

  const pages = await pdfToImages(pdfBuffer);
  const { data, model, usage } = await runPages(
    pages.length,
    (i) => ({
      model: localVisionModel(),
      userContent: [
        { type: 'image_url', image_url: { url: `data:image/png;base64,${pages[i].toString('base64')}` } },
        { type: 'text', text: `นี่คือหน้าที่ ${i + 1}/${pages.length} ของเอกสาร Timesheet ฉบับเดียวกัน (เอกสารอาจถูกแบ่งเป็นหลายหน้า) อ่านเฉพาะข้อมูลที่เห็นในหน้านี้ตาม schema ที่กำหนด${hint}` },
      ],
      nameOverride: text?.pages?.[i] ? employeeNameIn(text.pages[i]) : null,
      periodOverride: text?.pages?.[i] ? periodIn(text.pages[i]) : null,
      employeeSignatureNameOverride: text?.pages?.[i] ? signatureNamesIn(text.pages[i], employeeNameIn(text.pages[i])).employeeSignatureName : null,
      projectManagerSignatureNameOverride: text?.pages?.[i] ? signatureNamesIn(text.pages[i], employeeNameIn(text.pages[i])).projectManagerSignatureName : null,
      dayRowsOverride: text?.pages?.[i] ? dayRowsIn(text.pages[i], periodIn(text.pages[i]) ?? expectedPeriod ?? null) : null,
    }),
    { expectedPeriod, fetchImpl, modelLabel: (model) => `local:${model}` },
  );
  return { data, verification: verifyExtraction(data, { expectedPeriod }), usage, model };
}

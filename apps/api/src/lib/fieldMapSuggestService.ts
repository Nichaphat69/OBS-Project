/**
 * เดา "ชื่อฟิลด์ที่เอกสารของบริษัทนี้ใช้" จากไฟล์ Timesheet ตัวอย่าง — เพื่อเติมหน้าจอจับคู่ฟิลด์ให้
 * ล่วงหน้า แทนที่ Admin ต้องพิมพ์เองทีละช่อง 57 ช่องและติ๊กเองว่าช่องไหนไม่มีในฟอร์ม
 * (เจ้าของระบบสั่ง 27 ก.ย. 69 — "เอาให้สะดวกกับคนใช้ระบบที่สุด")
 *
 * ⚠️ ผลที่คืนไปเป็น **ร่าง** เท่านั้น ห้ามบันทึกทับของเดิมเอง — mapping ที่ผิดทำให้อ่านตัวเลขผิดแล้ว
 * ไหลไปถึงการตั้งบิล คนต้องเห็นว่าระบบเติมอะไรมาและกดบันทึกเองเสมอ (ดู TimesheetFieldMapEditor.tsx)
 *
 * ใช้ชั้นข้อความใน PDF ตรงๆ (extractPdfText) ไม่เรียก OCR/AI เลย — ฟรี เร็ว และตรวจสอบได้ว่าเดาจาก
 * ข้อความไหนในเอกสาร ต่างจากการให้โมเดลตอบ mapping มาให้ซึ่งไล่ที่มาไม่ได้
 */
import {
  TIMESHEET_DOCUMENT_FIELDS,
  TIMESHEET_DETAIL_FIELDS,
  normalizeName,
  type TimesheetFieldSpec,
} from '@obs/domain';
import { extractPdfText } from './pdfTextService.js';

export class FieldMapSuggestError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

export interface SuggestedField {
  /** คีย์กลาง เช่น employeeName */
  key: string;
  /** ข้อความที่เจอในเอกสาร — ใช้เติมลงช่องให้เลย */
  found: string | null;
  /** 0–1 ยิ่งสูงยิ่งมั่นใจ ใช้แยกสีบนหน้าจอว่าอันไหนควรตรวจซ้ำ */
  score: number;
}

export interface FieldMapSuggestion {
  header: SuggestedField[];
  detail: SuggestedField[];
  matched: number;
  total: number;
  notes: string[];
}

/** ตัดข้อความเป็น "ป้ายที่น่าจะเป็นชื่อฟิลด์" — บรรทัด + ช่องที่คั่นด้วยตัวคั่นที่ฟอร์มใช้กันบ่อย */
function candidatesFrom(text: string): string[] {
  const out = new Set<string>();
  for (const line of text.split(/\r?\n/)) {
    for (const piece of line.split(/[|\t]|\s{2,}|:|│/)) {
      const v = piece.replace(/[*_]+/g, ' ').replace(/\s+/g, ' ').trim();
      // ต้องมีตัวอักษรอย่างน้อยหนึ่งตัว (กันตัวเลข/วันที่ล้วนที่เป็น "ค่า" ไม่ใช่ "ชื่อช่อง")
      if (v.length >= 2 && v.length <= 40 && /[A-Za-z฀-๿]/.test(v)) out.add(v);
    }
  }
  return [...out];
}

/** สัดส่วนตัวอักษรที่ใช้ร่วมกัน — ทนต่อการสลับคำ/ตัวคั่นต่างกัน มากกว่าการเทียบตรงตัว */
function overlap(a: string, b: string): number {
  if (!a || !b) return 0;
  const bag = new Map<string, number>();
  for (const ch of a) bag.set(ch, (bag.get(ch) ?? 0) + 1);
  let shared = 0;
  for (const ch of b) {
    const n = bag.get(ch) ?? 0;
    if (n > 0) { bag.set(ch, n - 1); shared += 1; }
  }
  return shared / Math.max(a.length, b.length);
}

/** ชื่อตามสเปก (Employee_Name) กับป้ายไทยของฟิลด์ — สองทางที่เอกสารจริงมักเขียนตรงกับอันใดอันหนึ่ง */
function aliasesOf(spec: TimesheetFieldSpec): string[] {
  return [spec.name.replace(/_/g, ' '), spec.label];
}

/* ต่ำกว่านี้ถือว่าเดาไม่ออก ปล่อยช่องว่างให้คนกรอกเองดีกว่าเติมผิด — ตั้งไว้สูงโดยตั้งใจ เพราะค่าที่
   เติมผิดแล้วคนกดผ่านไปจะกลายเป็นตัวเลขผิดบนใบแจ้งหนี้ ซึ่งแย่กว่าช่องว่างที่เห็นชัดว่ายังไม่ได้ตั้ง */
const ACCEPT = 0.82;

function bestFor(spec: TimesheetFieldSpec, candidates: string[], taken: Set<string>): SuggestedField {
  let best: { found: string; score: number } | null = null;
  for (const cand of candidates) {
    if (taken.has(cand)) continue;
    const c = normalizeName(cand);
    if (!c) continue;
    for (const alias of aliasesOf(spec)) {
      const a = normalizeName(alias);
      if (!a) continue;
      const score = a === c ? 1 : overlap(a, c);
      if (score >= ACCEPT && (!best || score > best.score)) best = { found: cand, score };
    }
  }
  if (best) taken.add(best.found);
  return { key: spec.key, found: best?.found ?? null, score: best?.score ?? 0 };
}

export async function suggestFieldMap({
  fileBase64,
  fileName,
}: {
  fileBase64: string;
  fileName: string;
}): Promise<FieldMapSuggestion> {
  const bytes = Buffer.from(String(fileBase64 ?? ''), 'base64');
  if (bytes.length === 0) throw new FieldMapSuggestError('ไฟล์ว่างหรืออ่านไม่ได้ ลองเลือกไฟล์ใหม่');
  if (!/\.pdf$/i.test(String(fileName ?? ''))) {
    throw new FieldMapSuggestError('ตอนนี้เดาชื่อฟิลด์ได้จากไฟล์ PDF เท่านั้น — ถ้าเป็น Excel ให้บันทึกเป็น PDF ก่อน');
  }

  /* ไฟล์เสีย/ไม่ใช่ PDF จริงทำให้ pdfjs โยน InvalidPDFException ออกมาดิบๆ ถ้าไม่ดักตรงนี้ ข้อความ
     ภาษาอังกฤษของ library จะหลุดไปขึ้นบนหน้าจอผู้ใช้ (ปัญหาเดียวกับที่เจอกับ error ดิบของ Prisma
     เมื่อ 25 ก.ย. 69) — แปลงเป็นข้อความที่บอกได้ว่าต้องทำอะไรต่อ */
  let pdf;
  try {
    pdf = await extractPdfText(bytes);
  } catch {
    throw new FieldMapSuggestError('เปิดไฟล์ PDF นี้ไม่ได้ — ไฟล์อาจเสียหรือไม่ใช่ PDF จริง ลองเปิดดูในเครื่องก่อนแล้วอัปโหลดใหม่');
  }
  if (!pdf.hasText) {
    throw new FieldMapSuggestError(
      'ไฟล์นี้เป็นภาพสแกน ไม่มีชั้นข้อความให้อ่านชื่อฟิลด์ — ต้องกรอกชื่อฟิลด์เอง หรือใช้ไฟล์ PDF ที่ export มาจาก Excel',
    );
  }

  const candidates = candidatesFrom(pdf.pages.join('\n'));
  /* กันไม่ให้ป้ายเดียวถูกใช้ซ้ำหลายฟิลด์ — "Name" เดียวในเอกสารเป็นได้ทั้งชื่อพนักงานและชื่อบริษัท
     ให้ฟิลด์ที่คะแนนสูงกว่าได้ไปก่อน ที่เหลือปล่อยว่างให้คนตัดสิน */
  const taken = new Set<string>();
  const header = TIMESHEET_DOCUMENT_FIELDS.map((f) => bestFor(f, candidates, taken));
  const detail = TIMESHEET_DETAIL_FIELDS.map((f) => bestFor(f, candidates, taken));

  const matched = [...header, ...detail].filter((f) => f.found).length;
  const total = header.length + detail.length;

  const notes: string[] = [];
  notes.push(`อ่านข้อความจากเอกสารได้ ${candidates.length} ป้าย · เดาให้ได้ ${matched} จาก ${total} ฟิลด์`);
  if (matched === 0) {
    notes.push('เดาไม่ได้เลยสักฟิลด์ — ฟอร์มนี้อาจใช้คำเรียกที่ต่างจากสเปกกลางมาก ต้องกรอกเอง');
  }
  notes.push('ทั้งหมดนี้เป็นร่าง ตรวจแล้วกดบันทึกเองก่อนถึงจะมีผล');
  return { header, detail, matched, total, notes };
}

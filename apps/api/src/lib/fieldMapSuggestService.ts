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
  TIMESHEET_FIELD_LABEL_ALIASES,
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
  /** ป้ายทั้งหมดที่อ่านได้จากเอกสาร — ส่งไปให้หน้าจอทำเป็นรายการให้เลือกแทนการพิมพ์เอง */
  labels: string[];
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

/**
 * ทำให้ป้ายสองอันเทียบกันได้ — ตัดเครื่องหมายที่ฟอร์มใส่มาประดับ (`Vender:` `Base hours*` `NO.`)
 * ออกให้หมดก่อน ไม่งั้นป้ายที่ตรงกันอยู่แล้วจะไม่ตรงเพราะเครื่องหมายตัวเดียว
 */
function normalizeLabel(value: string): string {
  return String(value ?? '')
    .normalize('NFC')
    .replace(/[*:._\-()[\]#/\\|"'’“”]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/** สัดส่วนตัวอักษรที่ใช้ร่วมกัน — ทางสุดท้ายเมื่อเทียบแบบอื่นไม่เข้า */
function charOverlap(a: string, b: string): number {
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

/**
 * คะแนนความเหมือนของป้ายสองอัน 0–1
 *
 * ไล่จากเข้มไปหลวม เพราะเหตุผลของแต่ละชั้นต่างกัน — ตรงเป๊ะคือมั่นใจเต็มที่, ต่างแค่ช่องว่าง
 * (`Time in` ↔ `Timein`) แทบเท่ากัน, คำย่อยครบทุกคำ (`Name` อยู่ใน `Resource Name`) ยังเชื่อได้
 * แต่ต้องลดคะแนนตามความยาวที่ต่างกันเพราะยิ่งป้ายในเอกสารยาวกว่ามาก ยิ่งอาจเป็นคนละเรื่อง
 * ส่วนภาษาไทยไม่มีช่องว่างคั่นคำ จึงต้องเทียบแบบ "อยู่ในข้อความ" แทนการตัดคำ
 */
function similarity(aliasRaw: string, candidateRaw: string): number {
  const a = normalizeLabel(aliasRaw);
  const c = normalizeLabel(candidateRaw);
  if (!a || !c) return 0;
  if (a === c) return 1;

  const aTight = a.replace(/ /g, '');
  const cTight = c.replace(/ /g, '');
  if (aTight === cTight) return 0.97;

  const ratio = Math.min(aTight.length, cTight.length) / Math.max(aTight.length, cTight.length);

  /* ทิศทางสำคัญมาก — ป้ายในเอกสารยาวกว่าคำพ้องแล้วครอบคำพ้องไว้ครบ (`Resource Name` ครอบ `Name`)
     คือเอกสารเติมคำขยายเข้าไป เชื่อได้ · แต่ทางกลับกัน คำพ้องยาวกว่าแล้วครอบป้ายไว้ (`Date Range`
     ครอบ `Date`) มักผิด เพราะป้ายสั้นๆ นั้นเป็นของฟิลด์อื่นที่ตรงเป๊ะกว่าอยู่แล้ว — เคยทำให้
     `Date` ตกเป็นของ "ช่วงวันที่ของรอบ" แทนที่จะเป็นคอลัมน์วันที่ (29 ก.ย. 69)
     และต้องยาวใกล้เคียงกันพอสมควรด้วย ไม่งั้น `No` จะไปเข้ากับ `Document No` ได้ */
  const aTokens = a.split(' ');
  const cTokens = c.split(' ');
  if (ratio >= 0.5 && aTokens.every((t) => cTokens.includes(t))) return 0.8 + 0.15 * ratio;

  // ภาษาไทยเขียนติดกัน ตัดคำไม่ได้ — ใช้กฎทิศทางเดียวกัน คือป้ายในเอกสารต้องเป็นฝั่งที่ยาวกว่า
  if (ratio >= 0.5 && aTight.length >= 3 && cTight.includes(aTight)) return 0.78 + 0.15 * ratio;

  // เพดาน 0.7 โดยตั้งใจ — ให้ต่ำกว่าเกณฑ์รับเสมอ ใช้เป็นตัวจัดอันดับเท่านั้น ไม่ใช่ตัวตัดสิน
  return Math.min(0.7, charOverlap(aTight, cTight));
}

/* ต่ำกว่านี้ถือว่าเดาไม่ออก ปล่อยช่องว่างให้คนกรอกเองดีกว่าเติมผิด — mapping ที่ผิดทำให้อ่านตัวเลขผิด
   แล้วไหลไปถึงการตั้งบิล ซึ่งแย่กว่าช่องว่างที่เห็นชัดว่ายังไม่ได้ตั้ง */
const ACCEPT = 0.75;

/** คำที่เอกสารจริงใช้เรียกฟิลด์นี้ + ชื่อตามสเปก + ป้ายไทยของเราเอง */
function aliasesOf(spec: TimesheetFieldSpec): string[] {
  return [spec.name.replace(/_/g, ' '), spec.label, ...(TIMESHEET_FIELD_LABEL_ALIASES[spec.key] ?? [])];
}

/**
 * จับคู่ป้ายในเอกสารกับฟิลด์ตามสารบัญ — แยกออกมาเป็นฟังก์ชันล้วนเพื่อให้เทสต์ยิงตรงได้
 * โดยไม่ต้องมีไฟล์ PDF จริง (ดู apps/api/test/fieldMapSuggest.test.ts ที่ใช้ป้ายจากฟอร์มจริง 7 เจ้า)
 *
 * **ต้องส่งฟิลด์ทุกกลุ่มมาพร้อมกันในครั้งเดียว** — เลือกคู่ที่คะแนนสูงที่สุดก่อนเสมอ ไม่ใช่ไล่ตามลำดับ
 * ฟิลด์หรือแยกเรียกทีละกลุ่ม ป้ายเดียวในเอกสารเป็นได้หลายฟิลด์ (`Name` เป็นได้ทั้งชื่อพนักงานและ
 * ชื่อบริษัท) ถ้าแยกเรียก กลุ่มที่เรียกก่อนจะคว้าไปทั้งที่อีกกลุ่มตรงกว่า — เคยทำให้กลุ่มหัวเอกสาร
 * คว้าคอลัมน์ `Date` `Work` `NO.` ไปหมด เหลือช่องรายวันว่างเปล่าทั้งตาราง (29 ก.ย. 69)
 *
 * ป้ายหนึ่งใช้ได้กับฟิลด์เดียว ที่เหลือปล่อยว่างให้คนตัดสิน
 */
export function matchFieldLabels(
  specs: TimesheetFieldSpec[],
  candidates: string[],
): SuggestedField[] {
  const taken = new Set<string>();
  const pairs: Array<{ key: string; found: string; score: number }> = [];
  for (const spec of specs) {
    for (const cand of candidates) {
      let best = 0;
      for (const alias of aliasesOf(spec)) {
        const score = similarity(alias, cand);
        if (score > best) best = score;
      }
      if (best >= ACCEPT) pairs.push({ key: spec.key, found: cand, score: best });
    }
  }
  pairs.sort((x, y) => y.score - x.score);

  const chosen = new Map<string, { found: string; score: number }>();
  for (const p of pairs) {
    if (chosen.has(p.key) || taken.has(p.found)) continue;
    chosen.set(p.key, { found: p.found, score: p.score });
    taken.add(p.found);
  }
  return specs.map((spec) => ({
    key: spec.key,
    found: chosen.get(spec.key)?.found ?? null,
    score: chosen.get(spec.key)?.score ?? 0,
  }));
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
  /* จับคู่ทั้งสองกลุ่มพร้อมกันครั้งเดียว แล้วค่อยหั่นกลับ — ห้ามเรียกทีละกลุ่ม (ดูเหตุผลใน matchFieldLabels) */
  const all = matchFieldLabels([...TIMESHEET_DOCUMENT_FIELDS, ...TIMESHEET_DETAIL_FIELDS], candidates);
  const header = all.slice(0, TIMESHEET_DOCUMENT_FIELDS.length);
  const detail = all.slice(TIMESHEET_DOCUMENT_FIELDS.length);

  const matched = [...header, ...detail].filter((f) => f.found).length;
  const total = header.length + detail.length;

  const notes: string[] = [];
  notes.push(`อ่านข้อความจากเอกสารได้ ${candidates.length} ป้าย · เดาให้ได้ ${matched} จาก ${total} ฟิลด์`);
  if (matched === 0) {
    notes.push('เดาไม่ได้เลยสักฟิลด์ — ฟอร์มนี้อาจใช้คำเรียกที่ต่างจากสเปกกลางมาก ต้องกรอกเอง');
  }
  if (matched > 0 && matched < total) {
    notes.push('ช่องที่ยังว่างอยู่ เลือกจากรายการป้ายที่อ่านได้จากเอกสารได้เลย ไม่ต้องพิมพ์เอง');
  }
  notes.push('ทั้งหมดนี้เป็นร่าง ตรวจแล้วกดบันทึกเองก่อนถึงจะมีผล');
  return { header, detail, matched, total, labels: candidates, notes };
}

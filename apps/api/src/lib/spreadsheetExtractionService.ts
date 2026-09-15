/**
 * อ่านไฟล์ Timesheet แบบ CSV/XLSX — เทมเพลตของ iPassion เอง ("Requirement ใหม่" 17 ก.ย. 69: นอกจาก
 * PDF ผ่าน ABBYY แล้ว ต้องรับไฟล์ตารางที่พนักงาน/ไซต์กรอกเองด้วย) ยืนยันโครงสร้างจากไฟล์ตัวอย่างจริง
 * ("CP Axtra Natthaphon 7-2026.pdf.xlsx" — ชื่อไฟล์มี .pdf.xlsx ต่อกันแต่เนื้อไฟล์เป็น xlsx จริง)
 *
 * สำคัญ: แถว "ชื่อบริษัท :" ในไฟล์ตัวอย่างคือ "iPassion Co., Ltd." เอง (vendor ฝั่งเรา ไม่ใช่ลูกค้า) —
 * แปลว่านี่คือเทมเพลตเดียวที่ iPassion แจกให้ทุกไซต์/พนักงานกรอกเหมือนกันหมด **ไม่ใช่** format ที่ต่าง
 * กันไปตามลูกค้าแต่ละรายแบบปัญหา ABBYY เดิม (ดู abbyyClient.ts) — จึงอ่านด้วยโครงสร้างเดียวได้ ไม่ต้องมี
 * "หลาย Skill" แบบฝั่งนั้น
 *
 * โครงสร้างที่พบจริง (แถวอาจขยับได้เล็กน้อยถ้ามีการแก้เทมเพลต จึงค้นหาด้วยข้อความหัวคอลัมน์ ไม่ยึดเลข
 * แถว/คอลัมน์ตรงๆ):
 *   หัวกระดาษ: "ชื่อบริษัท :" / "ไซต์" / "เดือน/ปี :" / "ชื่อ-สกุล :"
 *   หัวตาราง 2 แถว: แถวบนเป็นชื่อกลุ่ม ("วันที่"/"ปกติ"/"ล่วงเวลา"/"รายละเอียด"/"เวลาที่ใช้"),
 *     แถวล่างเป็นชื่อคอลัมน์ย่อย — "เวลาเข้า"/"เวลาออก"/"พัก (ชั่วโมง)" ปรากฏ 2 ชุด (ชุดแรก = ปกติ,
 *     ชุดที่สอง = ล่วงเวลา) และ "ปกติ"/"ล่วงเวลา"/"รวม" (ชั่วโมงที่ใช้จริง) อย่างละ 1 ครั้ง
 *   แถวรายวัน: วันที่ (บางไฟล์อาจซ้ำ 2 คอลัมน์), เวลาเข้า-ออก/พักปกติ, เวลาเข้า-ออก/พัก OT, รายละเอียด
 *     (ข้อความงาน หรือป้ายวันลา/วันหยุดแทนที่ข้อความงานในวันที่ไม่ได้ทำงาน), ชั่วโมงปกติ/OT/รวม
 *   แถวปิดท้าย: "รวม" (สรุปยอด) แล้วตามด้วยแถวเซ็นชื่อ "พนักงาน"/"หัวหน้างาน"/"ผู้จัดการ"
 *
 * ไม่มีช่อง "ตำแหน่ง" ในเทมเพลตนี้เลย — ส่ง position เป็นสตริงว่าง ให้ checkPosition() ใน matching.ts
 * จัดการเอง (คืน ok:true พร้อมโน้ต "Timesheet ไม่ได้ระบุตำแหน่ง" อยู่แล้ว ไม่ต้องแก้อะไรที่นั่น)
 *
 * totalWorkDays นับจากคอลัมน์ "ชั่วโมงปกติที่ใช้จริง" > 0 ต่อแถว (ไม่ใช่นับจากมีเวลาเข้า-ออกหรือเปล่า —
 * ไฟล์ตัวอย่างจริงมีแถววันหยุดนักขัตฤกษ์ที่ยังกรอกเวลาเข้า-ออกไว้ตามเทมเพลตแต่ชั่วโมงที่ใช้จริงเป็น 0
 * ต้องไม่นับเป็นวันทำงาน) ผลรวมที่คำนวณได้ตรงกับแถว "รวม" ท้ายตารางในไฟล์ตัวอย่างจริงเป๊ะ (152 ชม.)
 *
 * ไม่มีไฟล์ตัวอย่าง .csv จริง (มีแค่ .xlsx) — ออกแบบให้รองรับ .csv ที่เป็นตารางเดียวกันนี้ export แบบ
 * flat (ไม่มี merged cell/floating date object แค่ข้อความ/ตัวเลขล้วน) ผ่านตัวอ่าน grid เดียวกัน — ถ้า
 * รูปแบบจริงต่างจากนี้ต้องปรับ parseGrid()/findTableHeader() ใหม่หลังได้ไฟล์ตัวอย่างจริงมาเทียบ
 */
import * as XLSX from 'xlsx';
import { classifyDayKind, classifyLeaveType, normalizeDate, normalizePeriod } from '@obs/domain';
import type { Extractor, ExtractedData, ExtractedDay } from './ingestService.js';

export class SpreadsheetExtractionError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

type Cell = string | number | null | undefined;
type Grid = Cell[][];

/** sniff เนื้อไฟล์เอง แทนที่จะเชื่อนามสกุลไฟล์ (ไฟล์ตัวอย่างจริงที่ได้มาชื่อ "...pdf.xlsx" — พิสูจน์แล้ว
 * ว่าชื่อไฟล์เชื่อไม่ได้) — xlsx คือ zip (ขึ้นต้นด้วย "PK"), ที่เหลือถือเป็นข้อความ CSV/TSV ล้วน
 *
 * จงใจ**ไม่ใช้** `cellDates:true` — ทดสอบกับไฟล์ตัวอย่างจริงแล้วพบว่า SheetJS แปลงเป็น JS `Date` แบบ UTC
 * แต่ `Date.getFullYear()/getDate()` อ่านค่ากลับแบบ timezone ท้องถิ่นของเครื่องที่รัน ทำให้วันที่คลาดเคลื่อน
 * ไปเมื่อรันในเครื่อง/คอนเทนเนอร์ที่ timezone ไม่ใช่ UTC (เจอจริง: 1 ก.ค. 69 กลายเป็น 30 มิ.ย. 69) —
 * อ่านเป็นเลข serial ดิบ (`raw:true`) แล้วแปลงวันที่/เวลาเองด้วยเลขล้วนแทน กัน timezone ปนเปื้อนทั้งหมด */
function parseGrid(source: Buffer): Grid {
  const isZip = source.length >= 2 && source[0] === 0x50 && source[1] === 0x4b;
  const workbook = isZip
    ? XLSX.read(source, { type: 'buffer', cellDates: false, raw: true })
    : XLSX.read(source.toString('utf-8'), { type: 'string', raw: true });

  const sheetName = workbook.SheetNames[0];
  if (!sheetName) throw new SpreadsheetExtractionError('ไม่พบชีทข้อมูลในไฟล์');
  const sheet = workbook.Sheets[sheetName];
  return XLSX.utils.sheet_to_json<Cell[]>(sheet, { header: 1, raw: true, defval: null }) as Grid;
}

function cellText(cell: Cell): string {
  return cell == null ? '' : String(cell).trim();
}

function toNumber(cell: Cell): number | null {
  if (typeof cell === 'number') return Number.isFinite(cell) ? cell : null;
  const s = cellText(cell);
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/** เลข serial วันที่ของ Excel (จำนวนวันนับจาก 1899-12-30) → คำนวณเองด้วยเลขล้วน ไม่ผ่าน JS Date's
 * timezone-sensitive getters เลย (ดูเหตุผลที่ parseGrid()) ใช้เลขจำนวนเต็มของ serial เท่านั้น
 * (ทศนิยม = เวลาของวัน ไม่เกี่ยวกับวันที่ ดู excelSerialToTimeString) */
const EXCEL_EPOCH_UTC_MS = Date.UTC(1899, 11, 30);
function excelSerialToISODate(serial: number): string {
  const days = Math.floor(serial);
  const d = new Date(EXCEL_EPOCH_UTC_MS + days * 86_400_000);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

/** ส่วนทศนิยมของ serial = สัดส่วนของวัน (0.375 = 9:00, 0.75 = 18:00) — ปัดนาทีที่ใกล้ที่สุด กันเศษ
 * ทศนิยมลอยตัวจาก Excel ทำให้ได้ เช่น 8:59 แทนที่จะเป็น 9:00 เป๊ะ */
function excelSerialToTimeString(serial: number): string {
  const frac = serial - Math.floor(serial);
  const totalMinutes = Math.round(frac * 24 * 60);
  const h = Math.floor(totalMinutes / 60) % 24;
  const m = totalMinutes % 60;
  return `${h}:${String(m).padStart(2, '0')}`;
}

/** วันที่จาก xlsx เป็นเลข serial เสมอ (ดูเหตุผลที่ parseGrid()) — ฝั่ง CSV เป็นข้อความล้วน รูปแบบไม่แน่นอน
 * (ทดสอบ round-trip ไฟล์ตัวอย่างจริงผ่าน SheetJS's sheet_to_csv() เจอ "1 Jul 26" ไม่ใช่ ISO) ใช้
 * normalizeDate() จาก @obs/domain (ตัวเดียวกับที่ ABBYY/local-LLM ใช้อยู่แล้ว ทนรูปแบบวันที่หลากหลาย
 * ที่สุด) เป็น fallback แทนเขียน regex ซ้ำเอง — ต้องมี period กำกับด้วยเผื่อข้อความไม่มีปีชัดเจน */
function toISODate(cell: Cell, period: string | null): string | null {
  if (typeof cell === 'number') return excelSerialToISODate(cell);
  const s = cellText(cell);
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  return normalizeDate(s, period);
}

/** เซลล์เวลาของเทมเพลตนี้เป็นเลข serial ของ Excel เสมอ (ส่วนวันที่ในนั้นเป็นค่าขยะ ใช้แค่เศษทศนิยม =
 * เวลา) เมื่ออ่านจาก xlsx — ฝั่ง CSV (ไม่มีตัวอย่างจริง) จะเป็นข้อความ "H:MM" ธรรมดา รองรับทั้งสองแบบ */
function toTimeString(cell: Cell): string | null {
  if (typeof cell === 'number') return excelSerialToTimeString(cell);
  const s = cellText(cell);
  return /^\d{1,2}:\d{2}$/.test(s) ? s : null;
}

function periodFromCell(cell: Cell): string | null {
  if (typeof cell === 'number') return excelSerialToISODate(cell).slice(0, 7);
  return normalizePeriod(cellText(cell));
}

/** ค่าคอลัมน์ที่ 2 (ถัดจาก label คอลัมน์แรก) ของแถวที่ label ตรงกัน — จงใจดูแค่คอลัมน์ติดกันคอลัมน์เดียว
 * ไม่ไล่หาเซลล์ไม่ว่างถัดไปทั้งแถว เพราะแถวเซ็นชื่อท้ายตาราง (เช่น "หัวหน้างาน") มีคอลัมน์ "วันที่"/ค่าอื่น
 * อยู่ไกลออกไปทางขวาอีกชุด (ดูแถว "พนักงาน" ในไฟล์ตัวอย่างจริง) ถ้าไล่หาทั้งแถวจะไปเจอ label "วันที่"
 * นั้นแทนค่าจริงที่ควรว่างเปล่า (เคยเจอบั๊กนี้จริงตอนเช็คว่าหัวหน้างานเซ็นหรือยัง) */
function findLabeledValue(grid: Grid, label: string): Cell {
  for (const row of grid) {
    if (!row?.length) continue;
    if (cellText(row[0]).startsWith(label)) return row[1] ?? null;
  }
  return null;
}

function indicesOf(row: Cell[], text: string): number[] {
  const out: number[] = [];
  row.forEach((c, i) => { if (cellText(c) === text) out.push(i); });
  return out;
}

interface TableCols {
  date: number;
  description: number;
  timeIn: number;
  timeOut: number;
  otTimeIn: number | null;
  otTimeOut: number | null;
  normalHours: number;
  otHours: number | null;
  totalHours: number | null;
}

interface TableHeader {
  dayRowStart: number;
  cols: TableCols;
}

/** หาแถวหัวตารางรายวัน — แถวที่คอลัมน์แรกคือ "วันที่" เป๊ะ และมีคำว่า "รายละเอียด" อยู่ในแถวเดียวกัน
 * (แถวกลุ่มบน) แล้วอ่านคอลัมน์ย่อยจากแถวถัดไป (แถวกลุ่มล่าง) หยุดอ่านแถวรายวันเมื่อคอลัมน์วันที่อ่าน
 * เป็นวันที่ไม่ได้อีกต่อไป (ถึงแถวสรุป "รวม"/แถวเซ็นชื่อ) */
function findTableHeader(grid: Grid): TableHeader | null {
  for (let r = 0; r < grid.length - 1; r += 1) {
    const row = grid[r] ?? [];
    if (cellText(row[0]) !== 'วันที่') continue;
    const descIdx = row.findIndex((c) => cellText(c).includes('รายละเอียด'));
    if (descIdx === -1) continue;

    const sub = grid[r + 1] ?? [];
    const timeInCols = indicesOf(sub, 'เวลาเข้า');
    const timeOutCols = indicesOf(sub, 'เวลาออก');
    const normalHoursIdx = sub.findIndex((c) => cellText(c) === 'ปกติ');
    const otHoursIdx = sub.findIndex((c) => cellText(c).includes('ล่วงเวลา'));
    const totalHoursIdx = sub.findIndex((c) => cellText(c) === 'รวม');

    if (timeInCols.length === 0 || timeOutCols.length === 0 || normalHoursIdx === -1) continue;

    return {
      dayRowStart: r + 2,
      cols: {
        date: 0,
        description: descIdx,
        timeIn: timeInCols[0],
        timeOut: timeOutCols[0],
        otTimeIn: timeInCols[1] ?? null,
        otTimeOut: timeOutCols[1] ?? null,
        normalHours: normalHoursIdx,
        otHours: otHoursIdx === -1 ? null : otHoursIdx,
        totalHours: totalHoursIdx === -1 ? null : totalHoursIdx,
      },
    };
  }
  return null;
}

export const extractTimesheetFromSpreadsheet: Extractor = async (source, { expectedPeriod } = {}) => {
  if (!Buffer.isBuffer(source)) {
    throw new SpreadsheetExtractionError('ต้องมีไฟล์ CSV/XLSX ให้อ่าน', 400);
  }

  const grid = parseGrid(source);

  const employeeNameCell = findLabeledValue(grid, 'ชื่อ-สกุล');
  const periodCell = findLabeledValue(grid, 'เดือน/ปี');
  const projectNameCell = findLabeledValue(grid, 'ไซต์') ?? findLabeledValue(grid, 'โครงการ');

  const employeeName = cellText(employeeNameCell);
  const period = periodFromCell(periodCell);

  if (!employeeName || !period) {
    throw new SpreadsheetExtractionError(
      'ไฟล์นี้ไม่ตรงกับเทมเพลต Timesheet ของ iPassion (หาแถว "ชื่อ-สกุล :"/"เดือน/ปี :" ไม่เจอ) — ตรวจสอบไฟล์หรือกรอกด้วยมือแทน',
    );
  }

  const header = findTableHeader(grid);
  if (!header) {
    throw new SpreadsheetExtractionError(
      'ไฟล์นี้ไม่ตรงกับเทมเพลต Timesheet ของ iPassion (หาหัวตารางรายวัน "วันที่"/"รายละเอียด" ไม่เจอ) — ตรวจสอบไฟล์หรือกรอกด้วยมือแทน',
    );
  }

  const days: ExtractedDay[] = [];
  const leaveDays: Array<{ date: string; type: string; rawLabel?: string }> = [];
  const otDays: Array<{ date: string; hours: number }> = [];
  const { cols } = header;

  for (let r = header.dayRowStart; r < grid.length; r += 1) {
    const row = grid[r] ?? [];
    const date = toISODate(row[cols.date], period);
    if (!date) break; // ถึงแถวสรุป "รวม"/แถวเซ็นชื่อท้ายตาราง

    const description = cellText(row[cols.description]) || null;
    const normalHours = toNumber(row[cols.normalHours]);
    const otHours = cols.otHours != null ? toNumber(row[cols.otHours]) : null;
    const totalHours = cols.totalHours != null ? toNumber(row[cols.totalHours]) : null;

    days.push({
      date,
      timeIn: toTimeString(row[cols.timeIn]),
      timeOut: toTimeString(row[cols.timeOut]),
      otTimeIn: cols.otTimeIn != null ? toTimeString(row[cols.otTimeIn]) : null,
      otTimeOut: cols.otTimeOut != null ? toTimeString(row[cols.otTimeOut]) : null,
      label: description,
      type: description,
      jobDescription: description,
      remark: null,
      normalHours,
      otHours,
      totalHours,
    });

    if (classifyDayKind(description) === 'leave') {
      leaveDays.push({ date, type: classifyLeaveType(description), rawLabel: description ?? undefined });
    }
    if (otHours && otHours > 0) {
      otDays.push({ date, hours: otHours });
    }
  }

  const totalWorkDays = days.filter((d) => (d.normalHours ?? 0) > 0).length;

  const notes: string[] = [];
  if (days.length === 0) {
    notes.push('อ่านตารางรายวันได้แต่ไม่พบแถวข้อมูลเลย — ตรวจสอบไฟล์ก่อนยืนยัน');
  }
  if (expectedPeriod && period !== expectedPeriod) {
    notes.push(`รอบเดือนที่อ่านได้ (${period}) ไม่ตรงกับที่คาดไว้ (${expectedPeriod}) — ตรวจสอบก่อนยืนยัน`);
  }
  const supervisorSigned = Boolean(
    cellText(findLabeledValue(grid, 'หัวหน้างาน')) || cellText(findLabeledValue(grid, 'ผู้จัดการ')),
  );
  if (!supervisorSigned) {
    notes.push('ไฟล์นี้ยังไม่มีชื่อหัวหน้างาน/ผู้จัดการกำกับท้ายตาราง — ตรวจสอบการอนุมัติก่อนยืนยัน');
  }

  const data: ExtractedData = {
    employeeName,
    position: '', // เทมเพลตนี้ไม่มีช่องตำแหน่ง — checkPosition() ใน matching.ts รองรับค่าว่างอยู่แล้ว
    period,
    totalWorkDays,
    totalLeaveDays: leaveDays.length,
    days,
    leaveDays,
    otDays,
    signedByEmployee: true,
    signedByProjectManager: supervisorSigned,
    notes,
  };

  return {
    data: { ...data, projectName: cellText(projectNameCell) || null } as any,
    verification: { ok: true, issues: notes.map((message) => ({ severity: 'warn', message })) },
    usage: null,
    model: 'spreadsheet',
  };
};

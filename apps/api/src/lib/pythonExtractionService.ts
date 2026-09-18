/**
 * ทดลองอ่าน Timesheet ด้วยสคริปต์ Python (python/timesheet_extractor.py) แทน ABBYY Vantage — ตัวอ่าน
 * นี้เป็นเวอร์ชันทดลอง (17 ก.ย. 69) ยังไม่ได้พิสูจน์กับไฟล์จริงในระบบนี้ ตรวจสอบผลลัพธ์กับ PDF ต้นฉบับ
 * ก่อนยืนยันเสมอ
 *
 * รันสคริปต์แบบ subprocess เพราะตรรกะอ่าน PDF (pymupdf + จับคู่ label/value ตามตำแหน่ง, แก้ปัญหาฟอนต์
 * ไทยแบบ subset ที่สลับวรรณยุกต์) เขียนเป็น Python อยู่แล้ว — ไม่ port มาเป็น TypeScript เพื่อไม่ให้เสีย
 * ของที่พิสูจน์แล้วว่าทำงานถูกกับ PDF ไทยที่ฟอนต์เพี้ยน
 *
 * สคริปต์คืนคีย์ตามสารบัญกลาง (@obs/domain's timesheetFields.ts) อยู่แล้วทั้ง header/details ต่อหน้า —
 * งานของไฟล์นี้จึงเหลือแค่ (1) รวมหลายหน้าเป็นเอกสารเดียว (2) normalize วันที่/รอบเดือนด้วยตัวแปลงกลาง
 * เดียวกับตัวอ่านอื่น (3) แยกวันลา/OT ออกมาเป็นรายการ (4) แปลงคีย์รายวัน 3 ตัวที่ชื่อยังไม่ตรงสเปกให้
 * extractionService.ts's normalizeDetailKeys() จัดการต่อ (ส่งคีย์ตามสเปกตรงๆ ไป: day/remarks/workType)
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizePeriod, normalizeDate, classifyDayKind, classifyLeaveType } from '@obs/domain';
import { verifyExtraction } from './localExtractionService.js';
import { ExtractionError } from './extractionService.js';

const execFileAsync = promisify(execFile);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// apps/api/src/lib -> ขึ้นไป 4 ชั้นถึงรากรีโป แล้วลง python/ — ยึดตำแหน่งไฟล์นี้เอง ไม่ใช่ cwd ตอนรัน
// เพราะ cwd เปลี่ยนไปตามวิธีสั่งรัน (tsx watch จาก apps/api, docker, ฯลฯ)
const DEFAULT_SCRIPT_PATH = path.resolve(__dirname, '../../../../python/timesheet_extractor.py');
const SCRIPT_PATH = process.env.PYTHON_EXTRACTOR_PATH || DEFAULT_SCRIPT_PATH;
const PYTHON_BIN = process.env.PYTHON_BIN || 'python';

export function hasPythonExtractor(): boolean {
  return fsSync.existsSync(SCRIPT_PATH);
}

interface PythonDetailRow {
  rowNumber?: number | string | null;
  date?: string | null;
  day?: string | null;
  project?: string | null;
  site?: string | null;
  workLocation?: string | null;
  workType?: string | null;
  timeIn?: string | null;
  timeOut?: string | null;
  breakHours?: string | number | null;
  otTimeIn?: string | null;
  otTimeOut?: string | null;
  otBreakHours?: string | number | null;
  normalHours?: string | number | null;
  otHours?: string | number | null;
  totalHours?: string | number | null;
  additionalHours?: string | number | null;
  jobDescription?: string | null;
  activity?: string | null;
  leaveType?: string | null;
  leaveDays?: string | number | null;
  remarks?: string | null;
}

interface PythonHeader {
  vendorName?: string | null;
  clientName?: string | null;
  projectName?: string | null;
  employeeName?: string | null;
  employeeId?: string | null;
  position?: string | null;
  role?: string | null;
  department?: string | null;
  monthYear?: string | null;
  reportingPeriod?: string | null;
  supervisorName?: string | null;
  approverName?: string | null;
  site?: string | null;
  projectTeam?: string | null;
}

interface PythonPage {
  page: number;
  header: PythonHeader;
  details: PythonDetailRow[];
  summary?: { totalWorkDays?: number; totalLeaveDays?: number; totalHours?: number };
}

interface PythonOutput {
  source: string;
  type: 'pdf' | 'excel';
  pages?: PythonPage[];
}

const HEADER_KEYS = [
  'vendorName', 'clientName', 'projectName', 'employeeName', 'employeeId', 'position', 'role',
  'department', 'monthYear', 'reportingPeriod', 'supervisorName', 'approverName', 'site', 'projectTeam',
] as const;

function mergeHeaders(pages: PythonPage[]): PythonHeader {
  const merged: Record<string, string | null> = {};
  for (const key of HEADER_KEYS) {
    for (const page of pages) {
      const value = page.header?.[key];
      if (value) {
        merged[key] = value;
        break;
      }
    }
  }
  return merged;
}

function toNumberOrNull(raw: unknown): number | null {
  if (raw === null || raw === undefined || String(raw).trim() === '') return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

/** เชื่อฟิลด์รวม (monthYear) ก่อน ตกไปทาง reportingPeriod ถ้าอ่านรอบเดือนตรงๆ ไม่ได้ — ใช้ normalizePeriod
 * กลางตัวเดียวกับที่ตัวอ่าน local-LLM ใช้ (รองรับเดือนไทย/อังกฤษและปี พ.ศ./ค.ศ.) */
function resolvePeriod(header: PythonHeader): string | null {
  for (const raw of [header.monthYear, header.reportingPeriod]) {
    if (!raw) continue;
    const parsed = normalizePeriod(raw);
    if (parsed && /^\d{4}-\d{2}$/.test(parsed)) return parsed;
  }
  return null;
}

function buildDays(details: PythonDetailRow[], period: string | null) {
  const days: Array<Record<string, unknown>> = [];
  let rowNumber = 0;
  for (const row of details) {
    const date = normalizeDate(row.date, period);
    if (!date) continue;
    rowNumber += 1;

    const normalHours = toNumberOrNull(row.normalHours);
    const otHours = toNumberOrNull(row.otHours);
    const totalHours =
      toNumberOrNull(row.totalHours) ??
      (normalHours !== null || otHours !== null ? Math.round(((normalHours ?? 0) + (otHours ?? 0)) * 100) / 100 : null);

    days.push({
      date,
      // คีย์ตามสารบัญกลาง — extractionService.ts's normalizeDetailKeys() แปลงเป็นชื่อภายในให้เอง
      day: row.day ?? null,
      remarks: row.remarks ?? null,
      workType: row.workType ?? null,
      project: row.project ?? null,
      timeIn: row.timeIn ?? null,
      timeOut: row.timeOut ?? null,
      otTimeIn: row.otTimeIn ?? null,
      otTimeOut: row.otTimeOut ?? null,
      jobDescription: row.jobDescription ?? null,
      // ค่าจัดประเภทวันภายใน ใช้เทียบกับปฏิทินตอนตรวจ Manday (ไม่มีในสารบัญกลาง)
      label: [row.workType, row.leaveType].filter(Boolean).join(' ') || null,
      normalHours,
      otHours,
      totalHours,
      rowNumber,
      site: row.site ?? null,
      workLocation: row.workLocation ?? null,
      breakHours: toNumberOrNull(row.breakHours),
      otBreakHours: toNumberOrNull(row.otBreakHours),
      additionalHours: toNumberOrNull(row.additionalHours),
      activity: row.activity ?? null,
      leaveType: row.leaveType ?? null,
      leaveDays: toNumberOrNull(row.leaveDays),
    });
  }
  return days;
}

function buildLeaveDays(details: PythonDetailRow[], period: string | null) {
  const leaveDays: Array<{ date: string; type: string; rawLabel: string }> = [];
  for (const row of details) {
    const date = normalizeDate(row.date, period);
    if (!date) continue;

    const rawLabel = [row.leaveType, row.workType, row.remarks].filter(Boolean).join(' ');
    const leaveDaysValue = toNumberOrNull(row.leaveDays);
    const isLeave =
      Boolean(row.leaveType && row.leaveType.trim()) ||
      (leaveDaysValue !== null && leaveDaysValue > 0) ||
      classifyDayKind(row.workType, row.leaveType, row.remarks) === 'leave';
    if (!isLeave) continue;

    leaveDays.push({ date, type: classifyLeaveType(row.leaveType || rawLabel), rawLabel: rawLabel || row.leaveType || '' });
  }
  return leaveDays;
}

function buildOtDays(details: PythonDetailRow[], period: string | null) {
  const otDays: Array<{ date: string; hours: number }> = [];
  for (const row of details) {
    const date = normalizeDate(row.date, period);
    if (!date) continue;
    const hours = toNumberOrNull(row.otHours);
    if (hours !== null && hours > 0) otDays.push({ date, hours });
  }
  return otDays;
}

async function runPythonExtractor(inputPath: string, outputPath: string): Promise<void> {
  try {
    await execFileAsync(PYTHON_BIN, [SCRIPT_PATH, inputPath, outputPath], {
      timeout: 60_000,
      maxBuffer: 20 * 1024 * 1024,
    });
  } catch (error: any) {
    const detail = error.stderr || error.message;
    throw new ExtractionError(`เรียกสคริปต์ Python (timesheet_extractor.py) ไม่สำเร็จ: ${detail}`);
  }
}

export async function extractTimesheetViaPython(source: Buffer, { expectedPeriod }: { expectedPeriod?: string } = {}) {
  if (!hasPythonExtractor()) {
    throw new ExtractionError(
      `ไม่พบสคริปต์ Python สำหรับอ่าน Timesheet ที่ ${SCRIPT_PATH} — ตั้ง PYTHON_EXTRACTOR_PATH ใน .env ถ้าไฟล์อยู่ที่อื่น`,
    );
  }

  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'obs-py-extract-'));
  const inputPath = path.join(tmpDir, 'input.pdf');
  const outputPath = path.join(tmpDir, 'output.json');

  try {
    await fs.writeFile(inputPath, source);
    await runPythonExtractor(inputPath, outputPath);
    const raw = JSON.parse(await fs.readFile(outputPath, 'utf-8')) as PythonOutput;

    if (raw.type !== 'pdf' || !raw.pages) {
      throw new ExtractionError('ตัวอ่าน Python รองรับเฉพาะไฟล์ PDF ในตอนนี้ (ไฟล์ Excel ยังไม่ได้ map เป็นฟิลด์กลาง)');
    }

    const header = mergeHeaders(raw.pages);
    const allDetails = raw.pages.flatMap((p) => p.details ?? []);
    const period = resolvePeriod(header) ?? (expectedPeriod && /^\d{4}-\d{2}$/.test(expectedPeriod) ? expectedPeriod : null);

    const days = buildDays(allDetails, period);
    const leaveDays = buildLeaveDays(allDetails, period);
    const otDays = buildOtDays(allDetails, period);
    // นับจากตารางเป็นค่าหลัก — สคริปต์ยังไม่ได้อ่านช่องสรุปท้ายเอกสาร (Total Work days ฯลฯ) ตรงๆ
    const totalWorkDays = days.filter((d) => Number(d.normalHours ?? 0) > 0).length;
    const totalLeaveDays = leaveDays.length;

    const notes: string[] = [
      'อ่านด้วยสคริปต์ Python (timesheet_extractor.py) — ตัวอ่านทดลอง ยังไม่ได้พิสูจน์กับไฟล์จริงในระบบนี้ ตรวจสอบผลลัพธ์กับ PDF ต้นฉบับก่อนยืนยันทุกครั้ง',
    ];
    if (days.length === 0) notes.push('อ่านตารางรายวันไม่ได้เลยสักแถว — ต้องกรอกเพิ่มเอง');
    if (!period) notes.push('อ่านรอบเดือนไม่ได้ — ต้องเลือก "รอบเดือน" เอง');
    if (expectedPeriod && period && period !== expectedPeriod) {
      notes.push(`รอบเดือนที่อ่านได้ (${period}) ไม่ตรงกับที่คาดไว้ (${expectedPeriod}) — ตรวจสอบก่อนยืนยัน`);
    }

    const data: any = {
      vendorName: header.vendorName ?? null,
      clientName: header.clientName ?? null,
      projectName: header.projectName ?? null,
      employeeName: header.employeeName ?? null,
      employeeId: header.employeeId ?? null,
      position: header.position ?? null,
      role: header.role ?? null,
      department: header.department ?? null,
      monthYear: header.monthYear ?? null,
      reportingPeriod: header.reportingPeriod ?? null,
      supervisorName: header.supervisorName ?? null,
      approverName: header.approverName ?? null,
      site: header.site ?? null,
      projectTeam: header.projectTeam ?? null,
      period,
      totalWorkDays,
      totalLeaveDays,
      days,
      leaveDays,
      otDays,
      signedByEmployee: Boolean(header.employeeName),
      signedByProjectManager: Boolean(header.approverName),
      notes,
    };

    return {
      data,
      verification: verifyExtraction(data, { expectedPeriod }),
      usage: null,
      model: 'python:timesheet_extractor',
      rawResponse: raw,
    };
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}

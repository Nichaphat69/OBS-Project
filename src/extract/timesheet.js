/**
 * อ่านข้อมูลจากไฟล์ Timesheet PDF ด้วยโมเดล vision ที่รันในเครื่อง (LM Studio/Ollama)
 *
 * มีสองทาง เลือกอัตโนมัติตามตัวเอกสาร
 *
 * 1. ทางเร็ว (ค่าเริ่มต้น) — อ่านชั้นข้อความใน PDF ตรงๆ ด้วย pdfjs แล้วส่งข้อความให้โมเดล
 *    เอกสารเกือบทั้งหมด export มาจาก Excel จึงมีชั้นข้อความสมบูรณ์อยู่แล้ว (14 จาก 15 ฉบับที่สำรวจ)
 *    เร็วกว่าและแม่นกว่าการให้โมเดลมองรูปมาก — ดูตัวเลขที่วัดไว้ใน extract/pdfText.js
 *
 * 2. ทางสำรอง — ไฟล์ที่เป็นภาพสแกนจริง (เช่นภาพหน้าจอเว็บ) ไม่มีชั้นข้อความให้อ่าน
 *    ต้องแปลงเป็นรูปแล้วส่งให้โมเดล vision "มองเห็น" (LOCAL_LLM_VISION_MODEL)
 *
 * ⚠️ อ่านทีละหน้า ไม่ส่งทุกหน้าในคำขอเดียว — ทดสอบกับเอกสารจริงแล้วว่าโมเดลขนาด 4B
 * เมื่อได้รับภาพ 4 หน้าขึ้นไปพร้อมกัน (รวมกับ schema ที่ซับซ้อน) จะ "ปฏิเสธ" ทั้งคำขอ
 * ("I cannot fulfill this request") แม้ทีละ 1-3 หน้าจะไม่ปฏิเสธ เอกสาร Timesheet จริง
 * ที่ export จาก Excel กว้างเกินหน้าเดียว มักถูกตัดเป็นหลายหน้า PDF แยกฝั่งซ้าย/ขวา
 * (ฝั่งซ้าย: วันที่+เวลา+Job Description, ฝั่งขวา: ชื่อพนักงาน/ตำแหน่ง/Remark/ลายเซ็น)
 * จึงต้องอ่านทีละหน้าแล้วรวมผลด้วยโค้ด — แต่ละหน้าอาจไม่เห็นข้อมูลบางอย่างเลย ต้องปล่อยเป็น
 * null/0/false ได้ (schema จึงยอมให้ฟิลด์หัวเอกสารเป็น null) แล้วเอาค่าที่ไม่ว่างจากหน้าไหนก็ได้มารวมกัน
 *
 * ตัวเลขที่ได้จากโมเดลไม่ถือเป็นข้อสรุป — ต้องผ่าน verifyExtraction()
 * และการคำนวณปฏิทินใน src/domain/manday.js อีกชั้น
 */

import { readFile } from 'node:fs/promises';
import { pdf } from 'pdf-to-img';
import { callLocalJSON, localVisionModel, localTextModel } from '../llm/localClient.js';
import { normalizePeriod, normalizeDate, classifyDayKind, classifyLeaveType } from './normalize.js';
import { extractPdfText, employeeNameIn } from './pdfText.js';

const TIMESHEET_SCHEMA = {
  type: 'object',
  properties: {
    vendor: {
      type: ['string', 'null'],
      description: 'Vendor ที่ระบุในเอกสาร เช่น iPassion Co.,Ltd. — ไม่เห็นในหน้านี้ให้เป็น null',
    },
    clientName: { type: ['string', 'null'], description: 'Client Name ที่ระบุในเอกสาร — ไม่เห็นในหน้านี้ให้เป็น null' },
    projectName: { type: ['string', 'null'], description: 'ไม่เห็นในหน้านี้ให้เป็น null' },
    employeeName: {
      type: ['string', 'null'],
      description: 'Employee Name ตามที่เขียนในเอกสาร ห้ามแก้การสะกด — ไม่เห็นในหน้านี้ให้เป็น null',
    },
    position: { type: ['string', 'null'], description: 'Position ตามที่เขียนในเอกสาร ห้ามแปลหรือแก้ — ไม่เห็นในหน้านี้ให้เป็น null' },
    period: {
      type: ['string', 'null'],
      description: 'เดือนของ Timesheet ในรูปแบบ YYYY-MM เช่น 2026-01 — ไม่เห็นในหน้านี้ให้เป็น null',
    },
    documentNo: {
      type: ['string', 'null'],
      description:
        'เลขที่เอกสารจากหน้าอีเมลแจ้งอนุมัติที่แนบมาท้ายไฟล์ (บรรทัด "เลขที่เอกสาร : 2026010087") ' +
        '— ไม่มีหน้านั้นในหน้านี้ให้เป็น null',
    },
    approvalStatus: {
      type: ['string', 'null'],
      description:
        'สถานะจากหน้าอีเมลแจ้งอนุมัติ (บรรทัด "สถานะ : อนุมัติ") — ไม่เห็นให้เป็น null',
    },
    totalWorkDays: {
      type: 'integer',
      description:
        'จำนวนวันทำงานจากช่องสรุปท้ายตาราง ไม่ต้องนับแถวเอง — ชื่อช่องต่างกันไปตามฟอร์ม เช่น ' +
        'Total Work days · Total base man-day · No. Manday · Summary Work Days · Claim to APHD ' +
        '(ถ้าช่องสรุปเป็นชั่วโมงรวม เช่น 160.00 ให้ใส่ในช่อง totalHours แทน) — ไม่เห็นให้เป็น 0',
    },
    totalLeaveDays: {
      type: 'integer',
      description: 'จำนวนวันลาจากช่องสรุปท้ายตาราง เช่น Leave/Sick (days) หรือคอลัมน์ Leave — ไม่เห็นให้เป็น 0',
    },
    totalHours: {
      type: ['number', 'null'],
      description:
        'ชั่วโมงรวมจากช่องสรุป เช่น "Total duration (hour in decimal) 160.00" หรือ TOTAL 140.00 ' +
        'ของฟอร์ม Fujitsu — ฟอร์มที่สรุปเป็นวันไม่มีช่องนี้ ให้เป็น null',
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
            description:
              'ป้ายกำกับของแถวเมื่อไม่ได้ทำงาน คัดตามที่เขียนในเอกสารทุกตัวอักษร ' +
              'เช่น Holiday, Public Holiday, Weekend, Sick leave, Personal Leave, ANNUAL LEAVE ' +
              '— วันทำงานปกติให้เป็น null',
          },
          type: {
            type: ['string', 'null'],
            description:
              'ค่าในคอลัมน์ Type (ถ้าฟอร์มนี้มี) เช่น Working, Weekend, Public Holiday — ไม่มีคอลัมน์นี้ให้เป็น null',
          },
          remark: {
            type: ['string', 'null'],
            description:
              'ค่าในคอลัมน์ Remark / Remarks / Note / Location / Place ของแถวนี้ — ไม่มีให้เป็น null',
          },
          jobDescription: { type: ['string', 'null'] },
        },
        // type / remark เป็นของเสริมที่มีเฉพาะบางฟอร์ม ไม่บังคับให้โมเดลตอบ
        required: ['date', 'timeIn', 'timeOut', 'label', 'jobDescription'],
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
          type: {
            type: 'string',
            enum: ['sick', 'personal', 'vacation', 'unpaid', 'unknown'],
            description: 'Sick leave→sick, ลากิจ→personal, ลาพักร้อน→vacation',
          },
          rawLabel: { type: 'string', description: 'ข้อความที่เขียนในเอกสารตามจริง' },
        },
        required: ['date', 'type', 'rawLabel'],
        additionalProperties: false,
      },
    },
    signedByEmployee: {
      type: 'boolean',
      description: 'หน้านี้มีลายเซ็นหรือชื่อพนักงานในช่อง Employee\'s Signature หรือไม่ — ไม่มีช่องนี้ในหน้านี้ให้เป็น false',
    },
    employeeSignatureName: {
      type: ['string', 'null'],
      description:
        'ชื่อที่เขียน/พิมพ์อยู่ข้างลายเซ็นในช่อง Employee\'s Signature (คนละช่องจาก Employee Name ด้านบน '
        + 'อาจเขียนชื่อไม่ตรงกันก็ได้) — อ่านลายเซ็นไม่ออกหรือไม่มีชื่อกำกับให้เป็น null ห้ามเดา',
    },
    signedByProjectManager: {
      type: 'boolean',
      description: 'หน้านี้มีลายเซ็นในช่อง Project Manager\'s Signature (TLI) หรือไม่ — ไม่มีช่องนี้ในหน้านี้ให้เป็น false',
    },
    projectManagerSignatureName: {
      type: ['string', 'null'],
      description:
        'ชื่อที่เขียน/พิมพ์อยู่ข้างลายเซ็นในช่อง Project Manager\'s Signature (TLI) — '
        + 'อ่านลายเซ็นไม่ออกหรือไม่มีชื่อกำกับให้เป็น null ห้ามเดา',
    },
    notes: {
      type: 'array',
      description: 'สิ่งที่อ่านไม่ชัด ขัดแย้งกันเอง หรือควรให้คนตรวจ เฉพาะในหน้านี้',
      items: { type: 'string' },
    },
  },
  /* documentNo · approvalStatus · totalHours ไม่ใส่ในนี้ตั้งใจ — มีเฉพาะบางฟอร์ม
     ถ้าบังคับ โมเดลที่ไม่ตอบคีย์พวกนี้จะทำให้อ่านทั้งไฟล์ล้มทั้งที่ข้อมูลหลักครบแล้ว */
  required: [
    'vendor', 'clientName', 'projectName', 'employeeName', 'position', 'period',
    'totalWorkDays', 'totalLeaveDays', 'days', 'leaveDays',
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

ฟอร์ม Timesheet ของลูกค้าแต่ละรายไม่เหมือนกัน — สิ่งที่ต่างกันและต้องเผื่อไว้
- ชื่อหัวเอกสารอาจเป็น Timesheet · TimeSheet · Working Report · Monthly Timesheet หรือไม่มีเลย
- ชื่อพนักงานอยู่ในช่องชื่อต่างกัน: Employee Name · Name · Resource Name · Outsource Name
- ตำแหน่งอยู่ในช่อง: Position · Contract Role · Role
- ชื่อลูกค้าอยู่ในช่อง: Client Name · Customer · Project หรืออยู่แค่ในโลโก้หัวกระดาษ
- คอลัมน์รายละเอียดงานชื่อได้หลายแบบ: Job Description · Job Discription (สะกดผิดในต้นฉบับ) ·
  CONTENT · ACTIVITY · Description · Notes — ทั้งหมดถือเป็น jobDescription เหมือนกัน
- คำบอกว่าไม่ได้ทำงานอาจอยู่คนละคอลัมน์กันในแต่ละฟอร์ม — อาจอยู่ในช่อง Job Description,
  คอลัมน์ Type, คอลัมน์ Remark/Remarks, หรือเป็นแถวเดียวยาวพาดทั้งตาราง
  เห็นตรงไหนให้ใส่ตรงนั้นตามช่องของมัน (label / type / remark) อย่าย้ายที่
- บางฟอร์มมีคอลัมน์เพิ่ม เช่น Site, Location, Place, Base hours, Additional hours, OT, Break
  ให้ใส่ค่าที่เกี่ยวกับสถานที่/หมายเหตุลง remark ส่วนคอลัมน์ชั่วโมงไม่ต้องใส่ในแถว
- ถ้าไฟล์มีหน้าอีเมลแจ้งอนุมัติแนบมาด้วย (หัวเรื่อง "แจ้งอนุมัติเอกสาร TimeSheet")
  ให้อ่าน "เลขที่เอกสาร" ลง documentNo และ "สถานะ" ลง approvalStatus
  หน้านั้นไม่มีตารางรายวัน ให้ days และ leaveDays เป็น [] ตามปกติ`;

/**
 * แปลง PDF (path หรือ Buffer) เป็นรูปภาพทีละหน้า — pdf-to-img รับได้แค่ path
 * หรือ data URL ไม่รับ Buffer ตรงๆ จึงต้องแปลง Buffer เป็น data URL ก่อน
 */
async function pdfToImages(pdfBuffer) {
  const dataUrl = `data:application/pdf;base64,${pdfBuffer.toString('base64')}`;
  /* เดิมใช้ scale 3 — ตัวหนังสือในตาราง Timesheet เล็กมาก ภาพใหญ่ขึ้นอ่านง่ายขึ้น (ทดสอบแล้วว่า
     ไม่ได้แก้ชื่ออ่านเพี้ยน เรื่องนั้นแก้ด้วยการโหวตข้ามหน้า pickByVote กับ domain/matching.js
     อยู่แล้ว scale แค่ช่วยความคมชัดของตัวเลข/วันที่)
     11 ส.ค. 69 — ลดกลับมาเป็น scale 2 เพราะ deploy ขึ้นเซิร์ฟเวอร์จริงแล้วพบว่าโมเดล vision ที่ใช้ร่วมกับ
     ระบบอื่นตั้ง context ไว้แค่ 8192 token (ตอน dev เครื่องมี context กว้างกว่านี้) รูป scale 3 ของหน้าที่
     เนื้อหาแน่นๆทำให้ token เกินจน LM Studio ตอบ "Context size has been exceeded" อ่านไม่ได้เลยทั้งหน้า
     เลือกลด scale ฝั่งเราเองแทนการไปเพิ่ม context ที่เซิร์ฟเวอร์ เพราะเครื่องนั้นใช้ร่วมกับระบบอื่น */
  const doc = await pdf(dataUrl, { scale: 2 });
  try {
    const pages = [];
    for await (const page of doc) pages.push(page);
    return pages;
  } finally {
    doc.destroy?.();
  }
}

const HEADER_KEYS = [
  'vendor', 'clientName', 'projectName', 'employeeName', 'position', 'period',
  'documentNo', 'approvalStatus', 'employeeSignatureName', 'projectManagerSignatureName',
];

/**
 * เลือกค่าที่หน้าส่วนใหญ่อ่านตรงกัน
 *
 * ทำไมต้องโหวต: หัวเอกสาร (ชื่อคน ตำแหน่ง ลูกค้า) พิมพ์ซ้ำอยู่ทุกหน้าของ Timesheet ฉบับเดียวกัน
 * เท่ากับได้อ่านค่าเดียวกันหลายรอบ เดิมโค้ดหยิบ "ค่าแรกที่ไม่ว่าง" ซึ่งแปลว่าถ้าหน้าแรกอ่านเพี้ยน
 * ทั้งฉบับก็ผิดตาม ทั้งที่อีก 3 หน้าอ่านถูก — โหวตแล้วเสียงข้างมากชนะ
 *
 * เทียบแบบไม่สนตัวพิมพ์เล็กใหญ่และช่องว่าง เพื่อให้ "Sunee  Maneekasemsuk" กับ
 * "sunee maneekasemsuk" นับเป็นเสียงเดียวกัน แต่คืนค่าตามที่เอกสารเขียนจริง
 * เสมอกัน → เลือกอันที่ยาวกว่า เพราะมักเป็นอันที่อ่านมาได้ครบกว่า (ไม่ถูกตัดกลางคำ)
 */
function pickByVote(values) {
  if (!values?.length) return null;

  const groups = new Map();
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

  const best = [...groups.values()].sort(
    (a, b) => b.count - a.count || b.samples[0].length - a.samples[0].length,
  )[0];

  /* ในกลุ่มที่ชนะ ใช้ "สะกดที่พบบ่อยที่สุด" ไม่ใช่ยาวที่สุด — ยาวกว่าในที่นี้มักแปลว่า
     มีช่องว่างเกินมา ("java  programmer") ไม่ได้แปลว่าอ่านมาได้ครบกว่า
     เท่ากันให้เอาอันที่เจอก่อน เพราะเรียงตามลำดับหน้าในเอกสารอยู่แล้ว */
  const bySpelling = new Map();
  for (const sample of best.samples) bySpelling.set(sample, (bySpelling.get(sample) ?? 0) + 1);
  return [...bySpelling.entries()].sort((a, b) => b[1] - a[1])[0][0];
}

const EMPTY_PAGE_DATA = {
  vendor: null, clientName: null, projectName: null, employeeName: null, position: null, period: null,
  documentNo: null, approvalStatus: null, failedPages: [], totalPages: 0,
  totalWorkDays: 0, totalLeaveDays: 0, totalHours: null, days: [], leaveDays: [],
  signedByEmployee: false, employeeSignatureName: null,
  signedByProjectManager: false, projectManagerSignatureName: null, notes: [],
};

/**
 * รวมผลจากหลายหน้าเป็นก้อนเดียว — หลักการ: เอาค่าแรกที่ไม่ว่างของแต่ละฟิลด์หัวเอกสาร,
 * รวม days/leaveDays ทุกหน้าแล้ว dedupe ด้วยวันที่ (เก็บแถวที่มีข้อมูลครบกว่าไว้ถ้าเจอซ้ำ),
 * ลายเซ็นถือว่ามีถ้าหน้าไหนหน้าหนึ่งบอกว่ามี
 */
function mergePageResults(pageResults) {
  const merged = { ...EMPTY_PAGE_DATA, days: [], leaveDays: [], notes: [] };
  const votes = {};
  const notes = [];
  const failedPages = [];
  const rawDays = [];
  const rawLeaves = [];
  const rawTotalLeaveClaims = [];

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

  /* ชื่อคนในหัวเอกสารซ้ำอยู่ทุกหน้า — เอาค่าที่หน้าส่วนใหญ่อ่านตรงกัน ไม่ใช่ค่าจากหน้าแรก
     หน้าเดียวอ่านเพี้ยนจึงไม่ลากทั้งฉบับผิดตามอีกต่อไป (ดู pickByVote) */
  for (const key of HEADER_KEYS) merged[key] = pickByVote(votes[key]);

  /* ชื่อข้างลายเซ็นเป็นอีกเสียงหนึ่งของชื่อเดียวกัน — ถ้าหัวเอกสารอ่านได้ไม่ตรงกันเลยสักหน้า
     แต่ลายเซ็นอ่านได้ชัด ให้ใช้ชื่อจากลายเซ็นแทน ดีกว่าปล่อยค่าที่มีเสียงเดียว */
  if (merged.employeeSignatureName && votes.employeeName) {
    const all = [...votes.employeeName, merged.employeeSignatureName];
    merged.employeeName = pickByVote(all) ?? merged.employeeName;
  }

  /* ต้องรู้รอบเดือนก่อนจึงจะแปลงวันที่ได้ — ฟอร์มบางแบบเขียนแต่เลขวัน (Fujitsu) หรือเขียน
     วัน/เดือน สลับกันได้ (5/1/2026) ต้องอาศัยเดือนของเอกสารเป็นตัวชี้ขาด */
  merged.period = normalizePeriod(merged.period);
  const period = /^\d{4}-\d{2}$/.test(merged.period ?? '') ? merged.period : null;

  const dayByDate = new Map();
  const unreadable = [];
  for (const day of rawDays) {
    const date = normalizeDate(day.date, period);
    if (!date) {
      if (day.date) unreadable.push(String(day.date));
      continue;
    }
    /* ป้ายบอกว่าไม่ได้ทำงานอยู่คนละคอลัมน์ในแต่ละฟอร์ม — ดูรวมกันทุกช่องแล้วสรุปเป็นชนิดเดียว
       เก็บข้อความดิบไว้ใน label เหมือนเดิมด้วย เพื่อให้คนตรวจเห็นคำที่เอกสารเขียนจริง
       jobDescription เอามาเช็คด้วยได้เฉพาะตอนที่ "สั้นและไม่มีขึ้นบรรทัดใหม่" เท่านั้น —
       วัดจริงกับ ThaiLife 1-2026-Pongpun.pdf: วันที่ไม่ได้ทำงาน (Weekend/Holiday) ที่โมเดล
       ดันใส่ป้ายไว้ใน jobDescription แทน label มีความยาวแค่ 7 ตัวอักษรไม่มีขึ้นบรรทัดใหม่
       ส่วนย่อหน้าบรรยายงานจริงสั้นที่สุดยาว 83 ตัวอักษรและมีขึ้นบรรทัดใหม่เสมอ ห่างกันมากพอ
       ที่จะตัดแยกโดยไม่เสี่ยงจับคำว่า "ลา" ที่แทรกอยู่กลางคำอื่นในย่อหน้ายาว (เช่น "เวลา"
       "บุคลากร") เหมือนตอนที่เอา jobDescription ทั้งก้อนมาเช็คตรงๆ */
    const statusLikeJobDescription =
      day.jobDescription && day.jobDescription.length <= 20 && !day.jobDescription.includes('\n')
        ? day.jobDescription
        : null;
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

  const leaveByDate = new Map();
  for (const leave of rawLeaves) {
    const date = normalizeDate(leave.date, period);
    if (!date) continue;
    /* โมเดลบางครั้งรายงานวันเดียวกันซ้ำสองที่ขัดกันเอง — ตาราง days บอกว่าวันนั้นเป็น
       Holiday/Weekend (อ่านป้ายตรงตัวถูกแล้ว) แต่ leaveDays ที่โมเดลแยกให้มาดันมีวันเดียวกัน
       อยู่ด้วย (เจอจริงกับ ThaiLife 1-2026-Sunee.pdf: โมเดลเอาข้อความสรุปท้ายตาราง
       "Leave /Sick (days) 0" ไปเข้าใจผิดว่าเป็นแถววันลาของวันสุดท้าย ทั้งที่วันนั้นเป็น Holiday
       และวันอื่นที่เป็น Holiday ก็โดนใส่มาซ้ำในบางรอบด้วย) ป้ายที่อ่านตรงจากตารางเชื่อถือได้
       กว่า ถ้าขัดกันให้เชื่อตารางแทนไม่งั้นวันหยุดจะถูกนับเป็นวันลาผิดๆ กระทบยอดหักส่วนลด */
    const tableKind = dayByDate.get(date)?.kind;
    if (tableKind === 'holiday' || tableKind === 'weekend') continue;
    leaveByDate.set(date, {
      ...leave,
      date,
      // โมเดลเดาประเภทพลาดได้ — จัดประเภทซ้ำจากคำที่เอกสารเขียนจริง ซึ่งตรวจสอบได้
      type: classifyLeaveType(leave.rawLabel ?? leave.type),
    });
  }

  /* ฟอร์มที่ไม่มีตารางวันลาแยก (ส่วนใหญ่) — เก็บวันลาจากแถวรายวันที่จัดกลุ่มได้ว่าเป็นวันลา
     ไม่งั้นระบบจะมองว่าเดือนนั้นไม่มีใครลาเลย แล้วคิดส่วนลดขาด */
  for (const row of dayByDate.values()) {
    if (row.kind === 'leave' && !leaveByDate.has(row.date)) {
      const raw = row.label ?? row.type ?? row.remark ?? '';
      leaveByDate.set(row.date, { date: row.date, type: classifyLeaveType(raw), rawLabel: String(raw) });
    }
  }

  merged.days = [...dayByDate.values()].sort((a, b) => a.date.localeCompare(b.date));
  merged.leaveDays = [...leaveByDate.values()].sort((a, b) => a.date.localeCompare(b.date));

  /* จำนวนวันลาให้นับจากรายการวันลาที่ประกอบขึ้นเองแล้ว (merged.leaveDays) ไม่ใช่เชื่อเลขที่
     โมเดลอ่านจากช่องสรุปท้ายตารางตรงๆ — วัดจริงกับ ThaiLife 1-2026-Pongpun.pdf: หน้า 1 ไม่มี
     ช่องสรุปนี้อยู่ในหน้าเลย (อยู่หน้า 2) แต่โมเดลก็ยังตอบ totalLeaveDays มาเป็น 4 ทั้งที่ควร
     เป็น 0 หรือปล่อยว่าง ส่วนหน้า 2 ที่มีช่องสรุปจริงตอบถูกเป๊ะว่า 1 — พอรวมหลายหน้าด้วย
     Math.max ตัวเลขที่หลอน (4) จากหน้าที่ไม่มีข้อมูลจะชนะตัวเลขที่ถูกจากหน้าที่มีข้อมูลจริงเสมอ
     รายการวันลาที่ประกอบจากตาราง (ผ่านการตรวจ Holiday/Weekend แล้ว) เชื่อถือได้กว่ามาก
     จึงใช้ความยาวของรายการเป็นตัวเลขจริง เก็บเลขที่โมเดลอ้างไว้ในหมายเหตุเผื่อไม่ตรงกันเฉยๆ */
  if (rawTotalLeaveClaims.some((n) => n !== merged.leaveDays.length)) {
    const claimed = Math.max(...rawTotalLeaveClaims);
    notes.push(
      `โมเดลอ่านช่องสรุปวันลาได้ ${claimed} วัน แต่นับจากตารางได้ ${merged.leaveDays.length} วัน ` +
      'ใช้ตัวเลขที่นับจากตารางแทน (แม่นยำกว่า) — ตรวจดูอีกครั้งว่าตรงกับเอกสารจริง',
    );
  }
  merged.totalLeaveDays = merged.leaveDays.length;

  /* ฟอร์มที่มีทั้งช่อง "Total base man-day 21.00" และ "Total duration (hour) 168.00" วางติดกัน
     โมเดลหยิบเลขชั่วโมงมาใส่ช่องวันบ่อยมาก (เจอจริงกับฟอร์ม CP Axtra) — เดือนหนึ่งมีไม่เกิน 31 วัน
     เกินกว่านั้นแปลว่าหยิบผิดช่องแน่ ย้ายไปเป็นชั่วโมงแทนแล้วบอกไว้ ดีกว่าปล่อยตัวเลขผิดไปคิดเงินต่อ */
  if (merged.totalWorkDays > 31) {
    if (merged.totalHours === null) merged.totalHours = merged.totalWorkDays;
    notes.push(
      `ช่องสรุปวันทำงานอ่านได้ ${merged.totalWorkDays} ซึ่งเกินจำนวนวันในเดือน — ` +
      'น่าจะเป็นชั่วโมงรวมไม่ใช่จำนวนวัน ระบบย้ายไปเป็นชั่วโมงแล้ว ให้คนตรวจยืนยันอีกครั้ง',
    );
    merged.totalWorkDays = 0;
  }

  merged.notes = notes;
  /* หน้าที่อ่านไม่สำเร็จต้องเป็นข้อมูล ไม่ใช่แค่ข้อความใน notes — verifyExtraction() จะได้
     กันไม่ให้บันทึกเข้าระบบได้ เดิมเก็บไว้แค่ใน notes ซึ่งไม่มีอะไรมาอ่านต่อ ผลคือเอกสารที่
     อ่านได้ไม่ครบยังกดยืนยันบันทึกได้ตามปกติ ทั้งที่ข้อมูลขาดไปครึ่งเอกสาร */
  merged.failedPages = failedPages;
  merged.totalPages = pageResults.length;

  return merged;
}

/**
 * @param {string|Buffer} source  path ของไฟล์ Timesheet (.pdf) หรือ Buffer ของไฟล์
 *   n8n ส่งไฟล์แนบมาเป็น base64 จึงต้องรับ Buffer ได้โดยไม่ต้องเขียนลงดิสก์ก่อน
 * @param {object} [options]
 * @param {string} [options.expectedPeriod]  รอบบิลที่คาดไว้ ใช้เตือนเมื่อไม่ตรง
 * @param {typeof fetch} [options.fetchImpl]  ใช้แทนตอนเทสต์เท่านั้น
 */
export async function extractTimesheet(source, { expectedPeriod, fetchImpl, forceVision = false } = {}) {
  const pdfBuffer = Buffer.isBuffer(source) ? source : await readFile(source);

  /* ทางเร็ว — เอกสารส่วนใหญ่ export มาจาก Excel จึงมีชั้นข้อความอยู่แล้ว ไม่ต้องให้โมเดลมองรูป
     วัดกับของจริง 15 ฉบับ: 14 ฉบับมีชั้นข้อความ ดึงได้ใน 30–150 มิลลิวินาที และแม่นกว่ามาก
     ฉบับที่เป็นภาพสแกนจริง (hasText=false) ค่อยถอยไปใช้ทางโมเดล vision ด้านล่างเหมือนเดิม */
  const hint = expectedPeriod
    ? ` รอบบิลที่ระบบคาดไว้คือ ${expectedPeriod} — ถ้าเอกสารไม่ใช่เดือนนี้ ให้ใส่เดือนตามเอกสารและบันทึกลง notes`
    : '';

  if (!forceVision) {
    try {
      const text = await extractPdfText(pdfBuffer);
      if (text.hasText) {
        return await runPages(
          text.pages.length,
          (i) => ({
            model: localTextModel(),
            userContent:
              `ข้างล่างนี้คือข้อความที่ดึงมาจากหน้าที่ ${i + 1}/${text.pages.length} ของเอกสาร Timesheet ` +
              `(เอกสารอาจถูกแบ่งเป็นหลายหน้า) อ่านเฉพาะข้อมูลที่เห็นในหน้านี้ตาม schema ที่กำหนด${hint}\n\n${text.pages[i]}`,
            // ชื่อจากชั้นข้อความเชื่อถือได้กว่าที่โมเดลตอบมา เพราะเป็นตัวอักษรตรงๆ ไม่ได้ผ่านการเดา
            nameOverride: employeeNameIn(text.pages[i]),
          }),
          { expectedPeriod, fetchImpl, modelLabel: (model) => `local:${model} (ชั้นข้อความ)` },
        );
      }
    } catch (error) {
      // อ่านชั้นข้อความไม่ได้ไม่ใช่เรื่องคอขาดบาดตาย — ถอยไปทางเดิมที่ใช้ได้แน่นอน
      console.warn('[extract] อ่านชั้นข้อความไม่สำเร็จ ใช้โมเดล vision แทน —', error.message);
    }
  }

  const pages = await pdfToImages(pdfBuffer);
  return runPages(
    pages.length,
    (i) => ({
      model: localVisionModel(),
      userContent: [
        { type: 'image_url', image_url: { url: `data:image/png;base64,${pages[i].toString('base64')}` } },
        {
          type: 'text',
          text:
            `นี่คือหน้าที่ ${i + 1}/${pages.length} ของเอกสาร Timesheet ฉบับเดียวกัน ` +
            `(เอกสารอาจถูกแบ่งเป็นหลายหน้า) อ่านเฉพาะข้อมูลที่เห็นในหน้านี้ตาม schema ที่กำหนด${hint}`,
        },
      ],
    }),
    { expectedPeriod, fetchImpl, modelLabel: (model) => `local:${model}` },
  );
}

/* จำนวนคำขอที่ยอมให้ค้างพร้อมกันสูงสุด — เซิร์ฟเวอร์ LM Studio แบ่ง context รวมออกเป็น
   ส่วนเท่าๆ กันตามจำนวนคำขอพร้อมกัน (ไม่ใช่แบ่งตามโหลดจริง) ยิ่งยิงพร้อมกันมาก แต่ละคำขอ
   ยิ่งได้ context น้อยลง — ทดสอบจริง 10 ส.ค. 2569: ยิง 4 พร้อมกันด้วย schema เต็ม (มี
   jobDescription/ลายเซ็น/notes ฯลฯ) หน้าที่มีข้อมูลเยอะจะได้ "Context size has been exceeded"
   (400) ทันที ลดเหลือ 2 พร้อมกันแล้วผ่านหมดไม่มีหน้าไหนพัง — ถ้าจะเพิ่มค่านี้ต้องไปเพิ่ม
   Context Length ของโมเดลใน LM Studio ก่อน ไม่งั้นจะเจอ error เดิม */
const MAX_CONCURRENT_PAGES = 2;

/**
 * อ่านหลายหน้าพร้อมกันแบบจำกัดจำนวน (ดู MAX_CONCURRENT_PAGES) แล้วรวมผลด้วย
 * groupPagesByEmployee/mergePageResults — ใช้ร่วมกันทั้งทางข้อความ (เร็ว แม่น) และทาง vision
 * (ทางสำรองสำหรับไฟล์ที่เป็นภาพสแกนจริง)
 *
 * วัดจริง 10 ส.ค. 2569 กับไฟล์ 7 หน้า: ยิงทีละหน้าตามลำดับ 103.6s → ยิงพร้อมกัน 2 คำขอ
 * ลดเหลือ 61.9s (เร็วขึ้น ~1.7 เท่า) โดยไม่มีหน้าไหนหลุด
 * groupPagesByEmployee ต้องได้ผลเรียงตามลำดับหน้า จึงเรียง pageResults กลับก่อนใช้งาน
 *
 * @param {number} pageCount
 * @param {(pageIndex0: number) => {model: string, userContent: any, nameOverride?: string|null}} buildRequest
 */
async function runPages(pageCount, buildRequest, { expectedPeriod, fetchImpl, modelLabel }) {
  let model;
  const settled = [];
  let next = 0;

  async function worker() {
    while (next < pageCount) {
      const i = next;
      next += 1;
      const pageIndex = i + 1;
      const req = buildRequest(i);
      model = req.model;
      try {
        const result = await callLocalJSON({
          model: req.model, system: SYSTEM_PROMPT, userContent: req.userContent, schema: TIMESHEET_SCHEMA,
          /* เดิม 6000 — บนเซิร์ฟเวอร์จริง context รวมแค่ 8192 token กันไว้เป็นคำตอบเยอะขนาดนี้
             เหลือให้ภาพ+system prompt แค่ราว 2000 token ซึ่งน้อยเกินไปจนชน "Context size exceeded"
             บ่อย ลดเหลือ 3000 ยังพอสำหรับตาราง 31 วัน (วัดจริงแล้วไม่เกิน ~1500 token) แลกกับที่ว่าง
             ฝั่งอินพุตเพิ่มขึ้นเท่าตัว */
          maxTokens: 3000, fetchImpl,
        });
        if (req.nameOverride) result.data.employeeName = req.nameOverride;

        /* บางหน้าโมเดลอ่านช่องชื่อพนักงานไม่ออกจริง แล้วไปคัดลอกข้อความจากช่องตำแหน่งมาใส่ชื่อแทน
           แบบเผลอ (เจอจริง: employeeName กับ position เป็น "Java Programmer" เหมือนกันเป๊ะ) ถ้าปล่อยผ่าน
           groupPagesByEmployee จะเข้าใจว่าเป็นพนักงานคนใหม่ กลายเป็นเอกสารผีที่จับคู่พนักงานไม่ได้
           (บล็อกวางบิลเปล่าๆ ทั้งที่จริงมีคนเดียว) ถือว่าอ่านหน้านี้ไม่น่าเชื่อถือ นับเป็นอ่านไม่สำเร็จไปเลย
           ดีกว่าปล่อยให้กลายเป็นเอกสารปลอมที่ต้องมาแก้ทีหลัง */
        if (result.data.employeeName && result.data.position
            && nameKey(result.data.employeeName) === nameKey(result.data.position)) {
          settled.push({
            pageIndex,
            error: `อ่านชื่อพนักงานไม่น่าเชื่อถือ (ได้ "${result.data.employeeName}" ซ้ำกับตำแหน่งเป๊ะ) — น่าจะอ่านหน้านี้ผิด`,
          });
        } else {
          settled.push({ pageIndex, data: result.data, usage: result.usage });
        }
      } catch (error) {
        settled.push({ pageIndex, error: error.message });
      }
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(MAX_CONCURRENT_PAGES, pageCount) }, () => worker()),
  );

  settled.sort((a, b) => a.pageIndex - b.pageIndex);
  const pageResults = settled.map(({ pageIndex, data, error }) => ({ pageIndex, data, error }));
  const totalUsage = settled.reduce((acc, p) => {
    if (!p.usage) return acc;
    return {
      prompt_tokens: (acc?.prompt_tokens ?? 0) + (p.usage.prompt_tokens ?? 0),
      completion_tokens: (acc?.completion_tokens ?? 0) + (p.usage.completion_tokens ?? 0),
    };
  }, null);

  if (pageResults.every((p) => p.error)) {
    throw new Error(
      `อ่าน Timesheet ไม่สำเร็จเลยสักหน้า (${pageCount} หน้า): ${pageResults.map((p) => p.error).join(' · ')}`,
    );
  }

  /* ไฟล์เดียวอาจมี Timesheet ของหลายคนต่อกัน — ต้องแยกก่อนรวม ไม่งั้นข้อมูลสองคนปนกันเป็นคนเดียว
     (เจอจริงกับไฟล์ ThaiLife 1-2026.pdf 8 หน้า: หน้า 1-5 ของ Sunee · หน้า 6-8 ของ Pongpun) */
  const groups = groupPagesByEmployee(pageResults);
  const documents = groups.map((pages) => {
    const data = mergePageResults(pages);
    return {
      data,
      pageRange: [pages[0].pageIndex, pages[pages.length - 1].pageIndex],
      verification: verifyExtraction(data, { expectedPeriod }),
    };
  });

  return {
    /** เอกสารทั้งหมดที่แยกได้จากไฟล์นี้ — ไฟล์ปกติมี 1 ฉบับ ไฟล์รวมหลายคนมีมากกว่านั้น */
    documents,
    /* ฉบับแรกวางไว้ที่ระดับบนสุดด้วย เพื่อให้โค้ดเดิมที่อ่าน result.data ยังทำงานได้เหมือนเดิม */
    data: documents[0].data,
    verification: documents[0].verification,
    usage: totalUsage,
    model: modelLabel(model),
  };
}

/** ตัดให้เหลือแต่ตัวอักษรพิมพ์เล็ก ใช้เทียบชื่อแบบหลวมๆ ข้ามหน้า */
function nameKey(name) {
  return String(name ?? '').toLowerCase().replace(/[^a-z฀-๿]/g, '');
}

/**
 * ชื่อสองอันน่าจะเป็นคนเดียวกันไหม — เทียบแบบหลวมเพราะโมเดลอ่านชื่อเพี้ยนได้ระหว่างหน้า
 * (หน้าหนึ่งอ่านได้ "Sunee Maneekasemsuk" อีกหน้าเป็น "Sineee Masamasukiam")
 * ใช้ตัวอักษรร่วมกันเป็นเกณฑ์ ไม่ใช่ต้องตรงเป๊ะ
 */
function sameEmployee(a, b) {
  const x = nameKey(a);
  const y = nameKey(b);
  if (!x || !y) return true;          // หน้าไหนไม่มีชื่อ ถือว่าอยู่กลุ่มเดิม
  if (x === y || x.startsWith(y) || y.startsWith(x)) return true;

  /* นับ "ตัวอักษรที่ใช้ร่วมกัน" ไม่ใช่ตัวที่ตรงตำแหน่ง — โมเดลอ่านเพี้ยนแบบสลับ/แทรกตัวอักษร
     ("Sunee Maneekasemsuk" → "Sineee Masamasukiam") ซึ่งทำให้ตำแหน่งเลื่อนกันหมดทั้งที่เป็นชื่อเดียวกัน
     แต่คนละคนจริงๆ (Sunee vs Pongpun Mamak) ใช้ตัวอักษรต่างกันมากอยู่ดี จึงยังแยกออก */
  const pool = [...y];
  let shared = 0;
  for (const ch of x) {
    const at = pool.indexOf(ch);
    if (at !== -1) { pool.splice(at, 1); shared += 1; }
  }
  return shared / Math.max(x.length, y.length) >= 0.65;
}

/**
 * แบ่งหน้าออกเป็นกลุ่มตามพนักงาน — หน้าที่ขึ้นชื่อคนใหม่คือจุดเริ่มเอกสารฉบับถัดไป
 *
 * หน้าที่ไม่มีชื่อพนักงาน (เช่นหน้าอีเมลแจ้งอนุมัติที่แนบท้าย หรือหน้าที่โมเดลอ่านหัวไม่ออก)
 * ให้อยู่กลุ่มเดียวกับหน้าก่อนหน้า เพราะเอกสารเรียงต่อกันเป็นชุดของแต่ละคนอยู่แล้ว
 */
export function groupPagesByEmployee(pageResults) {
  const groups = [];
  let current = null;
  let currentName = null;

  for (const page of pageResults) {
    const name = page.data?.employeeName ?? null;

    if (!current) {
      current = [];
      currentName = name;
      groups.push(current);
    } else if (name && currentName && !sameEmployee(name, currentName)) {
      current = [];
      currentName = name;
      groups.push(current);
    } else if (name && !currentName) {
      currentName = name;
    }

    current.push(page);
  }

  return groups.length ? groups : [pageResults];
}

/**
 * รวมเอกสารที่ groupPagesByEmployee แยกไว้ผิดคน กลับเป็นคนเดียวกัน
 *
 * groupPagesByEmployee เทียบชื่อด้วยตัวอักษรที่ใช้ร่วมกัน (sameEmployee) ซึ่งเทียบข้ามภาษา
 * ไม่ได้เลย — หน้าตารางเขียนชื่อเป็นอังกฤษ "Sunee Maneekasemsuk" แต่หน้าอีเมลแจ้งอนุมัติที่
 * แนบท้ายไฟล์เขียนเป็นไทย "นางสาว สุนีย์ มณีเกษมสุข" ตัวอักษรไม่ทับกันเลยสักตัวเพราะคนละ
 * ชุดตัวอักษร (Latin vs ไทย) เลยถูกแยกเป็นคนละฉบับทั้งที่เป็นคนเดียวกันจริง
 *
 * ฐานข้อมูลพนักงานรู้อยู่แล้วว่าทั้งสองชื่อเป็นคนเดียวกัน (นามEn + นามTh ของพนักงานคนเดียวกัน)
 * จึงใช้ resolveEmployeeId เป็นตัวช่วยเทียบข้ามภาษาแทนการเทียบตัวอักษรตรงๆ
 * ฟังก์ชันนี้ไม่แตะฐานข้อมูลเอง (คงความเป็นโมดูลอ่าน PDF ล้วนๆ ทดสอบด้วยตัวปลอมได้) —
 * ผู้เรียกต้องส่ง resolveEmployeeId เข้ามา (service.js ใช้ matchEmployee กับ roster จริง)
 *
 * @param {Array<{data: object, pageRange: [number, number], verification: object}>} documents
 * @param {(employeeName: string|null) => (string|number|null)} resolveEmployeeId
 * @param {{expectedPeriod?: string}} [options]
 */
export function mergeDocumentsByEmployee(documents, resolveEmployeeId, { expectedPeriod } = {}) {
  const groups = [];
  const indexOfEmployee = new Map();

  for (const doc of documents) {
    const employeeId = resolveEmployeeId(doc.data.employeeName);
    if (employeeId != null && indexOfEmployee.has(employeeId)) {
      groups[indexOfEmployee.get(employeeId)].push(doc);
    } else {
      groups.push([doc]);
      if (employeeId != null) indexOfEmployee.set(employeeId, groups.length - 1);
    }
  }

  return groups.map((group) => (group.length === 1 ? group[0] : mergeDocumentGroup(group, { expectedPeriod })));
}

/** ฉบับที่มีตารางวันมากที่สุดถือเป็นหลัก ฉบับอื่น (มักเป็นหน้าอีเมลแจ้งอนุมัติที่แนบท้าย) มีไว้เติมช่องที่ฉบับหลักไม่มี */
function mergeDocumentGroup(group, { expectedPeriod }) {
  const sorted = [...group].sort((a, b) => b.data.days.length - a.data.days.length);
  const primary = sorted[0].data;
  const merged = { ...primary, days: [...primary.days], leaveDays: [...primary.leaveDays], notes: [...primary.notes] };

  const dayByDate = new Map(merged.days.map((d) => [d.date, d]));
  const leaveByDate = new Map(merged.leaveDays.map((d) => [d.date, d]));
  const failedPages = [...(primary.failedPages ?? [])];
  let totalPages = primary.totalPages ?? 0;

  for (const { data: d } of sorted.slice(1)) {
    for (const key of HEADER_KEYS) if (!merged[key] && d[key]) merged[key] = d[key];
    merged.totalWorkDays = Math.max(merged.totalWorkDays, d.totalWorkDays || 0);
    if (merged.totalHours === null && Number.isFinite(d.totalHours)) merged.totalHours = d.totalHours;
    if (d.signedByEmployee) merged.signedByEmployee = true;
    if (d.signedByProjectManager) merged.signedByProjectManager = true;
    if (!merged.employeeSignatureName && d.employeeSignatureName) merged.employeeSignatureName = d.employeeSignatureName;
    if (!merged.projectManagerSignatureName && d.projectManagerSignatureName) {
      merged.projectManagerSignatureName = d.projectManagerSignatureName;
    }

    for (const day of d.days ?? []) {
      const existing = dayByDate.get(day.date);
      if (!existing || (!existing.timeIn && day.timeIn) || (!existing.label && day.label)) dayByDate.set(day.date, day);
    }
    for (const leave of d.leaveDays ?? []) if (!leaveByDate.has(leave.date)) leaveByDate.set(leave.date, leave);

    merged.notes.push(...(d.notes ?? []));
    failedPages.push(...(d.failedPages ?? []));
    totalPages += d.totalPages ?? 0;
  }

  merged.days = [...dayByDate.values()].sort((a, b) => a.date.localeCompare(b.date));
  merged.leaveDays = [...leaveByDate.values()].sort((a, b) => a.date.localeCompare(b.date));
  // เหตุผลเดียวกับใน mergePageResults — นับจากรายการวันลาที่รวมแล้ว ไม่เชื่อเลขที่โมเดลอ้างตรงๆ
  merged.totalLeaveDays = merged.leaveDays.length;
  merged.failedPages = [...new Set(failedPages)].sort((a, b) => a - b);
  merged.totalPages = totalPages;

  const pageIndexes = group.flatMap((doc) => doc.pageRange);
  return {
    data: merged,
    pageRange: [Math.min(...pageIndexes), Math.max(...pageIndexes)],
    verification: verifyExtraction(merged, { expectedPeriod }),
  };
}

/**
 * ตรวจผลที่โมเดลอ่านมาด้วยโค้ด — จับความไม่สอดคล้องภายในเอกสารเอง
 * ไม่ได้ตรวจกับปฏิทินหรือสัญญา (นั่นเป็นหน้าที่ของ calculateManday)
 */
export function verifyExtraction(data, { expectedPeriod } = {}) {
  const issues = [];

  /* อ่านบางหน้าไม่สำเร็จ = ข้อมูลขาด ห้ามบันทึกเข้าระบบ
     วันทำงาน/วันลาที่หายไปพร้อมหน้านั้นทำให้คิดเงินผิดโดยไม่มีใครรู้ตัว
     และถ้าไฟล์รวมหลายคน หน้าที่หายอาจเป็นตัวคั่นคน ทำให้ข้อมูลสองคนปนกันด้วย */
  if (data.failedPages?.length) {
    issues.push({
      severity: 'fail',
      message:
        `อ่านไม่สำเร็จ ${data.failedPages.length} หน้าจาก ${data.totalPages ?? '?'} หน้า `
        + `(หน้า ${data.failedPages.join(', ')}) — ข้อมูลยังไม่ครบทั้งเอกสาร ให้กดอ่านใหม่อีกครั้ง`,
    });
  }

  if (expectedPeriod && data.period !== expectedPeriod) {
    issues.push({
      severity: 'fail',
      message: `เอกสารเป็นรอบ ${data.period} แต่ระบบคาดว่าเป็น ${expectedPeriod}`,
    });
  }

  if (!/^\d{4}-\d{2}$/.test(data.period ?? '')) {
    issues.push({ severity: 'fail', message: `รูปแบบเดือนไม่ถูกต้อง: "${data.period}"` });
  }

  // จำนวนวันลาในรายการต้องเท่ากับเลขสรุปท้ายตาราง
  if (data.leaveDays.length !== data.totalLeaveDays) {
    issues.push({
      severity: 'fail',
      message:
        `ช่องสรุประบุวันลา ${data.totalLeaveDays} วัน แต่รายการวันลามี ${data.leaveDays.length} รายการ`,
    });
  }

  // จำนวนแถวที่มีเวลาเข้า-ออก ควรเท่ากับ Total Work days
  const rowsWithTime = data.days.filter((d) => d.timeIn && d.timeOut).length;
  if (rowsWithTime !== data.totalWorkDays) {
    issues.push({
      severity: 'warn',
      message:
        `ช่องสรุประบุวันทำงาน ${data.totalWorkDays} วัน แต่แถวที่มีเวลาเข้า-ออกมี ${rowsWithTime} แถว`,
    });
  }

  // วันลาต้องอยู่ในรายการวันด้วย และแถวนั้นไม่ควรมีเวลาเข้า-ออก
  const dayByDate = new Map(data.days.map((d) => [d.date, d]));
  for (const leave of data.leaveDays) {
    const row = dayByDate.get(leave.date);
    if (!row) {
      issues.push({
        severity: 'fail',
        message: `วันลา ${leave.date} ไม่มีแถวในตาราง`,
      });
    } else if (row.timeIn || row.timeOut) {
      issues.push({
        severity: 'fail',
        message: `${leave.date} เป็นวันลา แต่มีเวลาเข้า-ออกในตาราง`,
      });
    }
  }

  // วันที่ทุกช่องต้องอยู่ในเดือนเดียวกัน
  for (const row of data.days) {
    if (!row.date?.startsWith(data.period)) {
      issues.push({
        severity: 'fail',
        message: `วันที่ ${row.date} ไม่อยู่ในเดือน ${data.period}`,
      });
    }
  }

  if (!data.signedByEmployee) {
    issues.push({ severity: 'warn', message: 'ไม่พบลายเซ็นพนักงาน' });
  }
  if (!data.signedByProjectManager) {
    issues.push({ severity: 'warn', message: 'ไม่พบลายเซ็นผู้อนุมัติฝั่งลูกค้า' });
  }

  for (const note of data.notes ?? []) {
    issues.push({ severity: 'warn', message: `โมเดลบันทึกไว้: ${note}` });
  }

  return {
    ok: !issues.some((i) => i.severity === 'fail'),
    issues,
  };
}

/**
 * อ่านข้อมูลจากไฟล์ Timesheet PDF ด้วยโมเดล vision ที่รันในเครื่อง (LM Studio/Ollama)
 *
 * Timesheet เป็น PDF ที่ export มาจาก Excel และมีข้อความไทยผสม
 * การดึงข้อความแบบ text extraction ล้วนมักได้ตัวอักษรไทยเพี้ยน
 * จึงแปลงแต่ละหน้าเป็นรูปภาพก่อน (pdf-to-img) แล้วส่งให้โมเดล vision "มองเห็น"
 * แทน — โมเดลข้อความล้วนอย่าง Gemma 2B ทำงานนี้ไม่ได้ ต้องใช้รุ่นที่รับภาพได้
 * (LOCAL_LLM_VISION_MODEL เช่น Gemma 3 4B ขึ้นไป)
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
import { callLocalJSON, localVisionModel } from '../llm/localClient.js';
import { normalizePeriod, normalizeDate, classifyDayKind, classifyLeaveType } from './normalize.js';

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
  /* scale 3 ไม่ใช่ 2 — ตัวหนังสือในตาราง Timesheet เล็กมาก ภาพใหญ่ขึ้นอ่านง่ายขึ้น
     ทดสอบกับเอกสารจริงแล้วพบว่า **ยังแก้ชื่ออ่านเพี้ยนไม่ได้** (Korawit Khamsuk ยังอ่านเป็น
     Korweil Khamsiuk ทั้งที่ scale 2 และ 3) จึงไม่ใช่ทางแก้ของเรื่องนั้น — ที่แก้จริงคือ
     การโหวตข้ามหน้า (pickByVote) กับชั้นจับคู่ด้วยตัวอักษรซ้ำใน domain/matching.js
     เก็บ scale 3 ไว้เพราะเสียเวลาเพิ่มแค่ราว 4% แลกกับภาพที่อ่านง่ายขึ้น */
  const doc = await pdf(dataUrl, { scale: 3 });
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
    merged.totalLeaveDays = Math.max(merged.totalLeaveDays, data.totalLeaveDays || 0);
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
       เก็บข้อความดิบไว้ใน label เหมือนเดิมด้วย เพื่อให้คนตรวจเห็นคำที่เอกสารเขียนจริง */
    const kind = classifyDayKind(day.label, day.type, day.remark, day.jobDescription);
    const row = {
      ...day,
      date,
      kind,
      label: day.label ?? (kind === 'work' ? null : (day.type ?? day.remark ?? null)),
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
export async function extractTimesheet(source, { expectedPeriod, fetchImpl } = {}) {
  const pdfBuffer = Buffer.isBuffer(source) ? source : await readFile(source);
  const pages = await pdfToImages(pdfBuffer);

  const hint = expectedPeriod
    ? ` รอบบิลที่ระบบคาดไว้คือ ${expectedPeriod} — ถ้าเอกสารไม่ใช่เดือนนี้ ให้ใส่เดือนตามเอกสารและบันทึกลง notes`
    : '';

  const model = localVisionModel();
  const pageResults = [];
  let totalUsage = null;

  for (let i = 0; i < pages.length; i++) {
    const pageIndex = i + 1;
    const userContent = [
      {
        type: 'image_url',
        image_url: { url: `data:image/png;base64,${pages[i].toString('base64')}` },
      },
      {
        type: 'text',
        text:
          `นี่คือหน้าที่ ${pageIndex}/${pages.length} ของเอกสาร Timesheet ฉบับเดียวกัน ` +
          `(เอกสารอาจถูกแบ่งเป็นหลายหน้า) อ่านเฉพาะข้อมูลที่เห็นในหน้านี้ตาม schema ที่กำหนด${hint}`,
      },
    ];

    try {
      const result = await callLocalJSON({
        model, system: SYSTEM_PROMPT, userContent, schema: TIMESHEET_SCHEMA, maxTokens: 6000, fetchImpl,
      });
      pageResults.push({ pageIndex, data: result.data });
      if (result.usage) {
        totalUsage = {
          prompt_tokens: (totalUsage?.prompt_tokens ?? 0) + (result.usage.prompt_tokens ?? 0),
          completion_tokens: (totalUsage?.completion_tokens ?? 0) + (result.usage.completion_tokens ?? 0),
        };
      }
    } catch (error) {
      pageResults.push({ pageIndex, error: error.message });
    }
  }

  if (pageResults.every((p) => p.error)) {
    throw new Error(
      `อ่าน Timesheet ไม่สำเร็จเลยสักหน้า (${pages.length} หน้า): ${pageResults.map((p) => p.error).join(' · ')}`,
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
    model: `local:${model}`,
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
    issues.push({
      severity: 'fail',
      message: 'ไม่พบลายเซ็นผู้อนุมัติฝั่งลูกค้า — ยังวางบิลไม่ได้',
    });
  }

  for (const note of data.notes ?? []) {
    issues.push({ severity: 'warn', message: `โมเดลบันทึกไว้: ${note}` });
  }

  return {
    ok: !issues.some((i) => i.severity === 'fail'),
    issues,
  };
}

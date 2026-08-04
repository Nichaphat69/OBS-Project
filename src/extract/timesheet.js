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
    totalWorkDays: {
      type: 'integer',
      description: 'ตัวเลขในช่อง Total Work days ท้ายตาราง ไม่ต้องนับเอง — ไม่เห็นในหน้านี้ให้เป็น 0',
    },
    totalLeaveDays: {
      type: 'integer',
      description: 'ตัวเลขในช่อง Leave/Sick (days) ท้ายตาราง — ไม่เห็นในหน้านี้ให้เป็น 0',
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
              'ป้ายกำกับที่เขียนในช่อง Job Description เมื่อไม่ได้ทำงาน ' +
              'เช่น Holiday, Weekend, Sick leave — ถ้าเป็นวันทำงานปกติให้เป็น null',
          },
          jobDescription: { type: ['string', 'null'] },
        },
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
    signedByProjectManager: {
      type: 'boolean',
      description: 'หน้านี้มีลายเซ็นในช่อง Project Manager\'s Signature (TLI) หรือไม่ — ไม่มีช่องนี้ในหน้านี้ให้เป็น false',
    },
    notes: {
      type: 'array',
      description: 'สิ่งที่อ่านไม่ชัด ขัดแย้งกันเอง หรือควรให้คนตรวจ เฉพาะในหน้านี้',
      items: { type: 'string' },
    },
  },
  required: [
    'vendor', 'clientName', 'projectName', 'employeeName', 'position', 'period',
    'totalWorkDays', 'totalLeaveDays', 'days', 'leaveDays',
    'signedByEmployee', 'signedByProjectManager', 'notes',
  ],
  additionalProperties: false,
};

const SYSTEM_PROMPT = `คุณคือผู้ช่วยฝ่ายบัญชีที่อ่านเอกสาร Timesheet ของพนักงาน Outsource

หน้าที่ของคุณคืออ่านค่าที่ปรากฏในเอกสารและถอดออกมาให้ตรงตามที่เขียนไว้ ไม่ใช่คำนวณหรือแก้ไขให้ถูก

กฎที่ต้องทำตาม
- เอกสารอาจถูกแบ่งส่งมาให้ดูทีละหน้า แต่ละหน้าอาจไม่มีข้อมูลบางช่องเลย —
  ช่องไหนไม่เห็นในหน้าที่กำลังดูอยู่ ให้ตอบ null (หรือ 0/false/[] ตามชนิดข้อมูล) ห้ามเดาห้ามแต่งขึ้นเอง
- ชื่อพนักงานและตำแหน่ง ให้คัดตามที่เขียนในเอกสารทุกตัวอักษร ห้ามแปล ห้ามแก้การสะกด ห้ามเติมคำนำหน้า
- totalWorkDays และ totalLeaveDays ให้อ่านจากช่องสรุปท้ายตารางที่เอกสารเขียนไว้เท่านั้น ห้ามนับแถวเอง
- ระบุปีเป็น ค.ศ. เสมอ เอกสารอาจเขียนปีเป็น พ.ศ. ให้แปลงโดยลบ 543
- วันที่ทุกช่องต้องเป็นรูปแบบ YYYY-MM-DD เท่านั้น (ปี 4 หลัก - เดือน 2 หลัก - วัน 2 หลัก เช่น 2026-01-18)
  ห้ามใส่ชื่อเดือนแบบย่อปนในค่านี้เด็ดขาด (ห้ามเขียน "2026-18-Jan-26" หรือรูปแบบอื่นที่ไม่ใช่ YYYY-MM-DD)
  ถ้าเอกสารเขียนวันที่แบบ "18-Jan-26" ให้แปลงเป็น 2026-01-18 ก่อนตอบทุกครั้ง
- ถ้าอ่านค่าใดไม่ชัดเจน ให้บันทึกลง notes อย่าเดา`;

/**
 * แปลง PDF (path หรือ Buffer) เป็นรูปภาพทีละหน้า — pdf-to-img รับได้แค่ path
 * หรือ data URL ไม่รับ Buffer ตรงๆ จึงต้องแปลง Buffer เป็น data URL ก่อน
 */
async function pdfToImages(pdfBuffer) {
  const dataUrl = `data:application/pdf;base64,${pdfBuffer.toString('base64')}`;
  const doc = await pdf(dataUrl, { scale: 2 });
  try {
    const pages = [];
    for await (const page of doc) pages.push(page);
    return pages;
  } finally {
    doc.destroy?.();
  }
}

const MONTH_NAMES_EN = [
  'january', 'february', 'march', 'april', 'may', 'june',
  'july', 'august', 'september', 'october', 'november', 'december',
];

/**
 * แปลงรอบเดือนที่โมเดลอ่านมาให้เป็น YYYY-MM เสมอ — ทดสอบแล้วว่าโมเดล vision ขนาดเล็ก
 * ไม่ยอมแปลงให้ตรง schema เอง มักคัดลอกข้อความในเอกสารมาเป๊ะๆ แทน (เช่น "March 2026",
 * "Mar-26") เอกสารจริงบางฉบับคอลัมน์แคบจนชื่อเดือนถูกตัดกลางคำด้วย (เช่น "Janua")
 * จึงจับคู่ชื่อเดือนแบบ prefix ทั้งสองทาง ไม่ใช่เทียบให้ตรงเป๊ะ
 * แปลงไม่ได้ก็คืนค่าเดิม — ให้ verifyExtraction() จับว่ารูปแบบผิดต่อไปตามปกติ
 */
function normalizePeriod(raw) {
  if (!raw) return raw;
  const value = String(raw).trim();
  if (/^\d{4}-\d{2}$/.test(value)) return value;

  const lower = value.toLowerCase();
  const yearMatch = lower.match(/\b(20\d{2}|\d{2})\b/);
  const wordMatch = lower.match(/[a-z]{3,}/);
  if (!yearMatch || !wordMatch) return value;

  const word = wordMatch[0];
  const monthIndex = MONTH_NAMES_EN.findIndex(
    (name) => name.startsWith(word) || word.startsWith(name.slice(0, 3)),
  );
  if (monthIndex === -1) return value;

  const year = yearMatch[0].length === 2 ? `20${yearMatch[0]}` : yearMatch[0];
  return `${year}-${String(monthIndex + 1).padStart(2, '0')}`;
}

const EMPTY_PAGE_DATA = {
  vendor: null, clientName: null, projectName: null, employeeName: null, position: null, period: null,
  totalWorkDays: 0, totalLeaveDays: 0, days: [], leaveDays: [],
  signedByEmployee: false, signedByProjectManager: false, notes: [],
};

/**
 * รวมผลจากหลายหน้าเป็นก้อนเดียว — หลักการ: เอาค่าแรกที่ไม่ว่างของแต่ละฟิลด์หัวเอกสาร,
 * รวม days/leaveDays ทุกหน้าแล้ว dedupe ด้วยวันที่ (เก็บแถวที่มีข้อมูลครบกว่าไว้ถ้าเจอซ้ำ),
 * ลายเซ็นถือว่ามีถ้าหน้าไหนหน้าหนึ่งบอกว่ามี
 */
function mergePageResults(pageResults) {
  const merged = { ...EMPTY_PAGE_DATA, days: [], leaveDays: [], notes: [] };
  const dayByDate = new Map();
  const leaveByDate = new Map();
  const notes = [];

  for (const { pageIndex, data, error } of pageResults) {
    if (error) {
      notes.push(`อ่านหน้า ${pageIndex} ไม่สำเร็จ: ${error}`);
      continue;
    }

    for (const key of ['vendor', 'clientName', 'projectName', 'employeeName', 'position', 'period']) {
      if (!merged[key] && data[key]) merged[key] = data[key];
    }
    merged.totalWorkDays = Math.max(merged.totalWorkDays, data.totalWorkDays || 0);
    merged.totalLeaveDays = Math.max(merged.totalLeaveDays, data.totalLeaveDays || 0);

    for (const day of data.days ?? []) {
      const existing = dayByDate.get(day.date);
      if (!existing || (!existing.timeIn && day.timeIn) || (!existing.label && day.label)) {
        dayByDate.set(day.date, day);
      }
    }
    for (const leave of data.leaveDays ?? []) {
      leaveByDate.set(leave.date, leave);
    }

    if (data.signedByEmployee) merged.signedByEmployee = true;
    if (data.signedByProjectManager) merged.signedByProjectManager = true;
    for (const note of data.notes ?? []) notes.push(`[หน้า ${pageIndex}] ${note}`);
  }

  merged.days = [...dayByDate.values()].sort((a, b) => a.date.localeCompare(b.date));
  merged.leaveDays = [...leaveByDate.values()].sort((a, b) => a.date.localeCompare(b.date));
  merged.notes = notes;
  merged.period = normalizePeriod(merged.period);

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

  const data = mergePageResults(pageResults);

  return {
    data,
    usage: totalUsage,
    model: `local:${model}`,
    /** ผลตรวจความสมเหตุสมผลด้วยโค้ด ไม่พึ่งโมเดล */
    verification: verifyExtraction(data, { expectedPeriod }),
  };
}

/**
 * ตรวจผลที่โมเดลอ่านมาด้วยโค้ด — จับความไม่สอดคล้องภายในเอกสารเอง
 * ไม่ได้ตรวจกับปฏิทินหรือสัญญา (นั่นเป็นหน้าที่ของ calculateManday)
 */
export function verifyExtraction(data, { expectedPeriod } = {}) {
  const issues = [];

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

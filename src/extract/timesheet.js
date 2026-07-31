/**
 * อ่านข้อมูลจากไฟล์ Timesheet PDF ด้วย Claude
 *
 * Timesheet เป็น PDF ที่ export มาจาก Excel และมีข้อความไทยผสม
 * การดึงข้อความแบบ text extraction ล้วนมักได้ตัวอักษรไทยเพี้ยน
 * จึงส่งไฟล์ทั้งไฟล์ให้โมเดลอ่านเป็นเอกสาร แล้วบังคับรูปแบบผลลัพธ์ด้วย
 * structured outputs เพื่อให้ได้ JSON ที่ตรง schema ทุกครั้ง
 *
 * ตัวเลขที่ได้จากโมเดลไม่ถือเป็นข้อสรุป — ต้องผ่าน verifyExtraction()
 * และการคำนวณปฏิทินใน src/domain/manday.js อีกชั้น
 */

import { readFile } from 'node:fs/promises';
import Anthropic from '@anthropic-ai/sdk';

export const MODEL = process.env.CLAUDE_MODEL ?? 'claude-opus-5';

const TIMESHEET_SCHEMA = {
  type: 'object',
  properties: {
    vendor: { type: 'string', description: 'Vendor ที่ระบุในเอกสาร เช่น iPassion Co.,Ltd.' },
    clientName: { type: 'string', description: 'Client Name ที่ระบุในเอกสาร' },
    projectName: { type: 'string' },
    employeeName: { type: 'string', description: 'Employee Name ตามที่เขียนในเอกสาร ห้ามแก้การสะกด' },
    position: { type: 'string', description: 'Position ตามที่เขียนในเอกสาร ห้ามแปลหรือแก้' },
    period: {
      type: 'string',
      description: 'เดือนของ Timesheet ในรูปแบบ YYYY-MM เช่น 2026-01',
    },
    totalWorkDays: {
      type: 'integer',
      description: 'ตัวเลขในช่อง Total Work days ท้ายตาราง ไม่ต้องนับเอง',
    },
    totalLeaveDays: {
      type: 'integer',
      description: 'ตัวเลขในช่อง Leave/Sick (days) ท้ายตาราง',
    },
    days: {
      type: 'array',
      description: 'ทุกแถวในตาราง เรียงตามวันที่',
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
      description: 'เฉพาะวันที่ลา แยกประเภทตามคำที่เขียนในเอกสาร',
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
      description: 'มีลายเซ็นหรือชื่อพนักงานในช่อง Employee\'s Signature หรือไม่',
    },
    signedByProjectManager: {
      type: 'boolean',
      description: 'มีลายเซ็นในช่อง Project Manager\'s Signature (TLI) หรือไม่',
    },
    notes: {
      type: 'array',
      description: 'สิ่งที่อ่านไม่ชัด ขัดแย้งกันเอง หรือควรให้คนตรวจ',
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
- ชื่อพนักงานและตำแหน่ง ให้คัดตามที่เขียนในเอกสารทุกตัวอักษร ห้ามแปล ห้ามแก้การสะกด ห้ามเติมคำนำหน้า
- totalWorkDays และ totalLeaveDays ให้อ่านจากช่องสรุปท้ายตารางที่เอกสารเขียนไว้ ห้ามนับแถวเอง
  ถ้าค่าที่เขียนไว้ขัดกับจำนวนแถวที่คุณเห็น ให้ใส่ค่าที่เขียนไว้ แล้วบันทึกความขัดแย้งลงใน notes
- ระบุปีเป็น ค.ศ. เสมอ เอกสารอาจเขียนปีเป็น พ.ศ. ให้แปลงโดยลบ 543
- วันที่ทุกช่องใช้รูปแบบ YYYY-MM-DD
- ถ้าอ่านค่าใดไม่ชัดเจน ให้บันทึกลง notes อย่าเดา`;

/**
 * @param {string|Buffer} source  path ของไฟล์ Timesheet (.pdf) หรือ Buffer ของไฟล์
 *   n8n ส่งไฟล์แนบมาเป็น base64 จึงต้องรับ Buffer ได้โดยไม่ต้องเขียนลงดิสก์ก่อน
 * @param {object} [options]
 * @param {string} [options.expectedPeriod]  รอบบิลที่คาดไว้ ใช้เตือนเมื่อไม่ตรง
 * @param {Anthropic} [options.client]
 */
export async function extractTimesheet(source, { expectedPeriod, client } = {}) {
  const anthropic = client ?? new Anthropic();
  const pdf = Buffer.isBuffer(source) ? source : await readFile(source);

  const hint = expectedPeriod
    ? `\n\nรอบบิลที่ระบบคาดไว้คือ ${expectedPeriod} — ถ้าเอกสารไม่ใช่เดือนนี้ ให้ใส่เดือนตามเอกสารและบันทึกลง notes`
    : '';

  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 16000,
    system: SYSTEM_PROMPT,
    output_config: {
      format: { type: 'json_schema', schema: TIMESHEET_SCHEMA },
      effort: 'high',
    },
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'document',
            source: {
              type: 'base64',
              media_type: 'application/pdf',
              data: pdf.toString('base64'),
            },
          },
          {
            type: 'text',
            text: `อ่านข้อมูลจาก Timesheet ฉบับนี้ตาม schema ที่กำหนด${hint}`,
          },
        ],
      },
    ],
  });

  if (response.stop_reason === 'refusal') {
    throw new Error(
      `โมเดลปฏิเสธการอ่านเอกสารนี้ (${response.stop_details?.category ?? 'ไม่ระบุเหตุผล'})`,
    );
  }
  if (response.stop_reason === 'max_tokens') {
    throw new Error('ผลลัพธ์ยาวเกิน max_tokens — เพิ่มค่าแล้วลองใหม่');
  }

  const textBlock = response.content.find((block) => block.type === 'text');
  if (!textBlock) {
    throw new Error('ไม่พบผลลัพธ์ที่เป็นข้อความในคำตอบของโมเดล');
  }

  const data = JSON.parse(textBlock.text);

  return {
    data,
    usage: response.usage,
    model: response.model,
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

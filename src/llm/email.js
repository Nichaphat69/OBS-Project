/**
 * ร่างอีเมลวางบิลด้วย Claude
 *
 * ทำไมต้องใช้โมเดลตรงนี้ ทั้งที่มี template อยู่แล้ว —
 * template เขียนได้แค่สิ่งที่เดาไว้ล่วงหน้า ส่วนอีเมลจริงต้องอธิบาย
 * "ทำไมเดือนนี้ยอดไม่เท่าเดือนก่อน" ซึ่งเปลี่ยนไปทุกเดือนตามวันลาที่เกิดขึ้นจริง
 * โมเดลได้รับเฉพาะตัวเลขที่ระบบคำนวณมาแล้ว **ห้ามคิดเลขเอง** ทำแค่เรียบเรียงเป็นภาษาคน
 *
 * ตัวเลขทุกตัวในอีเมลจึงยังมาจาก domain/invoice.js เส้นเดียวกับที่ขึ้นบนใบแจ้งหนี้
 */

import Anthropic from '@anthropic-ai/sdk';

export const EMAIL_MODEL = process.env.CLAUDE_MODEL ?? 'claude-opus-5';

const EMAIL_SCHEMA = {
  type: 'object',
  properties: {
    subject: {
      type: 'string',
      description: 'หัวข้ออีเมลภาษาไทย สั้น ระบุโครงการและเดือนที่วางบิล',
    },
    body: {
      type: 'string',
      description:
        'เนื้ออีเมลภาษาไทยแบบทางการ ขึ้นต้นด้วย "เรียน ..." และปิดท้ายด้วยคำลงท้ายสุภาพ ' +
        'ใช้ตัวเลขจากข้อมูลที่ให้เท่านั้น ห้ามคำนวณเพิ่มหรือปัดตัวเลขใหม่',
    },
    highlights: {
      type: 'array',
      description: 'ข้อสังเกตที่เจ้าหน้าที่ควรอ่านก่อนกดส่ง เช่น ยอดต่างจากเดือนก่อนเพราะอะไร',
      items: { type: 'string' },
    },
  },
  required: ['subject', 'body', 'highlights'],
  additionalProperties: false,
};

const SYSTEM_PROMPT = `คุณเป็นเจ้าหน้าที่บัญชีของบริษัทไทยที่ร่างอีเมลวางบิลให้ลูกค้าองค์กร

กฎที่ห้ามฝ่าฝืน
1. ใช้ตัวเลขจาก JSON ที่ได้รับเท่านั้น ห้ามบวกลบคูณหารเอง ห้ามปัดเศษใหม่ ห้ามเดาตัวเลขที่ไม่มีให้
2. เขียนภาษาไทยแบบหนังสือราชการ/ธุรกิจ สุภาพ กระชับ ไม่ใช้คำโฆษณา
3. ต้องระบุ: รายการค่าบริการรายคน · ส่วนลดวันลาถ้ามีพร้อมวันที่ลา · ยอดหลังหักส่วนลด ·
   VAT · ยอดรวม · ภาษีหัก ณ ที่จ่าย · ยอดรับชำระ · กำหนดชำระ · เลขที่ใบว่าจ้าง/ใบเสนอราคา
4. ถ้ามีข้อมูลเดือนก่อน ให้เขียนหนึ่งประโยคว่ายอดเดือนนี้ต่างจากเดือนก่อนเพราะอะไร
   ถ้าไม่มีข้อมูลเดือนก่อน ห้ามกล่าวถึงเรื่องนี้เลย
5. ห้ามสัญญาแทนบริษัท ห้ามระบุวันที่หรือเงื่อนไขที่ไม่ได้อยู่ในข้อมูล
6. อย่าใส่ลายเซ็นปลอมหรือชื่อผู้ส่ง — ปิดท้ายแค่คำลงท้ายสุภาพ`;

/* ── อ่านอีเมลแจ้งอนุมัติ (ขาเข้า) ─────────────────────────
   เนื้ออีเมลจากระบบของลูกค้าเป็นภาษาไทยผสมอังกฤษ รูปแบบไม่คงที่
   เลขที่เอกสารบางฉบับอยู่ในหัวข้อ บางฉบับอยู่ในตารางกลางเนื้อความ
   เขียน regex ไล่จับได้ แต่จะพังทุกครั้งที่ลูกค้าเปลี่ยน template
   ให้โมเดลอ่านแล้ว **ตรวจซ้ำกับไฟล์ Timesheet อีกชั้น** คุ้มกว่า */

const APPROVAL_SCHEMA = {
  type: 'object',
  properties: {
    isTimesheetApproval: {
      type: 'boolean',
      description: 'อีเมลฉบับนี้เป็นการแจ้งอนุมัติ Timesheet ใช่หรือไม่',
    },
    documentNo: {
      type: ['string', 'null'],
      description: 'เลขที่เอกสารของ Timesheet เช่น 2026010091 — ไม่พบให้เป็น null ห้ามเดา',
    },
    approvalStatus: {
      type: ['string', 'null'],
      description: 'สถานะที่เขียนในอีเมลตามตัวอักษร เช่น "อนุมัติ" "ไม่อนุมัติ" "รออนุมัติ"',
    },
    employeeName: {
      type: ['string', 'null'],
      description: 'ชื่อพนักงานที่อีเมลกล่าวถึง ตามที่เขียน ห้ามแก้การสะกด',
    },
    period: {
      type: ['string', 'null'],
      description: 'รอบเดือนของ Timesheet รูปแบบ YYYY-MM — ไม่แน่ใจให้เป็น null',
    },
    approvedBy: { type: ['string', 'null'], description: 'ชื่อหรือตำแหน่งผู้อนุมัติฝั่งลูกค้า' },
    approvedAt: { type: ['string', 'null'], description: 'วันที่อนุมัติ รูปแบบ YYYY-MM-DD' },
    notes: {
      type: 'array',
      description: 'สิ่งที่คนควรรู้ก่อนกดรับเข้าระบบ เช่น อีเมลบอกว่าเป็นฉบับแก้ไข',
      items: { type: 'string' },
    },
  },
  required: ['isTimesheetApproval', 'documentNo', 'approvalStatus', 'employeeName',
             'period', 'approvedBy', 'approvedAt', 'notes'],
  additionalProperties: false,
};

const APPROVAL_PROMPT = `คุณกำลังอ่านอีเมลแจ้งอนุมัติ Timesheet ที่ระบบของลูกค้าส่งมาให้บริษัทผู้ให้บริการ Outsource

กฎ
1. ดึงเฉพาะสิ่งที่เขียนอยู่จริงในอีเมล **ห้ามเดาและห้ามเติมเอง** ไม่พบให้ตอบ null
2. เลขที่เอกสารมักเป็นตัวเลขล้วน 10 หลัก เช่น 2026010091 อาจอยู่ในหัวข้อหรือในเนื้อความ
3. สถานะให้คัดลอกคำตามที่เขียน ไม่ต้องตีความว่าอนุมัติหรือไม่
4. ถ้าอีเมลไม่เกี่ยวกับการอนุมัติ Timesheet ให้ isTimesheetApproval = false และที่เหลือเป็น null`;

/**
 * @param {object} email  { subject, from, date, body }
 */
export async function readApprovalEmail(email) {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw Object.assign(
      new Error('ยังไม่ได้ตั้งค่า ANTHROPIC_API_KEY — ใส่ใน .env ก่อนใช้ AI อ่านอีเมล'),
      { status: 400 },
    );
  }

  const anthropic = new Anthropic();
  const response = await anthropic.messages.create({
    model: EMAIL_MODEL,
    max_tokens: 2000,
    system: APPROVAL_PROMPT,
    output_config: { format: { type: 'json_schema', schema: APPROVAL_SCHEMA } },
    messages: [
      {
        role: 'user',
        content:
          `จาก: ${email.from ?? '—'}\nวันที่: ${email.date ?? '—'}\n` +
          `หัวข้อ: ${email.subject ?? '—'}\n\n${(email.body ?? '').slice(0, 12000)}`,
      },
    ],
  });

  const textBlock = response.content.find((block) => block.type === 'text');
  if (!textBlock) throw new Error('ไม่พบผลลัพธ์ที่เป็นข้อความในคำตอบของโมเดล');

  return { ...JSON.parse(textBlock.text), model: response.model, usage: response.usage };
}

/**
 * @param {object} facts  ตัวเลขที่ระบบคำนวณแล้ว (ดู service.js → draftEmailWithAi)
 * @returns {Promise<{subject:string, body:string, highlights:string[], model:string, usage:object}>}
 */
export async function draftBillingEmail(facts) {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw Object.assign(
      new Error('ยังไม่ได้ตั้งค่า ANTHROPIC_API_KEY — ใส่ใน .env ก่อนใช้ AI ร่างอีเมล'),
      { status: 400 },
    );
  }

  const anthropic = new Anthropic();

  const response = await anthropic.messages.create({
    model: EMAIL_MODEL,
    max_tokens: 4000,
    system: SYSTEM_PROMPT,
    output_config: {
      format: { type: 'json_schema', schema: EMAIL_SCHEMA },
    },
    messages: [
      {
        role: 'user',
        content:
          'ร่างอีเมลวางบิลจากข้อมูลชุดนี้\n\n```json\n' +
          `${JSON.stringify(facts, null, 2)}\n` +
          '```',
      },
    ],
  });

  if (response.stop_reason === 'refusal') {
    throw new Error('โมเดลปฏิเสธที่จะร่างอีเมลฉบับนี้');
  }

  const textBlock = response.content.find((block) => block.type === 'text');
  if (!textBlock) throw new Error('ไม่พบผลลัพธ์ที่เป็นข้อความในคำตอบของโมเดล');

  const draft = JSON.parse(textBlock.text);
  return { ...draft, model: response.model, usage: response.usage };
}

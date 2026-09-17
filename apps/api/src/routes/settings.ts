import { Router } from 'express';
import { requireAuth } from '../lib/requireAuth.js';
import { requireAdmin } from '../lib/requireRole.js';
import { describePinnedTemplate, listTemplateSummaries } from '../lib/clearReadClient.js';
import { settingsSnapshot, setFlowAccountConnected, listReaders, setActiveReader, setActiveClearReadTemplate, SettingsError } from '../lib/settingsService.js';

export const settingsRouter = Router();
settingsRouter.use(requireAuth);

/** ported from service.js's `GET /api/settings` — เปิดให้ทุก role ที่ล็อกอินแล้วอ่านได้เหมือนต้นฉบับ
 * (ไม่มี requireAdmin) ใช้ทั้งหน้า "ความคืบหน้าของฉัน" (env.hasLine) และ "จัดการระบบ → ภาพรวม"
 * (env ทั้งชุด + flowaccount + billingRules) */
settingsRouter.get('/', async (_req, res) => {
  res.json(await settingsSnapshot());
});

/** รายชื่อเครื่องอ่าน Timesheet พร้อมสถานะ — หน้า "ตัวอ่าน Timesheet" วาดสองแท็บจากนี่
 * เปิดให้ทุก role ที่ล็อกอินอ่านได้ (แค่ดูว่าระบบใช้ตัวไหน ไม่ใช่ความลับ) */
settingsRouter.get('/readers', async (_req, res) => {
  res.json({ readers: await listReaders() });
});

/**
 * แม่แบบ Clear Read ที่ระบบปักไว้ใช้ตัวเดียว พร้อม **คำอธิบายรายฟิลด์** (คือ prompt ที่สั่งเครื่องอ่านจริง
 * ดู clearReadClient.ts) และผลเทียบกับสารบัญฟิลด์กลาง ว่าแม่แบบฝั่งเขาตามสเปกทันหรือยัง
 *
 * เปิดให้ทุก role ที่ล็อกอินอ่านได้เหมือน /readers — เป็นการตั้งค่าที่ดูได้ ไม่ใช่ความลับ
 * **อ่านอย่างเดียว** ไม่มีเส้นทางเขียนกลับไปที่แม่แบบของ user จากที่นี่โดยตั้งใจ
 *
 * ผลถูก cache ไว้ฝั่ง service (Clear Read ช้าและคิดเครดิตต่อการเรียก) — ส่ง ?refresh=1 เพื่อดึงใหม่
 * ต่อไม่ได้จะคืน `connected: false` พร้อมเหตุผล ไม่ใช่ error เพื่อให้หน้าตั้งค่ายังเปิดได้ตามปกติ
 */
settingsRouter.get('/clear-read/template', async (req, res) => {
  const templateId = typeof req.query.id === 'string' && req.query.id ? req.query.id : null;
  res.json(await describePinnedTemplate({ force: wantsRefresh(req.query.refresh), templateId }));
});

/** รายการแม่แบบทั้งหมดในโปรเจกต์ สำหรับ dropdown — คืนแบบย่อ (ไม่มีคำอธิบายรายฟิลด์) เพราะ 13 แม่แบบ
 * รวมกันหนักเกินจำเป็น กดเลือกแล้วค่อยดึงตัวเต็มจาก /clear-read/template?id=
 *
 * `detailColumnCount` ส่งมาเสมอเพราะแม่แบบที่เป็น 0 อ่านตารางรายวันไม่ได้เลย (มีหลายตัวในบัญชีนี้ที่เป็น
 * แม่แบบใบกำกับภาษี/บัตรประชาชน ไม่ใช่ Timesheet) หน้าจอต้องเตือนหรือปิดไม่ให้เลือกได้
 */
settingsRouter.get('/clear-read/templates', async (req, res) => {
  res.json(await listTemplateSummaries({ force: wantsRefresh(req.query.refresh) }));
});

/** `?refresh` แบบไม่ใส่ค่า = ดึงใหม่ แต่ `?refresh=0` / `=false` ต้องแปลว่าไม่ดึงใหม่ตามที่ชื่อสื่อ */
function wantsRefresh(raw: unknown): boolean {
  return raw !== undefined && raw !== '0' && raw !== 'false';
}

/**
 * เลือกแม่แบบ Clear Read ที่ใช้อ่านทั้งระบบ — admin/แผนกบัญชีเท่านั้น
 *
 * เจ้าของระบบสั่ง 17 ก.ย. 69 ว่าเลือกจากหน้าตัวอ่านแล้วต้องเปลี่ยนตัวที่ใช้อ่านจริงด้วย ไม่ใช่แค่เปิดดู
 * ค่าที่เลือกทับ CLEAR_READ_TEMPLATE_ID ใน .env — ยังไม่เคยเลือกก็ใช้ค่าจาก .env เหมือนเดิม
 *
 * ⚠️ คนละเรื่องกับการ "แก้แม่แบบ" — เส้นนี้แค่บอกว่าจะใช้แม่แบบตัวไหน ไม่ได้ไปเขียนอะไรในแม่แบบของ user
 */
settingsRouter.patch('/clear-read/template/active', requireAdmin, async (req, res) => {
  try {
    const id = String(req.body?.id ?? '');
    res.json(await setActiveClearReadTemplate(id, { actor: req.user!.nameTh }));
  } catch (error) {
    if (error instanceof SettingsError) return res.status(error.status).json({ error: error.message });
    const message = error instanceof Error ? error.message : 'เลือกแม่แบบไม่สำเร็จ';
    res.status(502).json({ error: message });
  }
});

/** สลับเครื่องอ่านทั้งระบบ — admin/แผนกบัญชีเท่านั้น มีผลกับไฟล์ที่อ่านหลังจากนี้ */
settingsRouter.patch('/readers/active', requireAdmin, async (req, res) => {
  try {
    const id = String(req.body?.id ?? '');
    res.json({ readers: await setActiveReader(id, { actor: req.user!.nameTh }) });
  } catch (error) {
    if (error instanceof SettingsError) return res.status(error.status).json({ error: error.message });
    throw error;
  }
});

/** สวิตช์เชื่อมต่อ FlowAccount บนแถบบน — เปิด/ปิดได้จาก admin/แผนกบัญชีเท่านั้น (มีผลกับทั้งระบบทันที) */
settingsRouter.patch('/flowaccount-connected', requireAdmin, async (req, res) => {
  try {
    res.json(await setFlowAccountConnected(Boolean(req.body?.enabled), { actor: req.user!.nameTh }));
  } catch (error) {
    if (error instanceof SettingsError) return res.status(error.status).json({ error: error.message });
    throw error;
  }
});

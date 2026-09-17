import { Router } from 'express';
import { requireAuth } from '../lib/requireAuth.js';
import { requireAdmin } from '../lib/requireRole.js';
import { describePinnedTemplate } from '../lib/clearReadClient.js';
import { settingsSnapshot, setFlowAccountConnected, listReaders, setActiveReader, SettingsError } from '../lib/settingsService.js';

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
  // รับทั้งแบบมีพารามิเตอร์เฉยๆ (?refresh) และแบบใส่ค่า แต่ `?refresh=0` / `?refresh=false` ต้องแปลว่า
  // "ไม่ต้องดึงใหม่" ตามที่ชื่อพารามิเตอร์สื่อ — เดิมเช็คแค่ว่ามีพารามิเตอร์ไหม ทำให้ใส่ 0 แล้วยังดึงใหม่
  const raw = req.query.refresh;
  const force = raw !== undefined && raw !== '0' && raw !== 'false';
  res.json(await describePinnedTemplate({ force }));
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

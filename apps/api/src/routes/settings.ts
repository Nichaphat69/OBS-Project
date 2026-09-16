import { Router } from 'express';
import { requireAuth } from '../lib/requireAuth.js';
import { requireAdmin } from '../lib/requireRole.js';
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

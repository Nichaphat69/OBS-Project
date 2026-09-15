import { Router } from 'express';
import { requireAuth } from '../lib/requireAuth.js';
import { requireAdmin } from '../lib/requireRole.js';
import { HolidayError, addHoliday, ensureOfficialHolidays, listHolidays, officialHolidayYears, removeHoliday } from '../lib/holidaysService.js';

export const holidaysRouter = Router();
holidaysRouter.use(requireAuth);

/** ported from server.js `GET /api/holidays` — เติมวันหยุดทางการของปีนี้ให้อัตโนมัติก่อนอ่านกลับเสมอ
 * (ถ้ายังไม่เคยมีเลยสักวันของปีนั้น) หน้า "วันหยุด" จึง "ใช้ได้เลย" โดยไม่ต้องมีปุ่ม seed แยก */
holidaysRouter.get('/', requireAdmin, async (req, res) => {
  const year = Number(req.query.year) || new Date().getFullYear();
  await ensureOfficialHolidays(year, req.user!.nameTh);
  res.json({ year, years: officialHolidayYears(), holidays: await listHolidays(year) });
});

/** ported from server.js `POST /api/holidays` */
holidaysRouter.post('/', requireAdmin, async (req, res) => {
  try {
    res.json(await addHoliday({ date: req.body?.date, name: req.body?.name, customerId: req.body?.customerId ?? null, actor: req.user!.nameTh }));
  } catch (error) {
    if (error instanceof HolidayError) return res.status(error.status).json({ error: error.message });
    throw error;
  }
});

/** ported from server.js `DELETE /api/holidays` */
holidaysRouter.delete('/', requireAdmin, async (req, res) => {
  try {
    const date = typeof req.query.date === 'string' ? req.query.date : '';
    const customerId = typeof req.query.customerId === 'string' ? req.query.customerId : null;
    res.json(await removeHoliday({ date, customerId, actor: req.user!.nameTh }));
  } catch (error) {
    if (error instanceof HolidayError) return res.status(error.status).json({ error: error.message });
    throw error;
  }
});

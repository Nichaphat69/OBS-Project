import { Router } from 'express';
import { requireAuth } from '../lib/requireAuth.js';
import { requireSuperAdmin } from '../lib/requireRole.js';
import { listAbbyySkills, createAbbyySkill, updateAbbyySkill, deleteAbbyySkill, AbbyySkillError } from '../lib/abbyySkillsService.js';
import { FieldMapSuggestError, suggestFieldMap } from '../lib/fieldMapSuggestService.js';

export const abbyySkillsRouter = Router();

// GET เปิดให้ทุก role ที่ล็อกอินแล้ว (ใช้ populate dropdown เลือก Skill ตอนแก้ไขสัญญา)
abbyySkillsRouter.use(requireAuth);

abbyySkillsRouter.get('/', async (_req, res) => {
  res.json(await listAbbyySkills());
});

abbyySkillsRouter.post('/', requireSuperAdmin, async (req, res) => {
  try {
    const body = req.body ?? {};
    const row = await createAbbyySkill({ name: body.name, skillId: body.skillId, actor: req.user!.nameTh });
    res.json(row);
  } catch (error) {
    if (error instanceof AbbyySkillError) return res.status(error.status).json({ error: error.message });
    throw error;
  }
});

/** ใหม่ (ไม่มีในต้นฉบับ) — แก้ mapping ชื่อฟิลด์ต่อ Skill (ดู AbbyyFieldMap ใน abbyyClient.ts) ให้ตรง
 * กับที่ Skill นั้นเทรนไว้จริงใน ABBYY Vantage — ไม่ต้องแก้โค้ด/deploy ใหม่ทุกครั้งที่เพิ่ม Skill บริษัทใหม่ */
abbyySkillsRouter.patch('/:id', requireSuperAdmin, async (req, res) => {
  try {
    const row = await updateAbbyySkill(decodeURIComponent(req.params.id), {
      fieldMap: req.body?.fieldMap ?? null,
      actor: req.user!.nameTh,
    });
    res.json(row);
  } catch (error) {
    if (error instanceof AbbyySkillError) return res.status(error.status).json({ error: error.message });
    throw error;
  }
});

abbyySkillsRouter.delete('/:id', requireSuperAdmin, async (req, res) => {
  try {
    res.json(await deleteAbbyySkill(decodeURIComponent(req.params.id), { actor: req.user!.nameTh }));
  } catch (error) {
    if (error instanceof AbbyySkillError) return res.status(error.status).json({ error: error.message });
    throw error;
  }
});

/**
 * เดาชื่อฟิลด์จาก Timesheet ตัวอย่าง เพื่อเติมหน้าจอจับคู่ฟิลด์ให้ล่วงหน้า (27 ก.ย. 69)
 *
 * **อ่านอย่างเดียว ไม่บันทึกอะไรทั้งสิ้น** — คืนร่างให้หน้าจอเติมในช่อง คนตรวจแล้วกดบันทึกเองผ่านเส้น
 * PATCH เดิม ถ้าเส้นนี้บันทึกเองจะกลายเป็นการทับ mapping ที่ตั้งไว้แล้วด้วยการเดา
 */
abbyySkillsRouter.post('/suggest-field-map', requireSuperAdmin, async (req, res) => {
  try {
    res.json(await suggestFieldMap({
      fileBase64: String(req.body?.fileBase64 ?? ''),
      fileName: String(req.body?.fileName ?? ''),
    }));
  } catch (error) {
    if (error instanceof FieldMapSuggestError) return res.status(error.status).json({ error: error.message });
    throw error;
  }
});

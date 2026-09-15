/** สารบัญ Skill ABBYY — ported from service.js's listAbbyySkills/createAbbyySkill/
 * deleteAbbyySkill. Contracts reference a skill by raw skillId (no FK), so deleting a directory
 * entry never breaks a contract that already picked it — it only disappears from the dropdown. */
import { prisma, Prisma } from '@obs/db';
import { logAudit } from './audit.js';
import type { AbbyyFieldMap } from './abbyyClient.js';

export class AbbyySkillError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

/** ported from service.js nextId('SKL', 'abbyy_skills') — scans existing ids, only counts
 * all-digit suffixes, next = max + 1. */
async function nextSkillId(): Promise<string> {
  const rows = await prisma.abbyySkill.findMany({ where: { id: { startsWith: 'SKL-' } }, select: { id: true } });
  const max = rows.reduce((m, r) => {
    const n = Number(r.id.slice(4));
    return Number.isInteger(n) && n > m ? n : m;
  }, 0);
  return `SKL-${String(max + 1).padStart(4, '0')}`;
}

export async function listAbbyySkills() {
  return prisma.abbyySkill.findMany({ orderBy: { name: 'asc' } });
}

export async function createAbbyySkill({ name, skillId, actor }: { name: string; skillId: string; actor: string }) {
  const trimmedName = (name ?? '').trim();
  const trimmedSkillId = (skillId ?? '').trim();
  if (!trimmedName || !trimmedSkillId) throw new AbbyySkillError('ต้องระบุชื่อ Skill และ Skill ID ให้ครบ');

  const existing = await prisma.abbyySkill.findUnique({ where: { skillId: trimmedSkillId } });
  if (existing) throw new AbbyySkillError('Skill ID นี้มีอยู่ในสารบัญแล้ว', 409);

  const id = await nextSkillId();
  const row = await prisma.abbyySkill.create({
    data: { id, name: trimmedName, skillId: trimmedSkillId, createdAt: new Date().toISOString() },
  });
  await logAudit({ actor, action: 'create_abbyy_skill', entityType: 'abbyy_skill', entityId: id, detail: { name: trimmedName, skillId: trimmedSkillId } });
  return row;
}

export async function deleteAbbyySkill(id: string, { actor }: { actor: string }) {
  const row = await prisma.abbyySkill.findUnique({ where: { id } });
  if (!row) throw new AbbyySkillError('ไม่พบ Skill นี้ในสารบัญ', 404);

  await prisma.abbyySkill.delete({ where: { id } });
  await logAudit({ actor, action: 'delete_abbyy_skill', entityType: 'abbyy_skill', entityId: id, detail: { name: row.name } });
  return { deleted: true, id };
}

/** ใหม่ (ไม่มีในต้นฉบับ) — แก้ mapping ชื่อฟิลด์ต่อ Skill (ดูคอมเมนต์ AbbyyFieldMap ใน abbyyClient.ts)
 * ให้ admin แก้ได้จากหน้า "Skill ABBYY" โดยไม่ต้องแก้โค้ด/deploy ใหม่ทุกครั้งที่เพิ่ม Skill บริษัทใหม่ —
 * ส่ง `fieldMap: null` เพื่อล้างกลับไปใช้ค่า default ของ "OBS Timesheet2"/iPassion ได้ */
export async function updateAbbyySkill(
  id: string,
  { fieldMap, actor }: { fieldMap: AbbyyFieldMap | null; actor: string },
) {
  const row = await prisma.abbyySkill.findUnique({ where: { id } });
  if (!row) throw new AbbyySkillError('ไม่พบ Skill นี้ในสารบัญ', 404);

  const updated = await prisma.abbyySkill.update({
    where: { id },
    data: { fieldMap: fieldMap === null ? Prisma.JsonNull : (fieldMap as Prisma.InputJsonValue) },
  });
  await logAudit({ actor, action: 'update_abbyy_skill_field_map', entityType: 'abbyy_skill', entityId: id, detail: { name: row.name, fieldMap } });
  return updated;
}

/** ใหม่ (ไม่มีในต้นฉบับ) — ดึง fieldMap ของ Skill ตาม skillId (ไม่ใช่ id ภายในของสารบัญ) มาให้
 * extractionService.ts ใช้ตอนเรียก mapAbbyyResult() จริง — คืน null ถ้าไม่เจอ Skill นี้ในสารบัญเลย
 * (ยังไม่เคยเพิ่มเข้ามา) หรือเจอแต่ยังไม่ได้ตั้ง mapping ไว้ (ทั้งสองกรณีให้ mapAbbyyResult() ใช้ค่า
 * default ของมันเองต่อไป ไม่ throw — Skill ที่ไม่มีในสารบัญยังต้องอ่านไฟล์ได้ตามปกติ) */
export async function getFieldMapForSkill(skillId: string | null | undefined): Promise<AbbyyFieldMap | null> {
  if (!skillId) return null;
  const row = await prisma.abbyySkill.findUnique({ where: { skillId }, select: { fieldMap: true } });
  return (row?.fieldMap as AbbyyFieldMap | null) ?? null;
}

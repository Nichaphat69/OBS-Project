/**
 * ตัวอ่านไฟล์ Timesheet — ported from src/extract/timesheet.js's `extractTimesheet()`.
 *
 * The original tries ABBYY Vantage first when configured, and only falls back to the local
 * vision/text LLM pipeline (localExtractionService.ts, ported in Phase 5.7) when it isn't. This
 * deployment's `.env` has real ABBYY credentials configured, so the ABBYY path is what's actually
 * exercised in practice — the local-LLM fallback below is code-complete but unverified against
 * real data (the machine running the local model isn't reachable from this environment; see
 * localLlmClient.ts's file header).
 *
 * Verification for the ABBYY path is intentionally light: ABBYY's own `mapAbbyyResult()` already
 * produces `notes[]` describing anything uncertain (missing fields, unreliable table columns,
 * leave-count mismatches) — those are surfaced as `warn`-severity issues rather than re-deriving
 * the original's full multi-page consistency checks, which don't apply to a single ABBYY call
 * anyway. The local-LLM path uses the original's full `verifyExtraction()` (ported as-is in
 * localExtractionService.ts) since that path genuinely needs the multi-page consistency checks.
 */
import { AbbyyClient, hasAbbyyCredentials, mapAbbyyResult } from './abbyyClient.js';
import { extractTimesheetViaLocalLlm } from './localExtractionService.js';
import { getFieldMapForSkill } from './abbyySkillsService.js';
import type { Extractor, ExtractorResult } from './ingestService.js';

export class ExtractionError extends Error {
  status: number;
  constructor(message: string, status = 502) {
    super(message);
    this.status = status;
  }
}

export const extractTimesheet: Extractor = async (source, { expectedPeriod, abbyySkillId } = {}) => {
  if (!Buffer.isBuffer(source)) {
    throw new ExtractionError('ต้องมีไฟล์ PDF ให้อ่าน', 400);
  }

  if (!hasAbbyyCredentials()) {
    const { data, verification, usage, model } = await extractTimesheetViaLocalLlm(source, { expectedPeriod });
    return { data: data as any, verification, usage, model } satisfies ExtractorResult;
  }

  // เลือก Skill ตามสัญญา/บริษัทที่ระบุมา (ผู้เรียกส่งมาจาก contract.abbyySkillId ที่ตั้งไว้ในหน้า
  // ข้อมูลหลัก) — ถ้าไม่ส่งมาหรือสัญญานั้นยังไม่ได้ตั้ง Skill ไว้ ปล่อยให้ AbbyyClient fallback ไปใช้
  // ABBYY_SKILL_ID เดิมจาก .env ตามพฤติกรรมเดิมก่อนมี multi-skill
  const client = new AbbyyClient(abbyySkillId ? { skillId: abbyySkillId } : {});
  const { rawResult } = await client.extractDocument(source, 'timesheet.pdf');
  // ดึง mapping ชื่อฟิลด์ต่อ Skill (ดู AbbyyFieldMap ใน abbyyClient.ts) — คืน null ถ้า Skill นี้ยังไม่มี
  // ในสารบัญ/ยังไม่ได้ตั้ง mapping เอง แล้ว mapAbbyyResult() จะ fallback ไปใช้ default ของ
  // "OBS Timesheet2"/iPassion เอง (ตรงกับพฤติกรรมเดิมก่อนมี multi-skill field mapping)
  const fieldMap = await getFieldMapForSkill(abbyySkillId);
  const data = mapAbbyyResult(rawResult, fieldMap);

  if (expectedPeriod && data.period && data.period !== expectedPeriod) {
    data.notes = [...(data.notes ?? []), `รอบเดือนที่อ่านได้ (${data.period}) ไม่ตรงกับที่คาดไว้ (${expectedPeriod}) — ตรวจสอบก่อนยืนยัน`];
  }

  const issues = (data.notes ?? []).map((message) => ({ severity: 'warn', message }));

  return {
    data: data as any,
    verification: { ok: true, issues },
    usage: null,
    model: 'abbyy',
    rawResponse: rawResult,
  } satisfies ExtractorResult;
};

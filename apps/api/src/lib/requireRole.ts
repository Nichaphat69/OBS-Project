import type { NextFunction, Request, Response } from 'express';

/** ported from server.js requireAdmin() — admin หรือแผนกบัญชี */
export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  if (req.user?.role !== 'admin' && req.user?.role !== 'accounting') {
    return res.status(403).json({ error: 'ต้องเป็น admin หรือแผนกบัญชีเท่านั้นถึงจะแก้ข้อมูลหลักได้' });
  }
  next();
}

/** ported from server.js requireSuperAdmin() — admin เท่านั้น */
export function requireSuperAdmin(req: Request, res: Response, next: NextFunction) {
  if (req.user?.role !== 'admin') {
    return res.status(403).json({ error: 'ต้องเป็น admin เท่านั้นถึงจะทำรายการนี้ได้' });
  }
  next();
}

/** ported from server.js requireNotExecutive() — ทุก role ทำได้ยกเว้น 'executive' (ดูอย่างเดียว) */
export function requireNotExecutive(req: Request, res: Response, next: NextFunction) {
  if (req.user?.role === 'executive') {
    return res.status(403).json({ error: 'role ผู้บริหารดูข้อมูลได้อย่างเดียว ทำรายการนี้ไม่ได้' });
  }
  next();
}

/** ใหม่ (ไม่มีในต้นฉบับ) — สมมาตรกับ requireNotExecutive() ด้านบน แต่กันฝั่งตรงข้าม: ทุก role ดูได้
 * ยกเว้น 'user' (พนักงานทั่วไป) — ใช้กับ endpoint อ่านข้อมูล Manday/รอบบิล/พนักงานคนอื่นที่ role
 * 'admin'/'accounting'/'executive' ต้องใช้ร่วมกันจริง (เช่นหน้า "ภาพรวมทุกบริษัท" ของ executive) แต่
 * พนักงานทั่วไปไม่ควรเห็นข้อมูลของคนอื่นเลย (ดู requireAdmin ถ้าต้องการปิดทั้ง user และ executive พร้อม
 * กัน — เอกสารย่อยกว่านี้เช่นรายละเอียดบิล/ใบแจ้งหนี้เต็มรูปแบบใช้ requireAdmin แทน ไม่ใช่ตัวนี้)
 * เจอจริง 15 ก.ย. 69 ตอนไล่ตรวจ audit ทั้งระบบ — endpoint กลุ่มนี้ไม่มี role check เลยมาก่อน */
export function requireNotUser(req: Request, res: Response, next: NextFunction) {
  if (req.user?.role === 'user') {
    return res.status(403).json({ error: 'role พนักงานดูข้อมูลของคนอื่นไม่ได้ — ดูความคืบหน้าของตัวเองได้ที่หน้า "ความคืบหน้าของฉัน"' });
  }
  next();
}

export class ForbiddenEmployeeScope extends Error {
  status = 403;
}

/**
 * ใช้คู่กับ `requireAuthOrN8nSecret` — endpoint ที่เรียกได้ทั้งจาก n8n (ไม่มี session) และจากคนที่ล็อกอิน
 * โดย **ฝั่งคนต้องเป็น admin/บัญชีเท่านั้น** (18 ก.ย. 69)
 *
 * ต้นฉบับใน server.js ทำ `if (session) requireAdmin(session)` ไว้ (คอมเมนต์ใน n8nAuth.ts เขียนถึงเอง)
 * แต่ตอนพอร์ตมา `requireAuthOrN8nSecret` เหลือแค่ "มี session ก็ผ่าน" — role ไหนก็ได้ ทำให้พนักงานทั่วไป
 * สั่งส่งคำขออนุมัติออก INV ของสัญญา/รอบไหนก็ได้เข้า LINE ของผู้อนุมัติได้ ทั้งที่เป็นงานของฝ่ายบัญชี
 *
 * ไม่มี session = มาจาก n8n ที่ผ่าน shared secret มาแล้ว ปล่อยผ่านตามเดิม
 */
export function requireAdminIfSession(req: Request, res: Response, next: NextFunction) {
  if (req.user && req.user.role !== 'admin' && req.user.role !== 'accounting') {
    return res.status(403).json({ error: 'ต้องเป็น admin หรือแผนกบัญชีเท่านั้นถึงจะส่งคำขออนุมัติออก INV ได้' });
  }
  next();
}

/**
 * employeeId ที่ผู้เรียกมีสิทธิ์ถามถึงจริง — สำหรับ endpoint ที่ **พนักงานทั่วไปต้องใช้ได้** กับข้อมูลของ
 * ตัวเอง จึงกันด้วย requireNotUser ไม่ได้ (18 ก.ย. 69)
 *
 * รูปแบบเดียวกับ `restrictToEmployeeId` ที่ POST /api/timesheets/confirm กับ /manual ใช้อยู่แล้วตั้งแต่
 * 15 ก.ย. 69 — role 'user' ได้ของตัวเองเสมอไม่ว่าจะส่ง employeeId อะไรมาในคำขอ ส่วน role อื่น
 * (admin/accounting/executive) ยังถามแทนพนักงานคนอื่นได้ตามงานปกติ
 *
 * บัญชี role 'user' ที่ยังไม่ได้ผูกกับพนักงานคนไหน ต้องถูกปฏิเสธตั้งแต่ต้น ไม่ใช่ปล่อยผ่านเป็น null
 * เพราะ null ในชั้นล่างแปลว่า "ไม่จำกัด" ไม่ใช่ "ไม่ตรงกับใครเลย" (กับดักเดียวกับที่ timesheets.ts เขียน
 * เตือนไว้)
 */
export function scopedEmployeeId(
  user: { role: string; employeeId: string | null } | undefined,
  requested: unknown,
): string {
  if (user?.role === 'user') {
    if (!user.employeeId) {
      throw new ForbiddenEmployeeScope('บัญชีนี้ยังไม่ได้ผูกกับพนักงานคนไหนเลย — ติดต่อ admin ให้ผูกบัญชีก่อน');
    }
    return user.employeeId;
  }
  return typeof requested === 'string' ? requested : '';
}

/** ใหม่ (15 ก.ย. 69 ตาม policy ที่ user ยืนยัน) — endpoint ที่รับ `contractId` query param เป็นตัวกรอง
 * ได้ (ไม่ระบุ = ข้อมูลรวมทุกบริษัท) ต้องบังคับว่า "ดูรวมทุกบริษัทพร้อมกัน" ทำได้เฉพาะ role 'executive'
 * เท่านั้น — role อื่น (admin/accounting) ต้องส่ง contractId มาด้วยเสมอถึงจะขอได้ ป้องกันกรณีเรียกตรงผ่าน
 * API client ข้าม UI ที่ปิดทางเลือกนี้ไว้แล้วแต่ backend เองยังไม่ได้บังคับ ใช้คู่กับ requireNotUser (กัน
 * role 'user' ออกไปก่อนเสมอไม่ว่าจะระบุ contractId หรือไม่) */
export function requireExecutiveWhenUnscoped(req: Request, res: Response, next: NextFunction) {
  const hasContractId = typeof req.query.contractId === 'string' && req.query.contractId.length > 0;
  if (!hasContractId && req.user?.role !== 'executive') {
    return res.status(400).json({ error: 'ต้องระบุ contractId — ดูข้อมูลรวมทุกบริษัทพร้อมกันได้เฉพาะ role ผู้บริหารเท่านั้น' });
  }
  next();
}

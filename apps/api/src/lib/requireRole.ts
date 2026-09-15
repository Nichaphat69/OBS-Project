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

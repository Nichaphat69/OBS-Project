/**
 * Shared-secret auth guard for the handful of endpoints n8n calls directly — `POST
 * /api/timesheets/ingest`, `GET /api/cycles/ready`, `POST
 * /api/cycles/:contractId/:period/request-approval` (dual-mode), and `POST
 * /api/timesheets/send-overdue-reminders`.
 *
 * The original (src/server.js's `PUBLIC_API_PATTERNS`) left these completely unauthenticated —
 * anyone who could reach the old app's port could call them. MIGRATION_PLAN.md calls for closing
 * that gap in this port: n8n must send the shared secret configured in `N8N_SHARED_SECRET` via
 * the `x-n8n-secret` header on every call to these routes.
 */
import type { NextFunction, Request, Response } from 'express';
import { timingSafeEqual } from 'node:crypto';
import { SESSION_COOKIE, resolveSession } from './auth.js';

const N8N_SECRET_HEADER = 'x-n8n-secret';

function validSecret(provided: string | undefined): boolean {
  const expected = process.env.N8N_SHARED_SECRET;
  if (!expected || !provided) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/** เฉพาะ n8n เท่านั้น — ไม่มี session ใดๆเข้ามาเกี่ยวข้อง */
export async function requireN8nSecret(req: Request, res: Response, next: NextFunction) {
  if (!validSecret(req.header(N8N_SECRET_HEADER))) {
    return res.status(401).json({ error: 'ต้องระบุ shared secret ของ n8n (header x-n8n-secret) ให้ถูกต้อง' });
  }
  next();
}

/** dual-mode ตรงกับต้นฉบับ (`/request-approval` เดิม: `if (session) requireAdmin(session)` แล้วใช้
 * `session?.nameTh ?? 'n8n'` เป็น actor) — เรียกได้ทั้งจาก admin ที่ล็อกอินในเว็บ หรือจาก n8n ที่ไม่มี
 * session เลยแต่ส่ง shared secret มาแทน */
export async function requireAuthOrN8nSecret(req: Request, res: Response, next: NextFunction) {
  const token = req.cookies?.[SESSION_COOKIE];
  const user = token ? await resolveSession(token) : null;
  if (user) {
    req.user = user;
    return next();
  }
  if (validSecret(req.header(N8N_SECRET_HEADER))) return next();
  return res.status(401).json({ error: 'ต้องเข้าสู่ระบบ หรือระบุ shared secret ของ n8n (header x-n8n-secret) ให้ถูกต้อง' });
}

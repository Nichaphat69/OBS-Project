import type { NextFunction, Request, Response } from 'express';
import { SESSION_COOKIE, resolveSession, type SessionUser } from './auth.js';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: SessionUser;
    }
  }
}

/** Shared session guard for routes beyond auth/dashboard — attaches req.user or responds 401. */
export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  const token = req.cookies?.[SESSION_COOKIE];
  const user = await resolveSession(token);
  if (!user) return res.status(401).json({ error: 'ยังไม่ได้เข้าสู่ระบบ' });
  req.user = user;
  next();
}

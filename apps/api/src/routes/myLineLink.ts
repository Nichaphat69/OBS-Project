import { Router } from 'express';
import { requireAuth } from '../lib/requireAuth.js';
import { startEmployeeLineLink, unlinkEmployeeLine, getEmployeeLineLinkStatus, EmployeeLineLinkError } from '../lib/employeeLineLinkService.js';
import { getLineAddFriendUrl } from '../lib/lineClient.js';

export const myLineLinkRouter = Router();
myLineLinkRouter.use(requireAuth);

function requireEmployeeSelf(req: any, res: any, next: any) {
  if (req.user!.role !== 'user') return res.status(403).json({ error: 'มีแค่ role พนักงานเท่านั้นที่ผูกไลน์ได้' });
  if (!req.user!.employeeId) return res.status(400).json({ error: 'บัญชีนี้ยังไม่ได้ผูกกับพนักงานคนไหนเลย' });
  next();
}

/** ลิงก์แอดเพื่อน OA สำหรับหน้า onboarding — ใช้สร้าง QR/ปุ่มก่อนขอรหัส 6 หลัก */
myLineLinkRouter.get('/oa-info', requireEmployeeSelf, async (_req, res) => {
  try {
    res.json({ addFriendUrl: await getLineAddFriendUrl() });
  } catch {
    res.status(502).json({ error: 'ดึงข้อมูล LINE OA ไม่สำเร็จ' });
  }
});

myLineLinkRouter.get('/status', requireEmployeeSelf, async (req, res) => {
  try {
    res.json(await getEmployeeLineLinkStatus(req.user!.employeeId!));
  } catch (error) {
    if (error instanceof EmployeeLineLinkError) return res.status(error.status).json({ error: error.message });
    throw error;
  }
});

myLineLinkRouter.post('/start', requireEmployeeSelf, async (req, res) => {
  try {
    res.json(await startEmployeeLineLink(req.user!.employeeId!));
  } catch (error) {
    if (error instanceof EmployeeLineLinkError) return res.status(error.status).json({ error: error.message });
    throw error;
  }
});

myLineLinkRouter.post('/unlink', requireEmployeeSelf, async (req, res) => {
  try {
    res.json(await unlinkEmployeeLine(req.user!.employeeId!));
  } catch (error) {
    if (error instanceof EmployeeLineLinkError) return res.status(error.status).json({ error: error.message });
    throw error;
  }
});

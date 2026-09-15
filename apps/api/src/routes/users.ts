import { Router } from 'express';
import { requireAuth } from '../lib/requireAuth.js';
import { requireSuperAdmin } from '../lib/requireRole.js';
import { listUsers, createUser, updateUserNames, updateUserRole, updateUserEmployee, setUserActive, deleteUser, resetPassword, UserActionError } from '../lib/usersService.js';

export const usersRouter = Router();

usersRouter.use(requireAuth, requireSuperAdmin);

usersRouter.get('/', async (_req, res) => {
  res.json(await listUsers());
});

usersRouter.post('/', async (req, res) => {
  try {
    const body = req.body ?? {};
    const user = await createUser({
      username: body.username,
      nameTh: body.nameTh,
      nameEn: body.nameEn || null,
      password: body.password,
      role: body.role,
      employeeId: body.employeeId || null,
      actor: req.user!.nameTh,
    });
    res.json(user);
  } catch (error) {
    if (error instanceof UserActionError) return res.status(error.status).json({ error: error.message });
    throw error;
  }
});

usersRouter.patch('/:username', async (req, res) => {
  try {
    const { username } = req.params;
    const body = req.body ?? {};
    const self = username === req.user!.username;

    if (self && body.active === false) return res.status(400).json({ error: 'ปิดใช้งานบัญชีของตัวเองไม่ได้' });
    if (self && body.role !== undefined) return res.status(400).json({ error: 'แก้ role ของตัวเองไม่ได้' });

    if (
      body.role === undefined &&
      body.active === undefined &&
      body.employeeId === undefined &&
      body.nameTh === undefined &&
      body.nameEn === undefined
    ) {
      return res.status(400).json({ error: 'ต้องระบุ role หรือ active หรือ employeeId หรือ nameTh/nameEn อย่างใดอย่างหนึ่ง' });
    }

    const actor = req.user!.nameTh;
    if (body.role !== undefined) await updateUserRole(username, body.role, { actor });
    if (body.active !== undefined) await setUserActive(username, Boolean(body.active), { actor });
    if (body.employeeId !== undefined) await updateUserEmployee(username, body.employeeId || null, { actor });
    if (body.nameTh !== undefined || body.nameEn !== undefined) {
      await updateUserNames(username, { nameTh: body.nameTh, nameEn: body.nameEn }, { actor });
    }

    res.json(await listUsers().then((rows) => rows.find((r) => r.username === username)));
  } catch (error) {
    if (error instanceof UserActionError) return res.status(error.status).json({ error: error.message });
    throw error;
  }
});

usersRouter.post('/:username/reset-password', async (req, res) => {
  try {
    await resetPassword(req.params.username, req.body?.newPassword ?? '', { actor: req.user!.nameTh });
    res.json({ reset: true });
  } catch (error) {
    if (error instanceof UserActionError) return res.status(error.status).json({ error: error.message });
    throw error;
  }
});

usersRouter.delete('/:username', async (req, res) => {
  try {
    if (req.params.username === req.user!.username) return res.status(400).json({ error: 'ลบบัญชีของตัวเองไม่ได้' });
    await deleteUser(req.params.username, { actor: req.user!.nameTh });
    res.json({ deleted: true });
  } catch (error) {
    if (error instanceof UserActionError) return res.status(error.status).json({ error: error.message });
    throw error;
  }
});

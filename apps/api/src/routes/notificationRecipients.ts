import { Router } from 'express';
import { requireAuth } from '../lib/requireAuth.js';
import { requireSuperAdmin } from '../lib/requireRole.js';
import {
  listNotificationRecipients,
  addNotificationRecipient,
  removeNotificationRecipient,
  listKnownLineUsers,
  NotificationRecipientError,
} from '../lib/notificationRecipientsService.js';

export const notificationRecipientsRouter = Router();
notificationRecipientsRouter.use(requireAuth, requireSuperAdmin);

notificationRecipientsRouter.get('/', async (_req, res) => {
  res.json(await listNotificationRecipients());
});

notificationRecipientsRouter.post('/', async (req, res) => {
  try {
    const body = req.body ?? {};
    const recipient = await addNotificationRecipient({ channel: body.channel, label: body.label, target: body.target, actor: req.user!.nameTh });
    res.json(recipient);
  } catch (error) {
    if (error instanceof NotificationRecipientError) return res.status(error.status).json({ error: error.message });
    throw error;
  }
});

notificationRecipientsRouter.delete('/:id', async (req, res) => {
  try {
    await removeNotificationRecipient(Number(req.params.id), { actor: req.user!.nameTh });
    res.json({ deleted: true });
  } catch (error) {
    if (error instanceof NotificationRecipientError) return res.status(error.status).json({ error: error.message });
    throw error;
  }
});

export const lineRouter = Router();
lineRouter.use(requireAuth, requireSuperAdmin);

lineRouter.get('/known-users', async (_req, res) => {
  res.json(await listKnownLineUsers());
});

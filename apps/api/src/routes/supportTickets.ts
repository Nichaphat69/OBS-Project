import { Router } from 'express';
import { requireAuth } from '../lib/requireAuth.js';
import { requireSuperAdmin } from '../lib/requireRole.js';
import { listSupportTickets, resolveSupportTicket, SupportTicketError } from '../lib/supportTicketsService.js';

export const supportTicketsRouter = Router();

// จำกัดเหลือ admin เท่านั้น (commit 9bd675c "จำกัดเมนู 'แจ้งปัญหา' ให้เห็นได้เฉพาะ role admin" —
// เดิม accounting เห็นด้วย เปลี่ยนใจให้ admin ดูแลเรื่องนี้คนเดียวพอ)
supportTicketsRouter.use(requireAuth, requireSuperAdmin);

supportTicketsRouter.get('/', async (req, res) => {
  const status = typeof req.query.status === 'string' ? req.query.status : undefined;
  res.json(await listSupportTickets({ status }));
});

supportTicketsRouter.post('/:id/resolve', async (req, res) => {
  try {
    res.json(await resolveSupportTicket(Number(req.params.id), { actor: req.user!.nameTh }));
  } catch (error) {
    if (error instanceof SupportTicketError) return res.status(error.status).json({ error: error.message });
    throw error;
  }
});

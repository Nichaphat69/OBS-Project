import { Router } from 'express';
import { requireAuth } from '../lib/requireAuth.js';
import { onChange } from '../lib/events.js';

export const streamRouter = Router();
streamRouter.use(requireAuth);

/** ported from server.js's openStream()/broadcast() — EventSource ที่หน้าเว็บฟังไว้ให้ตัวเอง
 * รีเฟรชทันทีที่ข้อมูลเปลี่ยน (ดู events.ts's emitChange() ที่ logAudit() เรียกทุกครั้งที่มีการเขียน) */
streamRouter.get('/', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-store, must-revalidate',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write('retry: 3000\n\n');

  const unsubscribe = onChange((reason) => {
    try {
      res.write(`event: change\ndata: ${JSON.stringify({ reason })}\n\n`);
    } catch {
      /* ปลายสายตายแล้ว — เดี๋ยว req 'close' จะเลิกฟังเอง */
    }
  });

  const heartbeat = setInterval(() => {
    try {
      res.write(': beat\n\n');
    } catch {
      /* เงียบไว้ */
    }
  }, 25_000);
  heartbeat.unref();

  req.on('close', () => {
    clearInterval(heartbeat);
    unsubscribe();
  });
});

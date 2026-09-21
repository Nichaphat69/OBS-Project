import { Router } from 'express';
import express from 'express';
import { processLineWebhook, LineWebhookError } from '../lib/lineWebhookService.js';
import { logExposedRequest } from '../lib/apiActivityLog.js';

export const lineWebhookRouter = Router();

// LINE ต้องได้ raw body ที่ยังไม่ผ่าน JSON.parse เพื่อตรวจลายเซ็น HMAC ได้ตรง — ต้อง mount ก่อน
// app.use(express.json()) ตัวหลักใน server.ts (ดูคอมเมนต์ที่นั่น) ไม่มี requireAuth เพราะ LINE
// มีการตรวจลายเซ็นของตัวเองอยู่แล้ว (เทียบเท่า auth ในตัว) — ตรงกับ PUBLIC_API_PATTERNS ของต้นฉบับ
lineWebhookRouter.post('/webhook', express.raw({ type: '*/*', limit: '2mb' }), logExposedRequest('line-webhook'), async (req, res) => {
  try {
    const result = await processLineWebhook(req.body, req.headers['x-line-signature'] as string | undefined);
    res.json(result);
  } catch (error) {
    if (error instanceof LineWebhookError) return res.status(error.status).json({ error: error.message });
    throw error;
  }
});

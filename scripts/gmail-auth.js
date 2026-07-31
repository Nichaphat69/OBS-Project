/**
 * ขอสิทธิ์เข้าถึง Gmail ครั้งเดียว แล้วได้ refresh token มาใส่ .env
 *
 * รัน:  npm run gmail:auth
 *
 * ตัวสคริปต์เปิดเซิร์ฟเวอร์เล็กๆ ที่ 127.0.0.1:4399 รอรับ code จาก Google
 * ผู้ใช้เป็นคนกดยินยอมในหน้าจอของ Google เอง — สคริปต์ไม่แตะรหัสผ่านใคร
 *
 * ต้องมี GMAIL_CLIENT_ID / GMAIL_CLIENT_SECRET ใน .env ก่อน
 * (ได้จาก Google Cloud Console → APIs & Services → Credentials → OAuth client ID
 *  ชนิด "Desktop app" หรือ "Web application" ที่ใส่ redirect URI ตรงกับด้านล่าง)
 */

import '../src/env.js';
import { createServer } from 'node:http';
import { SCOPES } from '../src/integrations/gmail.js';

const PORT = 4399;
const REDIRECT_URI = `http://localhost:${PORT}/oauth/callback`;

const CLIENT_ID = process.env.GMAIL_CLIENT_ID;
const CLIENT_SECRET = process.env.GMAIL_CLIENT_SECRET;

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error(`
ยังไม่มี GMAIL_CLIENT_ID / GMAIL_CLIENT_SECRET ในไฟล์ .env

วิธีเอามา (ทำครั้งเดียว ใช้บัญชี Google ของคุณเองก็ได้)
  1. เปิด https://console.cloud.google.com/  แล้วสร้างโปรเจกต์ใหม่ (ตั้งชื่ออะไรก็ได้)
  2. APIs & Services → Library → ค้น "Gmail API" → กด Enable
  3. APIs & Services → OAuth consent screen
       User type: External · กรอกชื่อแอปกับอีเมลติดต่อ
       Audience → Test users → เพิ่มอีเมลของคุณเข้าไปด้วย (ไม่งั้นจะโดนบล็อกตอนยินยอม)
  4. APIs & Services → Credentials → Create credentials → OAuth client ID
       Application type: Web application
       Authorized redirect URIs: ${REDIRECT_URI}
  5. ก๊อป Client ID กับ Client secret มาใส่ในไฟล์ .env

      GMAIL_CLIENT_ID=xxxxx.apps.googleusercontent.com
      GMAIL_CLIENT_SECRET=xxxxx

  6. รัน npm run gmail:auth อีกครั้ง
`);
  process.exit(1);
}

const authUrl = 'https://accounts.google.com/o/oauth2/v2/auth?' + new URLSearchParams({
  client_id: CLIENT_ID,
  redirect_uri: REDIRECT_URI,
  response_type: 'code',
  scope: SCOPES.join(' '),
  access_type: 'offline',      // ต้องมี ไม่งั้นไม่ได้ refresh token
  prompt: 'consent',           // บังคับให้ออก refresh token ใหม่ทุกครั้งที่รันสคริปต์นี้
});

console.log(`
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
เปิดลิงก์นี้ในเบราว์เซอร์ แล้วเข้าสู่ระบบด้วยบัญชีที่จะใช้รับ-ส่งเมลวางบิล

${authUrl}

สิทธิ์ที่ขอ
  · อ่านอีเมลและไฟล์แนบ   (ดึง Timesheet ที่ลูกค้าอนุมัติเข้าระบบ)
  · สร้างร่างอีเมล        (วางร่างวางบิลไว้ในกล่อง Drafts)

ระบบนี้ไม่มีโค้ดส่งอีเมลเลย — ร่างที่สร้างไว้คุณเป็นคนกดส่งเองจาก Gmail

ถ้าเจอหน้า "Google hasn't verified this app" ให้กด Advanced → Go to ... (unsafe)
เป็นเรื่องปกติของแอปที่ยังไม่ได้ส่งให้ Google ตรวจ และคุณเป็นเจ้าของแอปนั้นเอง
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

กำลังรอที่ ${REDIRECT_URI} … (กด Ctrl+C เพื่อยกเลิก)
`);

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  if (url.pathname !== '/oauth/callback') {
    res.writeHead(404).end();
    return;
  }

  const error = url.searchParams.get('error');
  const code = url.searchParams.get('code');

  const reply = (title, detail) => {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(`<!doctype html><meta charset="utf-8">
      <body style="font-family:system-ui,sans-serif;padding:60px;line-height:1.7">
      <h2>${title}</h2><p>${detail}</p></body>`);
  };

  if (error || !code) {
    reply('เชื่อมต่อไม่สำเร็จ', `Google ตอบกลับมาว่า: ${error ?? 'ไม่มี code'}`);
    console.error(`\nไม่สำเร็จ — ${error ?? 'ไม่ได้รับ code จาก Google'}`);
    server.close(() => process.exit(1));
    return;
  }

  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      redirect_uri: REDIRECT_URI,
      grant_type: 'authorization_code',
    }).toString(),
  });

  const body = await response.json().catch(() => null);

  if (!response.ok || !body?.refresh_token) {
    reply('แลก token ไม่สำเร็จ', 'ดูรายละเอียดในหน้าต่าง terminal');
    console.error('\nแลก token ไม่สำเร็จ:', JSON.stringify(body, null, 2));
    server.close(() => process.exit(1));
    return;
  }

  // ถามชื่ออีเมลที่เพิ่งต่อ เพื่อยืนยันว่าต่อถูกบัญชี
  let who = '';
  try {
    const profile = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/profile', {
      headers: { Authorization: `Bearer ${body.access_token}` },
    }).then((r) => r.json());
    who = profile.emailAddress ?? '';
  } catch { /* ไม่ได้ก็ไม่เป็นไร ไม่ใช่สาระสำคัญ */ }

  reply('เชื่อมต่อสำเร็จ', `บัญชี ${who || '(ไม่ทราบ)'} — กลับไปที่หน้าต่าง terminal เพื่อคัดลอกค่าลง .env`);

  console.log(`
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
เชื่อมต่อสำเร็จ — บัญชี ${who || '(ไม่ทราบ)'}

เอาบรรทัดนี้ไปใส่ท้ายไฟล์ .env แล้วรันเซิร์ฟเวอร์ใหม่

GMAIL_REFRESH_TOKEN=${body.refresh_token}

⚠️ ค่านี้เท่ากับกุญแจกล่องเมล — อย่าเอาขึ้น git และอย่าส่งให้ใครทางแชท
   (ไฟล์ .env ถูก .gitignore ไว้แล้ว)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`);

  server.close(() => process.exit(0));
});

server.listen(PORT);

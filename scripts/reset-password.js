/**
 * ตั้งรหัสผ่านใหม่ให้ผู้ใช้ที่มีอยู่แล้ว — ใช้ตอนลืมรหัสผ่านเดิม
 *
 * รันแบบถามทีละคำ (เหมาะตอนนั่งอยู่หน้า terminal เอง):
 *   npm run user:reset-password
 *
 * รันแบบระบุค่าตรงในคำสั่งเดียว:
 *   npm run user:reset-password -- <username> "<รหัสผ่านใหม่>"
 *
 * เซสชันที่ล็อกอินไว้ก่อนหน้าของบัญชีนี้จะถูกเลิกทั้งหมด ต้อง login ใหม่ด้วยรหัสใหม่
 * ⚠️ โหมดถามทีละคำ รหัสผ่านจะโชว์บนจอตอนพิมพ์ (terminal ธรรมดาไม่ได้ซ่อนให้) — อย่าพิมพ์ต่อหน้าคนอื่น
 */

import '../src/env.js';
import { createInterface } from 'node:readline';
import { resetPassword } from '../src/auth.js';
import { closeDb } from '../src/db/index.js';

const [argUsername, argPassword] = process.argv.slice(2);

let username = argUsername;
let password = argPassword;

if (!username || !password) {
  console.log('── ตั้งรหัสผ่านใหม่ให้ผู้ใช้เข้าเว็บ OBS ──\n');
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const ask = (q) => new Promise((resolve) => rl.question(q, resolve));

  username = (await ask('Username ของบัญชีที่จะตั้งรหัสผ่านใหม่: ')).trim();
  password = (await ask('รหัสผ่านใหม่ (อย่างน้อย 8 ตัวอักษร — จะโชว์บนจอ อย่าพิมพ์ต่อหน้าคนอื่น): ')).trim();
  rl.close();
}

try {
  const user = resetPassword(username, password, { actor: 'cli' });
  console.log(`\nตั้งรหัสผ่านใหม่ให้ "${user.username}" (${user.nameTh}) เรียบร้อย — login ด้วยรหัสใหม่ได้เลย`);
} catch (error) {
  console.error(`\n${error.message}`);
  process.exitCode = 1;
} finally {
  closeDb();
}

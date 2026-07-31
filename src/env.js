/**
 * โหลดไฟล์ .env เข้า process.env
 *
 * Node ไม่โหลดให้เอง ต้องสั่ง `--env-file` ตอนรัน ซึ่งพังถ้ายังไม่มีไฟล์ .env
 * (และ `--env-file-if-exists` มีเฉพาะ Node ใหม่ๆ) — เขียนเองสิบกว่าบรรทัดจบ
 * และไม่ต้องเพิ่ม dependency ตามหลักของโปรเจกต์นี้
 *
 * ต้อง import ไฟล์นี้เป็นบรรทัดแรกของทุก entry point ที่ต้องใช้ค่าจาก .env
 * (server.js · seed.js · scripts/*) ไม่งั้นโมดูลอื่นจะอ่าน process.env ตอนที่ยังว่างอยู่
 *
 * ค่าที่ตั้งมาจาก shell อยู่แล้วมีสิทธิ์เหนือกว่าไฟล์ .env เสมอ
 * เพื่อให้สั่ง `FLOWACCOUNT_MODE=sandbox npm start` ทับได้โดยไม่ต้องแก้ไฟล์
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

export function loadEnv(path = join(ROOT, '.env')) {
  let text;
  try {
    text = readFileSync(path, 'utf8');
  } catch {
    return { loaded: false, keys: [] };
  }

  const keys = [];
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;

    const eq = line.indexOf('=');
    if (eq < 1) continue;

    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();

    // รองรับค่าที่ครอบด้วยเครื่องหมายคำพูด — client secret มักมีอักขระแปลกๆ
    if ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }

    if (process.env[key] === undefined) {
      process.env[key] = value;
      keys.push(key);
    }
  }
  return { loaded: true, keys };
}

loadEnv();

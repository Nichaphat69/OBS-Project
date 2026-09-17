/**
 * ผังฟิลด์ default ของตัวอ่านแต่ละเจ้า ต้องอ้างคีย์ที่มีอยู่จริงในสารบัญกลาง
 *
 * ทำไมต้องมีเทสนี้: ผังพวกนั้นเป็น `Record<string, string>` ธรรมดา TypeScript จึงไม่รู้ว่าคีย์ผิด
 * พอสารบัญกลางเปลี่ยนชื่อคีย์ (เช่นตอนขยับเป็น Master Template V4 ซึ่งแยก Total_Hours เป็น
 * Daily_Total_Hours/Monthly_Total_Hours และ Site เป็น Document_Site/Daily_Site) ผังที่ยังอ้างชื่อเดิม
 * จะ**คอมไพล์ผ่าน เทสเดิมก็ยังเขียว แต่ฟิลด์นั้นเลิกถูกอ่านไปเงียบๆ** — เจอจริงตอนขยับเป็น V4:
 * DEFAULT_HEADER_MAP มีคีย์ค้าง 2 ตัว (approverName, totalHours) ที่ไม่ตรงกับสารบัญแล้ว
 *
 * ค่าฝั่งขวาของผัง (ชื่อฟิลด์จริงใน Skill ของ ABBYY) ไม่เกี่ยวกับสารบัญ เทสนี้ตรวจแค่ฝั่งคีย์
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { headerField, detailField } from '@obs/domain';

const SRC = fileURLToPath(new URL('../src/lib/abbyyClient.ts', import.meta.url));

/** ดึงคีย์ออกจาก object literal ที่ประกาศชื่อ `marker` — อ่านจากซอร์สเพราะผังพวกนี้ไม่ได้ export */
function mapKeys(source: string, marker: string): string[] {
  const start = source.indexOf(`const ${marker}`);
  assert.notEqual(start, -1, `หาผัง ${marker} ไม่เจอ — ถ้าเปลี่ยนชื่อ/ย้ายไฟล์ ต้องแก้เทสนี้ด้วย`);
  const open = source.indexOf('{', start);
  const close = source.indexOf('};', open);
  return [...source.slice(open, close).matchAll(/^\s{2}([a-zA-Z][a-zA-Z0-9]*)\s*:/gm)].map((m) => m[1]);
}

const source = readFileSync(SRC, 'utf8');

test('DEFAULT_HEADER_MAP ของ ABBYY อ้างคีย์ระดับเอกสารที่มีอยู่จริงทุกตัว', () => {
  const keys = mapKeys(source, 'DEFAULT_HEADER_MAP');
  assert.ok(keys.length >= 8, `อ่านคีย์ได้แค่ ${keys.length} ตัว — น้อยผิดปกติ regex อาจพัง`);
  const missing = keys.filter((k) => !headerField(k));
  assert.deepEqual(missing, [], `คีย์ที่ไม่มีในสารบัญกลาง: ${missing.join(', ')}`);
});

test('DEFAULT_DETAIL_MAP ของ ABBYY อ้างคีย์ระดับแถวที่มีอยู่จริงทุกตัว', () => {
  const keys = mapKeys(source, 'DEFAULT_DETAIL_MAP');
  assert.ok(keys.length >= 5, `อ่านคีย์ได้แค่ ${keys.length} ตัว — น้อยผิดปกติ regex อาจพัง`);
  const missing = keys.filter((k) => !detailField(k));
  assert.deepEqual(missing, [], `คีย์ที่ไม่มีในสารบัญกลาง: ${missing.join(', ')}`);
});

test('ชื่อที่ V4 สั่งห้าม ต้องไม่ถูกใช้เป็นคีย์ในผัง default อีก', () => {
  // สองตัวนี้คือคีย์ที่เคยกำกวมจริงเพราะใช้ซ้ำสองระดับ — ถ้ากลับมาแปลว่ามีคนย้อนการแยกของ V4
  const headerKeys = mapKeys(source, 'DEFAULT_HEADER_MAP');
  const detailKeys = mapKeys(source, 'DEFAULT_DETAIL_MAP');
  for (const stale of ['totalHours', 'site', 'approverName']) {
    assert.ok(!headerKeys.includes(stale), `DEFAULT_HEADER_MAP ยังใช้คีย์เก่า "${stale}"`);
    assert.ok(!detailKeys.includes(stale), `DEFAULT_DETAIL_MAP ยังใช้คีย์เก่า "${stale}"`);
  }
});

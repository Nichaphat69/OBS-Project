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
 *
 * ⚠️ **เทสนี้เขียวไม่ได้แปลว่าปลอดภัย** — มันเห็นแค่ผัง default ที่อยู่ในซอร์ส ไม่เห็นผังที่ผู้ใช้
 * บันทึกไว้ต่อ Skill ในฐานข้อมูล ซึ่งเป็นที่ที่ค่าเฉพาะตัวจริงๆ อยู่ (เจอจริงตอนขยับ V4: Big-C เก็บ
 * `'Approver '` มีเว้นวรรคท้าย, Lotus เก็บ `'Appover'` ที่ ABBYY สะกดผิด) แถวพวกนั้นยังเป็นคีย์เก่า
 * ทั้งหมดหลังเปลี่ยนชื่อ และจะตกไปใช้ค่า default เงียบๆ — สังเกตว่า Skill ที่ "รอด" คือตัวที่ค่าบังเอิญ
 * ตรงกับ default ส่วนตัวที่พังคือตัวที่มีค่าเฉพาะตัว ซึ่งเป็นเคสที่ฟีเจอร์ตั้งค่าต่อ Skill มีไว้รองรับ
 * ตั้งแต่แรก
 *
 * **เปลี่ยนชื่อคีย์เมื่อไหร่ ต้องนับแถวในฐานข้อมูลเป็นครึ่งหนึ่งของงานเสมอ** ไม่ใช่แค่แก้โค้ดให้เทสเขียว
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { headerField, detailField } from '@obs/domain';
import { mapAbbyyResult } from '../src/lib/abbyyClient.js';

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

/** ผลลัพธ์ปลอมรูปเดียวกับที่ ABBYY คืนมาจริง — รูปเดียวกับที่ abbyyClient.test.ts ใช้ */
function docFields(fields: Array<{ Name: string; Value: unknown }>) {
  return {
    Transaction: { Documents: [{ ExtractedData: { RootObject: {
      Fields: fields.map((f) => ({ Name: f.Name, List: [{ Value: f.Value }] })),
    } } }] },
  };
}

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

/* ── ช่องผู้ให้บริการ: ตัวอ่านคืนคนละชื่อกัน ingest ต้องรับได้ทั้งคู่ ───────────────────────
   เคสจริง: ABBYY/โมเดลในเครื่อง/ป้อนด้วยมือ คืน `vendor` ส่วน Clear Read คืน `vendorName`
   ตอนเพิ่มฟิลด์นี้รับไว้ชื่อเดียว ทำให้ timesheets.vendor_name ว่างทุกแถวโดยไม่มีใครรู้ */

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

test('ingestService รับช่องผู้ให้บริการทั้งสองชื่อที่ตัวอ่านใช้กันอยู่', () => {
  // เทสนี้ตรวจ "ปลายทางรับได้ครบ" ไม่ได้ตรวจว่าตัวอ่านแต่ละเจ้าใช้ชื่อไหน — การแยกสองอย่างนั้น
  // ด้วยการอ่านซอร์สเปราะเกินไป (abbyyClient มีคำว่า vendorName อยู่ทั้งในผังตั้งค่าและในผลลัพธ์
  // คนละความหมายกัน) ปลายทางที่รับทั้งคู่คือสิ่งที่กันไม่ให้ค่าหายจริงๆ
  const write = read('../src/lib/ingestService.ts').match(/vendorName:\s*([^,\n]+),/);
  assert.ok(write, 'หาบรรทัดที่เขียน vendorName ลงฐานข้อมูลไม่เจอ — ถ้าย้ายที่ ต้องแก้เทสนี้ด้วย');

  const accepted = new Set([...write![1].matchAll(/data\.(vendor(?:Name)?)\b/g)].map((m) => m[1]));
  for (const key of ['vendor', 'vendorName']) {
    assert.ok(
      accepted.has(key),
      `ingestService ไม่ได้อ่าน data.${key} — ตัวอ่านที่คืนช่องนี้เป็น "${key}" จะเขียนค่าลงไม่ได้และหายเงียบๆ `
      + `(เคยเกิดมาแล้ว: timesheets.vendor_name ว่างทุกแถวเพราะรับไว้ชื่อเดียว)`,
    );
  }
});

/* ── ชั่วโมงที่คำนวณจากเวลาเข้า-ออก ต้องหักเวลาพักที่เอกสารเขียนไว้ ──────────────────────
   เดิมอ่านช่องพักมาเก็บแต่ไม่เคยใช้ตอนคำนวณ ทำให้ฟอร์มที่เขียนพักไว้ถูกนับชั่วโมงเกินจริง
   สำคัญที่สุดกับ OT เพราะชั่วโมง OT คูณเป็นเงินตรงๆ (ชั่วโมง ÷ 8 × เรทต่อวัน) */

test('ชั่วโมงที่คำนวณจากเวลาเข้า-ออก หักเวลาพักที่เอกสารเขียนไว้ ทั้งงานปกติและ OT', () => {
  // เข้า 08:00 ออก 18:00 = 10 ชม. พัก 1 → 9 · OT 19:00-22:00 = 3 ชม. พัก OT 0.5 → 2.5
  const data = mapAbbyyResult(docFields([
    { Name: 'Month Year', Value: 'May 2026' },
    { Name: 'ตาราง', Value: { Fields: [
      { Name: 'วันที่', List: [{ Value: '06/05/26' }] },
      { Name: 'เข้า', List: [{ Value: '08:00' }] },
      { Name: 'ออก', List: [{ Value: '18:00' }] },
      { Name: 'พัก', List: [{ Value: '1' }] },
      { Name: 'OT เข้า', List: [{ Value: '19:00' }] },
      { Name: 'OT ออก', List: [{ Value: '22:00' }] },
      { Name: 'พัก OT', List: [{ Value: '0.5' }] },
    ] } },
  ]), {
    tableName: 'ตาราง',
    detail: {
      date: 'วันที่', timeIn: 'เข้า', timeOut: 'ออก', breakHours: 'พัก',
      otTimeIn: 'OT เข้า', otTimeOut: 'OT ออก', otBreakHours: 'พัก OT',
    },
  });

  const d = data.days[0];
  assert.equal(d.normalHours, 9, '10 ชม. หักพัก 1 = 9 (เดิมได้ 10 เพราะไม่เคยหักพัก)');
  assert.equal(d.otHours, 2.5, '3 ชม. หักพัก OT 0.5 = 2.5 — ตัวนี้คูณเป็นเงินตรงๆ');
  // ⚠️ ความไม่ตรงกันที่มีอยู่จริงในระบบ ไม่ใช่เทสเขียนผิด — บันทึกไว้ให้เห็นชัดจนกว่าเจ้าของระบบจะตัดสิน
  //
  // `days[].otHours` (ตัวที่โชว์บนหน้าจอ) = คอลัมน์ ?? คำนวณจากเวลา OT เข้า-ออก
  // `otDays`        (ตัวที่กลายเป็นเงิน)  = คอลัมน์ **อย่างเดียว** ไม่มี fallback
  //
  // ผลคือฟอร์มที่เขียนเวลา OT เข้า-ออกไว้แต่ไม่มีคอลัมน์ชั่วโมง OT (เจอจริง: _T8 Chakrit)
  // จะ **โชว์ OT บนหน้าตรวจ Manday แต่ไม่มีบรรทัด OT ในใบแจ้งหนี้เลย** — เก็บเงินขาด ไม่ใช่เกิน
  // และคนตรวจเห็นตัวเลขไม่ตรงกันสองหน้าจอโดยไม่มีอะไรอธิบาย
  //
  // แก้ให้ตรงกันได้ทางเดียวคือเพิ่ม/ลดเงิน ซึ่งเป็นการตัดสินใจของเจ้าของระบบ ไม่ใช่ของโค้ด
  assert.equal(data.days[0].otHours, 2.5, 'หน้าจอเห็น OT ที่คำนวณแล้ว');
  assert.deepEqual(data.otDays, [], 'แต่ยอดที่ไปคิดเงินยังว่าง เพราะอ่านจากคอลัมน์อย่างเดียว');
});

test('เอกสารเขียนชั่วโมงมาเองชนะการคำนวณเสมอ — ไม่ไปหักพักซ้ำจากค่าที่เขาให้มาแล้ว', () => {
  const data = mapAbbyyResult(docFields([
    { Name: 'Month Year', Value: 'May 2026' },
    { Name: 'ตาราง', Value: { Fields: [
      { Name: 'วันที่', List: [{ Value: '06/05/26' }] },
      { Name: 'เข้า', List: [{ Value: '08:00' }] },
      { Name: 'ออก', List: [{ Value: '18:00' }] },
      { Name: 'พัก', List: [{ Value: '1' }] },
      { Name: 'ชม.ปกติ', List: [{ Value: '8' }] },
    ] } },
  ]), {
    tableName: 'ตาราง',
    detail: { date: 'วันที่', timeIn: 'เข้า', timeOut: 'ออก', breakHours: 'พัก', normalHours: 'ชม.ปกติ' },
  });
  assert.equal(data.days[0].normalHours, 8, 'ต้องได้ 8 ตามที่เอกสารเขียน ไม่ใช่ 9 จากการคำนวณ');
});

test('เวลาพักที่เขียนไว้มากกว่าช่วงเวลาทำงาน (พิมพ์ผิด) ต้องได้ 0 ไม่ใช่ค่าติดลบ', () => {
  const data = mapAbbyyResult(docFields([
    { Name: 'Month Year', Value: 'May 2026' },
    { Name: 'ตาราง', Value: { Fields: [
      { Name: 'วันที่', List: [{ Value: '06/05/26' }] },
      { Name: 'เข้า', List: [{ Value: '09:00' }] },
      { Name: 'ออก', List: [{ Value: '11:00' }] },
      { Name: 'พัก', List: [{ Value: '5' }] },
    ] } },
  ]), { tableName: 'ตาราง', detail: { date: 'วันที่', timeIn: 'เข้า', timeOut: 'ออก', breakHours: 'พัก' } });
  assert.equal(data.days[0].normalHours, 0);
});

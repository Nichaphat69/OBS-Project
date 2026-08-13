import { DatabaseSync } from 'node:sqlite';
import { readFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { emitChange } from '../events.js';

const here = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(here, '..', '..');

export const DB_PATH =
  process.env.DB_PATH ?? join(projectRoot, 'data', 'billing.sqlite');

let db;

export function getDb() {
  if (db) return db;

  mkdirSync(dirname(DB_PATH), { recursive: true });
  db = new DatabaseSync(DB_PATH);
  db.exec(readFileSync(join(here, 'schema.sql'), 'utf8'));
  addMissingColumns(db);
  return db;
}

/**
 * เติมคอลัมน์ที่เพิ่มเข้ามาทีหลังให้ฐานข้อมูลที่มีอยู่แล้ว
 *
 * `CREATE TABLE IF NOT EXISTS` ใน schema.sql ไม่แตะตารางที่มีอยู่แล้ว
 * ถ้าไม่มีขั้นนี้ ใครที่มีไฟล์ฐานข้อมูลเดิมจะเจอ error ว่าไม่มีคอลัมน์
 * เพิ่มคอลัมน์เท่านั้น ไม่ลบ ไม่เปลี่ยนชนิด จึงปลอดภัยกับข้อมูลที่มีอยู่
 */
const ADDED_COLUMNS = [
  ['invoices', 'email_sent_at', 'TEXT'],
  ['invoices', 'email_sent_by', 'TEXT'],
  ['users', 'role', "TEXT NOT NULL DEFAULT 'user'"],
  ['invoices', 'share_link', 'TEXT'],
  ['users', 'active', 'INTEGER NOT NULL DEFAULT 1'],
  ['timesheets', 'source_file_bytes', 'BLOB'],
  ['ai_reads', 'file_bytes', 'BLOB'],
  ['invoices', 'document_pdf', 'BLOB'],
  ['invoices', 'gmail_draft_id', 'TEXT'],
  ['invoices', 'gmail_thread_id', 'TEXT'],
  // รหัสพนักงานฝั่ง HRDD (WorkDD) — ใช้จับคู่ตอนเทียบวันลากับ HRDD เท่านั้น ไม่เกี่ยวกับรหัส EMP-xxxx ของ OBS เอง
  ['employees', 'hrdd_employee_code', 'TEXT'],
  // contactId ฝั่ง FlowAccount ของลูกค้า — ดูคอมเมนต์ที่ schema.sql กัน contact ซ้ำทุกเดือน
  ['customers', 'flowaccount_contact_id', 'TEXT'],
];

function addMissingColumns(database) {
  for (const [table, column, type] of ADDED_COLUMNS) {
    const has = database
      .prepare(`SELECT 1 FROM pragma_table_info($t) WHERE name = $c`)
      .get({ t: table, c: column });
    if (!has) database.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
  }
}

export function closeDb() {
  if (db) {
    db.close();
    db = undefined;
  }
}

/** คืนค่าเป็น array ของ object */
export function all(sql, params = {}) {
  return getDb().prepare(sql).all(params);
}

export function get(sql, params = {}) {
  return getDb().prepare(sql).get(params) ?? null;
}

export function run(sql, params = {}) {
  return getDb().prepare(sql).run(params);
}

export function tx(fn) {
  const database = getDb();
  database.exec('BEGIN');
  try {
    const result = fn(database);
    database.exec('COMMIT');
    return result;
  } catch (error) {
    database.exec('ROLLBACK');
    throw error;
  }
}

export function logAudit({ actor, action, entityType = null, entityId = null, detail = null }) {
  run(
    `INSERT INTO audit_log (actor, action, entity_type, entity_id, detail)
     VALUES ($actor, $action, $entityType, $entityId, $detail)`,
    {
      actor,
      action,
      entityType,
      entityId,
      detail: detail === null ? null : JSON.stringify(detail),
    },
  );
  // ทุกการเปลี่ยนแปลงที่มีความหมายต้องผ่านที่นี่ จึงเป็นจุดเดียวที่ประกาศข่าวได้ครบ
  emitChange(action);
}

export function getSetting(key, fallback = null) {
  const row = get('SELECT value FROM settings WHERE key = $key', { key });
  if (!row) return fallback;
  try {
    return JSON.parse(row.value);
  } catch {
    return row.value;
  }
}

export function setSetting(key, value) {
  run(
    `INSERT INTO settings (key, value) VALUES ($key, $value)
     ON CONFLICT(key) DO UPDATE SET value = $value`,
    { key, value: JSON.stringify(value) },
  );
}

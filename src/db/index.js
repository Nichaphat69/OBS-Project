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
  seedKnownAbbyySkills(db);
  return db;
}

/** ใส่ Skill ABBYY 2 ตัวที่ใช้งานจริงอยู่แล้วให้สารบัญตั้งแต่แรก (31 ส.ค. 69) กัน admin ต้องพิมพ์
 * GUID เองใหม่ทั้งที่บอกไว้แล้วว่าใช้ตัวไหนอยู่ — INSERT OR IGNORE ตาม skill_id ที่ unique เท่านั้น
 * ไม่ทับชื่อถ้า admin เคยแก้ชื่อเองไปแล้ว และไม่เพิ่มซ้ำถ้ามีอยู่แล้ว */
const KNOWN_ABBYY_SKILLS = [
  { name: 'OBS Timesheet2', skillId: '89aa1af3-1e04-4477-9b91-00023980402c' },
  { name: 'OBS Timesheet-iPassion', skillId: 'd9901633-4947-40b2-846f-31a423555bfc' },
];

function seedKnownAbbyySkills(database) {
  const insert = database.prepare(
    'INSERT OR IGNORE INTO abbyy_skills (id, name, skill_id) VALUES ($id, $name, $skillId)',
  );
  for (const skill of KNOWN_ABBYY_SKILLS) {
    const id = `SKL-${skill.skillId.slice(0, 8)}`;
    insert.run({ id, name: skill.name, skillId: skill.skillId });
  }
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
  // หัวข้ออีเมลต้นทาง — source_email_id เดิมเก็บแค่ message id (อ่านไม่รู้เรื่อง) หน้า "ที่มาของข้อมูล"
  // จะได้โชว์ชื่ออีเมลจริงแทนรหัสดิบได้ ใบเก่าก่อนมีคอลัมน์นี้จะเป็น NULL (ไม่มีให้ย้อนไปหา ไม่ใช่บั๊ก)
  ['timesheets', 'source_email_subject', 'TEXT'],
  // ตารางรายละเอียดรายวันเต็มรูปแบบตามคอลัมน์ของ ABBYY "New Table" (27 ส.ค. 69 ตามที่ขอ) —
  // ใบเก่าก่อนมีคอลัมน์พวกนี้จะเป็น NULL หมด (ไม่มีข้อมูลย้อนหลังให้เติม ไม่ใช่บั๊ก)
  ['timesheet_days', 'day_of_week', 'TEXT'],
  ['timesheet_days', 'project', 'TEXT'],
  ['timesheet_days', 'ot_time_in', 'TEXT'],
  ['timesheet_days', 'ot_time_out', 'TEXT'],
  ['timesheet_days', 'type', 'TEXT'],
  ['timesheet_days', 'normal_hours', 'REAL'],
  ['timesheet_days', 'ot_hours', 'REAL'],
  ['timesheet_days', 'total_hours', 'REAL'],
  // Skill ID ของ ABBYY เฉพาะสัญญานี้ — ดูคอมเมนต์ที่ schema.sql (28 ส.ค. 69)
  ['contracts', 'abbyy_skill_id', 'TEXT'],
  // ผูกบัญชี login (role 'user' = พนักงาน) กับพนักงานในตาราง employees (31 ส.ค. 69 ตามที่ขอ) —
  // ใช้กรองหน้า "ความคืบหน้าของฉัน" ให้เห็นแค่รอบบิลของตัวเอง บัญชี admin/accounting/executive ไม่ต้องผูก
  ['users', 'employee_id', 'TEXT'],
  // ลงทะเบียนเอง + ลืมรหัสผ่านทางอีเมล + เข้าสู่ระบบด้วย Google (31 ส.ค. 69 ตามที่ขอ) —
  // email ใช้ค้นหาบัญชีตอนลืมรหัสผ่าน (บัญชีเก่าที่ username เป็นอีเมลอยู่แล้วจะ match ผ่าน
  // username แทนได้ ดู findUserByLoginEmail ใน src/auth.js ไม่ต้อง backfill คอลัมน์นี้ย้อนหลัง)
  ['users', 'email', 'TEXT'],
  // สมัครเองผ่านหน้า "ลงทะเบียน"/Google (ไม่ใช่ admin สร้างให้) — บัญชีเริ่มที่ active=0 เสมอ
  // รอ admin กดเปิดใช้งานที่หน้า "จัดการระบบ → ผู้ใช้" ก่อนถึง login ได้จริง
  ['users', 'self_registered', 'INTEGER NOT NULL DEFAULT 0'],
  // sub ของบัญชี Google ที่ผูกไว้ (nullable — ผูกได้ก็ต่อเมื่อเคย "เข้าสู่ระบบด้วย Google" อย่างน้อยครั้งนึง)
  ['users', 'google_sub', 'TEXT'],
  // รหัสยืนยัน 6 หลักตอนลืมรหัสผ่าน — เก็บแค่ hash เหมือนรหัสผ่านจริง ไม่เก็บตัวเลขดิบ
  ['users', 'reset_code_hash', 'TEXT'],
  ['users', 'reset_code_salt', 'TEXT'],
  ['users', 'reset_code_expires_at', 'TEXT'],
  ['users', 'reset_code_attempts', 'INTEGER NOT NULL DEFAULT 0'],
  // token ชั่วคราวหลังยืนยันรหัส 6 หลักผ่านแล้ว ใช้ตอนกดตั้งรหัสผ่านใหม่จริง (คนละค่ากับรหัส 6 หลัก
  // กันคนที่ดักเห็นรหัสระหว่างทางเอาไปตั้งรหัสผ่านใหม่เองโดยไม่ผ่านหน้ากรอกรหัส)
  ['users', 'reset_token_hash', 'TEXT'],
  ['users', 'reset_token_salt', 'TEXT'],
  ['users', 'reset_token_expires_at', 'TEXT'],
  // ช่องทางที่ Timesheet ใบนี้เข้าระบบมา — 'self_obs' (พนักงานอัปโหลดเองผ่าน OBS) / 'auto_gmail'
  // (n8n ดึงจาก Gmail อัตโนมัติ) / 'self_email' / 'proxy_email' (ฝ่ายบัญชีกรอกเองหลังได้รับทางอีเมล
  // จากพนักงานเอง/จากคนอื่นส่งแทน — เลือกตอน "กรอกเอง") null = ใบเก่าก่อนมีคอลัมน์นี้ (1 ก.ย. 69 ตามที่ขอ)
  ['timesheets', 'submission_method', 'TEXT'],
  // ผูกบัญชีไลน์ส่วนตัวของพนักงาน (role 'user') ไว้ส่งแจ้งเตือนสถานะ Timesheet ของตัวเองโดยตรง
  // (1 ก.ย. 69 ตามที่ขอ) — line_link_code/expires_at ใช้แค่ช่วงกำลังผูกบัญชี (ดู startEmployeeLineLink
  // ใน service.js) ผูกสำเร็จแล้วเคลียร์ทิ้ง เหลือแค่ line_user_id ค้างไว้ถาวร
  ['employees', 'line_user_id', 'TEXT'],
  ['employees', 'line_link_code', 'TEXT'],
  ['employees', 'line_link_code_expires_at', 'TEXT'],
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

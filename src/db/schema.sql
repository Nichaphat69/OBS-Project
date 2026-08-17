-- ฐานข้อมูลระบบวางบิล Outsource
-- ใช้ node:sqlite (มาพร้อม Node 22.5+) จึงไม่ต้องติดตั้ง native module

PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

-- ── ลูกค้า ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS customers (
  id            TEXT PRIMARY KEY,
  name_th       TEXT NOT NULL,
  name_en       TEXT,
  tax_id        TEXT NOT NULL,
  branch        TEXT DEFAULT 'สำนักงานใหญ่',
  address       TEXT,
  credit_days   INTEGER NOT NULL DEFAULT 30,
  billing_place TEXT,          -- สถานที่นำเอกสารไปวางบิล
  contact_name  TEXT,
  contact_phone TEXT,
  contact_email TEXT,
  -- contactId ฝั่ง FlowAccount ของลูกค้ารายนี้ — เก็บไว้ตั้งแต่ครั้งแรกที่วางบิลสำเร็จแล้วใช้ซ้ำ
  -- ทุกครั้งต่อไป กัน FlowAccount สร้าง contact ใหม่ซ้ำทุกเดือน (endpoint สร้างเอกสารไม่มีทาง
  -- "ใช้ contact เดิม" ได้เลยถ้าส่งชื่อ/เลขผู้เสียภาษีไปด้วย ต้องส่ง contactId เปล่าๆแทน)
  flowaccount_contact_id TEXT,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);

-- ── สัญญา / ใบว่าจ้าง ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS contracts (
  id             TEXT PRIMARY KEY,
  customer_id    TEXT NOT NULL REFERENCES customers(id),
  po_no          TEXT NOT NULL,          -- 26/B0113
  contract_no    TEXT,                   -- จซ.002/2569
  project_name   TEXT NOT NULL,
  po_date        TEXT,
  start_date     TEXT NOT NULL,
  end_date       TEXT NOT NULL,
  credit_days    INTEGER NOT NULL DEFAULT 30,
  -- ตัวหารอัตราต่อวัน: 'fixed' = เลขคงที่ตามสัญญา | 'actual_working_days'
  divisor_mode   TEXT NOT NULL DEFAULT 'fixed',
  divisor_value  INTEGER NOT NULL DEFAULT 20,
  vat_rate       REAL NOT NULL DEFAULT 0.07,
  wht_rate       REAL NOT NULL DEFAULT 0.03,
  status         TEXT NOT NULL DEFAULT 'active',
  created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);

-- ── พนักงาน Outsource ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS employees (
  id               TEXT PRIMARY KEY,     -- EMP-0042
  name_th          TEXT NOT NULL,
  name_en          TEXT,
  -- ชื่อตำแหน่งที่จะขึ้นบนใบแจ้งหนี้ (ไม่ใช้ค่าจาก Timesheet)
  invoice_position TEXT NOT NULL,
  -- รหัสพนักงานฝั่ง HRDD (WorkDD) — คนละระบบกับ id ข้างบน ใช้จับคู่ตอนเทียบวันลากับ HRDD เท่านั้น
  hrdd_employee_code TEXT,
  created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);

-- ชื่อพ้องที่ยอมรับ — แก้ปัญหาเอกสารแต่ละใบเขียนชื่อไม่เหมือนกัน
CREATE TABLE IF NOT EXISTS employee_aliases (
  employee_id TEXT NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  kind        TEXT NOT NULL,             -- 'name' | 'position'
  alias       TEXT NOT NULL,
  source      TEXT,                      -- เอกสารที่พบชื่อนี้
  PRIMARY KEY (employee_id, kind, alias)
);

-- ── การมอบหมายงานตามสัญญา (เรทต่อคนต่อสัญญา) ────────────────
CREATE TABLE IF NOT EXISTS assignments (
  id            TEXT PRIMARY KEY,
  contract_id   TEXT NOT NULL REFERENCES contracts(id),
  employee_id   TEXT NOT NULL REFERENCES employees(id),
  quotation_no  TEXT,                    -- QT2025120005
  monthly_rate  REAL NOT NULL,
  start_date    TEXT NOT NULL,
  end_date      TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'active',
  UNIQUE (contract_id, employee_id)
);

-- ── ปฏิทินวันหยุด ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS holidays (
  date        TEXT NOT NULL,
  name        TEXT NOT NULL,
  -- NULL = ใช้กับทุกลูกค้า / ระบุ = ปฏิทินเฉพาะลูกค้ารายนั้น
  customer_id TEXT REFERENCES customers(id),
  PRIMARY KEY (date, customer_id)
);

-- ── Timesheet ที่รับเข้ามา ─────────────────────────────────
CREATE TABLE IF NOT EXISTS timesheets (
  id                TEXT PRIMARY KEY,     -- 2026010091 (เลขเอกสารจากระบบลูกค้า)
  contract_id       TEXT NOT NULL REFERENCES contracts(id),
  employee_id       TEXT REFERENCES employees(id),
  period            TEXT NOT NULL,        -- 'YYYY-MM'
  source_email_id      TEXT,
  source_email_subject TEXT,
  source_file       TEXT,
  source_file_bytes BLOB,               -- ไฟล์ PDF ต้นฉบับ — เก็บไว้ให้แนบอีเมล/ดูย้อนหลังได้
  received_at       TEXT NOT NULL,
  approved_by       TEXT,                 -- ผู้อนุมัติฝั่งลูกค้า
  approved_at       TEXT,
  -- ค่าที่อ่านได้จากเอกสาร (ยังไม่ผ่านการตรวจ)
  raw_employee_name TEXT,
  raw_position      TEXT,
  reported_workdays INTEGER,
  reported_leave    INTEGER,
  extraction        TEXT,                 -- JSON ผลจาก LLM
  -- สถานะ: received → extracted → verified → mismatch → approved → billed → rejected
  status            TEXT NOT NULL DEFAULT 'received',
  status_reason     TEXT,
  computed          TEXT,                 -- JSON ผลคำนวณ Manday
  created_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  updated_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);

CREATE INDEX IF NOT EXISTS idx_timesheets_period ON timesheets(period, status);

-- ── อีเมล Gmail ที่กด "ซ่อน" ทิ้งจากรายการ (ไม่ใช่ลบอีเมลจริงใน Gmail) ──
CREATE TABLE IF NOT EXISTS gmail_dismissed (
  message_id   TEXT PRIMARY KEY,
  dismissed_by TEXT,
  dismissed_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);

-- ── ประวัติที่ AI เคยอ่านแล้ว (ทั้งอัปโหลดไฟล์เองและดึงจาก Gmail) ──
-- คนละตารางจาก timesheets เพราะฉบับที่ AI อ่านแล้วแต่ยังไม่กดยืนยันก็ต้องโชว์ในนี้ได้
-- (เป็นด่านแรกก่อนเข้าระบบวางบิลจริง — เห็นได้ว่าเคยอ่านอะไรไปแล้วบ้างก่อนตัดสินใจ)
CREATE TABLE IF NOT EXISTS ai_reads (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  source          TEXT NOT NULL,                     -- 'upload' | 'gmail'
  source_email_id TEXT,
  file_name       TEXT,
  employee_name   TEXT,
  period          TEXT,
  document_no     TEXT,
  status          TEXT NOT NULL DEFAULT 'pending',    -- pending → confirmed | discarded
  model           TEXT,
  extraction      TEXT,                               -- JSON: ผลที่ AI อ่านได้ทั้งชุด ใช้เปิดดูรายละเอียด
  file_bytes      BLOB,                                -- ไฟล์ PDF ต้นฉบับ — ให้ confirmTimesheet ส่งต่อ
                                                        -- เข้า timesheets.source_file_bytes ตอนยืนยัน
  read_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  read_by         TEXT
);

CREATE INDEX IF NOT EXISTS idx_ai_reads_period ON ai_reads(period, status);

CREATE TABLE IF NOT EXISTS timesheet_days (
  timesheet_id TEXT NOT NULL REFERENCES timesheets(id) ON DELETE CASCADE,
  date         TEXT NOT NULL,
  time_in      TEXT,
  time_out     TEXT,
  label        TEXT,                      -- Holiday / Weekend / Sick leave / ว่าง
  job_desc     TEXT,
  remark       TEXT,
  PRIMARY KEY (timesheet_id, date)
);

CREATE TABLE IF NOT EXISTS leave_days (
  timesheet_id TEXT NOT NULL REFERENCES timesheets(id) ON DELETE CASCADE,
  date         TEXT NOT NULL,
  leave_type   TEXT NOT NULL,             -- sick | personal | vacation | unpaid
  PRIMARY KEY (timesheet_id, date)
);

-- ── ใบแจ้งหนี้ ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS invoices (
  id                  TEXT PRIMARY KEY,
  contract_id         TEXT NOT NULL REFERENCES contracts(id),
  period              TEXT NOT NULL,
  document_no         TEXT,               -- เลขที่ FlowAccount ออกให้
  share_link          TEXT,               -- ลิงก์ดูเอกสาร (พิมพ์เป็น PDF ได้) จาก FlowAccount — ข้อ 4.3
  document_pdf        BLOB,               -- ไฟล์ใบวางบิลตัวจริง ตัดมาจากหน้า share_link (ดู fetchSharedPdf)
                                          -- เก็บไว้เพราะต้องแนบเข้าร่างอีเมล และลิงก์ share อาจหมดอายุทีหลัง
  document_date       TEXT NOT NULL,
  due_date            TEXT,
  total               REAL NOT NULL,
  discount_total      REAL NOT NULL,
  total_after_discount REAL NOT NULL,
  vat                 REAL NOT NULL,
  grand_total         REAL NOT NULL,
  withholding_tax     REAL NOT NULL,
  payment_amount      REAL NOT NULL,
  remark              TEXT,
  payload             TEXT,               -- JSON ที่ส่งเข้า FlowAccount
  response            TEXT,               -- JSON ที่ FlowAccount ตอบกลับ
  -- draft → sent_to_flowaccount → failed
  status              TEXT NOT NULL DEFAULT 'draft',
  approved_by         TEXT,
  approved_at         TEXT,
  email_draft         TEXT,               -- JSON ร่างอีเมล
  -- ร่างที่ระบบสร้างไว้ในกล่อง Drafts — threadId คือตัวที่ใช้ตามว่าถูกกดส่งหรือยัง
  -- (ตอนส่ง Gmail ลบร่างทิ้งแล้วสร้าง message ใหม่คนละ id ในสนทนาเดิม)
  gmail_draft_id      TEXT,
  gmail_thread_id     TEXT,
  -- ระบบไม่ส่งเมลเอง คนกดส่งจาก Gmail ของตัวเอง แล้วระบบตรวจเจอเองว่าส่งแล้ว (ดู syncEmailSent)
  -- สองช่องนี้คือขั้นสุดท้ายของรอบบิล ถ้าไม่มีก็ไม่รู้ว่ารอบไหนจบแล้ว
  email_sent_at       TEXT,
  email_sent_by       TEXT,
  created_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_invoice_cycle ON invoices(contract_id, period);

CREATE TABLE IF NOT EXISTS invoice_items (
  invoice_id     TEXT NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  seq            INTEGER NOT NULL,
  employee_id    TEXT REFERENCES employees(id),
  timesheet_id   TEXT REFERENCES timesheets(id),
  name           TEXT NOT NULL,
  description    TEXT,
  quantity       REAL NOT NULL,
  unit_name      TEXT NOT NULL,
  price_per_unit REAL NOT NULL,
  discount       REAL NOT NULL DEFAULT 0,
  amount         REAL NOT NULL,
  PRIMARY KEY (invoice_id, seq)
);

-- ── ประตูมนุษย์ก่อนสร้างร่างใน FlowAccount (ข้อ 4.2) ─────────
-- n8n (01-ingest, 02-daily) ต้องเรียก /request-approval แทน /approve ตรงๆ
-- สร้างร่างจริงเกิดขึ้นต่อเมื่อมีคนกด "อนุมัติ" ใน LINE เท่านั้น (ดู service.decideCycleApproval)
CREATE TABLE IF NOT EXISTS cycle_approvals (
  contract_id     TEXT NOT NULL REFERENCES contracts(id),
  period          TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'pending',   -- pending → approved | rejected
  requested_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  requested_by    TEXT,
  decided_at      TEXT,
  decided_by      TEXT,               -- LINE userId ของคนกด
  line_message_id TEXT,
  PRIMARY KEY (contract_id, period)
);

-- ── ผู้ใช้งานระบบ (login) ────────────────────────────────────
-- เก็บรหัสผ่านเอง (scrypt) ยังไม่ผูก SSO — ดู src/auth.js
-- role: 'admin' แก้ข้อมูลหลักได้ (เรท/สัญญา/ชื่อพ้อง/วันหยุด) · 'user' ทำงานประจำวันได้แต่แก้ไม่ได้
-- มีแค่ 2 ค่านี้เท่านั้น (ดู ROLES ใน src/auth.js) — ห้ามเพิ่ม role อื่นจนกว่าจะมี workflow ที่ต้องใช้จริง
CREATE TABLE IF NOT EXISTS users (
  username      TEXT PRIMARY KEY,
  name_th       TEXT NOT NULL,        -- ชื่อที่จะไปโผล่ใน audit log ทุกครั้งที่กดยืนยัน/อนุมัติ
  role          TEXT NOT NULL DEFAULT 'user',
  active        INTEGER NOT NULL DEFAULT 1,  -- ปิดใช้งานได้โดยไม่ลบ (ประวัติ audit log ยังอ้างชื่อนี้อยู่)
  password_salt TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);

CREATE TABLE IF NOT EXISTS sessions (
  token      TEXT PRIMARY KEY,
  username   TEXT NOT NULL REFERENCES users(username) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  expires_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sessions_username ON sessions(username);

-- ── บันทึกการทำงาน (Audit trail) ───────────────────────────
CREATE TABLE IF NOT EXISTS audit_log (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  actor       TEXT NOT NULL,              -- 'system' | 'llm' | ชื่อผู้ใช้
  action      TEXT NOT NULL,
  entity_type TEXT,
  entity_id   TEXT,
  detail      TEXT                        -- JSON
);

CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_log(entity_type, entity_id);

-- ── ค่าตั้งค่าระบบ ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

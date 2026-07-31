/**
 * ชั้นบริการ — ประกอบ domain logic กับฐานข้อมูล
 * route ทุกตัวเรียกผ่านที่นี่ ไม่แตะ SQL เอง
 */

import { all, get, run, logAudit, getSetting, tx } from './db/index.js';
import { calculateManday, SEVERITY } from './domain/manday.js';
import { buildInvoice, toFlowAccountPayload } from './domain/invoice.js';
import { matchEmployee, checkPosition, MATCH } from './domain/matching.js';
import { FlowAccountClient } from './integrations/flowaccount.js';
import { thaiMonth, thaiDate, money, round2 } from './util/money.js';
import { nextPeriod } from './domain/calendar.js';
import { buildManualSheet, manualExtractor } from './domain/manual-sheet.js';
import { extractTimesheet } from './extract/timesheet.js';
import { draftBillingEmail, readApprovalEmail } from './llm/email.js';
import { GmailClient, hasGmailCredentials } from './integrations/gmail.js';

// ── master data ────────────────────────────────────────────


export function listContracts() {
  return all(`
    SELECT c.*, cu.name_th AS customer_name, cu.tax_id, cu.billing_place,
           cu.contact_name, cu.contact_phone,
           (SELECT COUNT(*) FROM assignments a WHERE a.contract_id = c.id) AS headcount,
           (SELECT SUM(a.monthly_rate) FROM assignments a WHERE a.contract_id = c.id) AS monthly_total
      FROM contracts c
      JOIN customers cu ON cu.id = c.customer_id
     ORDER BY c.po_date DESC
  `);
}


function holidayMap(customerId = null) {
  const rows = all(
    `SELECT date, name FROM holidays
      WHERE customer_id IS NULL OR customer_id = $customerId`,
    { customerId },
  );
  return new Map(rows.map((r) => [r.date, r.name]));
}

/**
 * ข้อมูลหลักพนักงานในรูปแบบที่ domain/matching.js ต้องการ
 *
 * เดิมอ่านผ่าน listEmployees() ที่มีไว้ป้อนหน้า "พนักงาน" — หน้านั้นถูกตัดออกแล้ว
 * (อ่านได้อย่างเดียว แก้ไม่ได้ และเอกสารออกแบบให้ Master Data อยู่ใน DB/Sheet)
 * จึงรวมมาไว้ที่นี่ที่เดียว เพราะเหลือผู้ใช้แค่การจับคู่ชื่อตามเอกสารข้อ 2.1
 */
function employeesForMatching() {
  const rows = all(`
    SELECT e.id, e.name_th, e.name_en, e.invoice_position,
           a.monthly_rate, a.quotation_no
      FROM employees e
      LEFT JOIN assignments a
        ON a.employee_id = e.id AND a.status = 'active'
     ORDER BY e.id`);

  const aliases = all("SELECT employee_id, kind, alias FROM employee_aliases");
  const byEmployee = new Map();
  for (const a of aliases) {
    if (!byEmployee.has(a.employee_id)) byEmployee.set(a.employee_id, { name: [], position: [] });
    byEmployee.get(a.employee_id)[a.kind]?.push(a.alias);
  }

  return rows.map((r) => {
    const al = byEmployee.get(r.id) ?? { name: [], position: [] };
    return {
      id: r.id,
      nameTh: r.name_th,
      nameEn: r.name_en,
      aliases: al.name,
      invoicePosition: r.invoice_position,
      positionAliases: al.position,
      monthlyRate: r.monthly_rate,
      quotationNo: r.quotation_no,
    };
  });
}

// ── timesheet ──────────────────────────────────────────────

/**
 * สถานะที่ต้องมีคน "ตัดสินใจ" จริงๆ — ใช้นับป้ายบนเมนูและกรองในกล่องงาน
 *
 * เดิมนับ verified (ตรวจผ่าน) รวมมาด้วย ซึ่งผิดเจตนาของระบบ —
 * ใบที่ตรวจผ่านแล้วไม่ต้องมีคนแตะอีก มันรอครบรอบแล้วไหลไปสร้างร่างเอง
 * คนมาเกี่ยวอีกครั้งเดียวคือตอนอนุมัติ "รอบบิล" ไม่ใช่อนุมัติ Timesheet ทีละใบ
 * การเอา verified มานับ ทำให้ระบบทวงงานที่ไม่มีอะไรให้ทำ = สร้างงาน manual ขึ้นมาเอง
 *
 * ที่เหลืออยู่คือของที่คนต้องตัดสินใจจริง:
 *   mismatch            ตรวจไม่ผ่าน ต้องเลือกว่าตีกลับหรือแก้ข้อมูลหลัก
 *   received/extracted  ค้างกลางทาง แปลว่า pipeline สะดุด ต้องมีคนรู้
 */
export const NEEDS_ACTION = ['received', 'extracted', 'mismatch'];

const STATUS_LABEL = {
  received: 'รับเข้าระบบ',
  extracted: 'อ่านข้อมูลแล้ว',
  verified: 'ตรวจผ่าน',
  mismatch: 'ข้อมูลไม่ตรง',
  approved: 'อนุมัติแล้ว',
  billed: 'วางบิลแล้ว',
  rejected: 'ตีกลับให้แก้ไข',
};

/**
 * ตราประทับ "คนตรวจแล้ว" — เก็บใน audit_log ไม่ใช่คอลัมน์ใหม่ในตาราง timesheets
 *
 * เหตุผล: ตราต้องผูกกับ "ตัวเลขชุดที่คนเห็นตอนกด" ไม่ใช่ผูกกับใบเฉยๆ
 * ถ้ายอดเปลี่ยนหลังจากกดไปแล้ว (เพิ่มวันหยุด · แก้เรท · ส่ง Timesheet ฉบับใหม่มาทับ)
 * ตราเดิมต้องหมดอายุเอง ไม่งั้นจะมีคนอนุมัติยอดที่ไม่มีใครเคยดู
 */
const CHECK_COLUMNS = `
           (SELECT al.at    FROM audit_log al
             WHERE al.entity_type = 'timesheet' AND al.entity_id = t.id
               AND al.action = 'human_checked' ORDER BY al.id DESC LIMIT 1) AS check_at,
           (SELECT al.actor FROM audit_log al
             WHERE al.entity_type = 'timesheet' AND al.entity_id = t.id
               AND al.action = 'human_checked' ORDER BY al.id DESC LIMIT 1) AS check_by,
           (SELECT al.detail FROM audit_log al
             WHERE al.entity_type = 'timesheet' AND al.entity_id = t.id
               AND al.action = 'human_checked' ORDER BY al.id DESC LIMIT 1) AS check_detail`;

function checkStamp(row, computed) {
  if (!row.check_at) {
    return { checked: false, stale: false, at: null, by: null };
  }
  let stamped = null;
  try { stamped = row.check_detail ? JSON.parse(row.check_detail) : null; } catch { stamped = null; }

  const stale = Boolean(computed && stamped) && (
    stamped.lineAmount !== computed.lineAmount ||
    stamped.payableDays !== computed.payableDays
  );

  return { checked: !stale, stale, at: row.check_at, by: row.check_by };
}

export function listTimesheets({ status, period } = {}) {
  const rows = all(`
    SELECT t.*, e.name_th, e.name_en, e.invoice_position,
           a.monthly_rate, a.quotation_no,
           c.po_no, c.contract_no, c.project_name,
           cu.name_th AS customer_name,
           i.document_no AS invoice_no, i.status AS invoice_status,
           ${CHECK_COLUMNS}
      FROM timesheets t
      LEFT JOIN employees   e  ON e.id = t.employee_id
      LEFT JOIN assignments a  ON a.employee_id = t.employee_id AND a.contract_id = t.contract_id
      LEFT JOIN contracts   c  ON c.id = t.contract_id
      LEFT JOIN customers   cu ON cu.id = c.customer_id
      LEFT JOIN invoices    i  ON i.contract_id = t.contract_id AND i.period = t.period
     ORDER BY t.received_at DESC
  `);

  return rows
    .filter((r) => (status ? r.status === status : true))
    .filter((r) => (period ? r.period === period : true))
    .map(shapeTimesheetRow);
}

function shapeTimesheetRow(row) {
  const computed = row.computed ? JSON.parse(row.computed) : null;
  return {
    id: row.id,
    period: row.period,
    periodLabel: thaiMonth(row.period),
    receivedAt: row.received_at,
    sourceFile: row.source_file,
    status: row.status,
    statusLabel: STATUS_LABEL[row.status] ?? row.status,
    statusReason: row.status_reason,
    employee: {
      id: row.employee_id,
      nameTh: row.name_th,
      nameEn: row.name_en,
      invoicePosition: row.invoice_position,
      monthlyRate: row.monthly_rate,
      quotationNo: row.quotation_no,
    },
    rawEmployeeName: row.raw_employee_name,
    rawPosition: row.raw_position,
    reportedWorkDays: row.reported_workdays,
    reportedLeave: row.reported_leave,
    contract: {
      id: row.contract_id,
      poNo: row.po_no,
      contractNo: row.contract_no,
      projectName: row.project_name,
      customerName: row.customer_name,
    },
    invoiceNo: row.invoice_no,
    invoiceStatus: row.invoice_status,
    check: checkStamp(row, computed),
    payableDays: computed?.payableDays ?? null,
    discount: computed?.discount ?? null,
    lineAmount: computed?.lineAmount ?? null,
    checks: computed?.checks ?? [],
    // ใช้ในแผงรายละเอียดที่กางในกล่องงาน
    standardWorkingDays: computed?.standardWorkingDays ?? null,
    dailyRate: computed?.dailyRate ?? null,
    leaveDates: (computed?.leaveDays ?? [])
      .map((l) => `${thaiDate(l.date)}${LEAVE_TH[l.type] ? ` (${LEAVE_TH[l.type]})` : ''}`)
      .join(', '),
    approvedByLabel: row.approved_by ?? null,
  };
}

const LEAVE_TH = {
  sick: 'ลาป่วย', personal: 'ลากิจ', vacation: 'ลาพักร้อน', unpaid: 'ลาไม่รับค่าจ้าง',
};

export function getTimesheet(id) {
  const row = get(
    `SELECT t.*, e.name_th, e.name_en, e.invoice_position,
            a.monthly_rate, a.quotation_no,
            c.po_no, c.contract_no, c.project_name, c.divisor_mode, c.divisor_value,
            c.start_date AS contract_start, c.end_date AS contract_end, c.credit_days,
            cu.id AS customer_id, cu.name_th AS customer_name, cu.tax_id,
            cu.billing_place, cu.contact_name, cu.contact_phone,
            ${CHECK_COLUMNS}
       FROM timesheets t
       LEFT JOIN employees   e  ON e.id = t.employee_id
       LEFT JOIN assignments a  ON a.employee_id = t.employee_id AND a.contract_id = t.contract_id
       LEFT JOIN contracts   c  ON c.id = t.contract_id
       LEFT JOIN customers   cu ON cu.id = c.customer_id
      WHERE t.id = $id`,
    { id },
  );
  if (!row) return null;

  const base = shapeTimesheetRow(row);
  const computed = row.computed ? JSON.parse(row.computed) : null;
  const leave = all(
    'SELECT date, leave_type FROM leave_days WHERE timesheet_id = $id ORDER BY date',
    { id },
  );
  const dayLabels = all(
    'SELECT date, label, time_in, time_out FROM timesheet_days WHERE timesheet_id = $id ORDER BY date',
    { id },
  );

  return {
    ...base,
    approvedBy: row.approved_by,
    approvedAt: row.approved_at,
    sourceEmailId: row.source_email_id,
    extraction: row.extraction ? JSON.parse(row.extraction) : null,
    manday: computed,
    leaveDays: leave,
    dayLabels,
    contract: {
      ...base.contract,
      customerId: row.customer_id,
      taxId: row.tax_id,
      billingPlace: row.billing_place,
      contactName: row.contact_name,
      contactPhone: row.contact_phone,
      divisorMode: row.divisor_mode,
      divisorValue: row.divisor_value,
      startDate: row.contract_start,
      endDate: row.contract_end,
      creditDays: row.credit_days,
    },
    matching: buildMatchingReport(row),
    audit: all(
      `SELECT at, actor, action, detail FROM audit_log
        WHERE entity_type = 'timesheet' AND entity_id = $id ORDER BY id`,
      { id },
    ).map((a) => ({ ...a, detail: a.detail ? JSON.parse(a.detail) : null })),
  };
}

function buildMatchingReport(row) {
  const employees = employeesForMatching();
  const nameResult = matchEmployee(row.raw_employee_name, employees);
  const employee = nameResult.employee ?? employees.find((e) => e.id === row.employee_id);

  const positionResult = employee
    ? checkPosition(row.raw_position, employee)
    : { ok: false, reason: 'ยังจับคู่พนักงานไม่ได้ จึงตรวจตำแหน่งไม่ได้' };

  const rateOk = employee && Number(row.monthly_rate) === Number(employee.monthlyRate);

  return {
    name: {
      raw: row.raw_employee_name,
      matchedTo: employee ? `${employee.id} · ${employee.nameTh}` : null,
      kind: nameResult.match,
      ok: nameResult.match !== MATCH.NONE,
      needsConfirm: nameResult.match === MATCH.FUZZY,
      reason: nameResult.reason,
    },
    position: {
      raw: row.raw_position,
      invoicePosition: employee?.invoicePosition ?? null,
      ok: positionResult.ok,
      reason: positionResult.reason,
    },
    rate: {
      fromContract: row.monthly_rate,
      quotationNo: row.quotation_no,
      ok: Boolean(rateOk),
      reason: rateOk
        ? `ตรงกับใบว่าจ้าง ${row.po_no} อ้าง ${row.quotation_no}`
        : 'เรทในสัญญาไม่ตรงกับฐานข้อมูลพนักงาน',
    },
  };
}

/** คำนวณ Manday ใหม่จากข้อมูลปัจจุบัน แล้วบันทึกกลับ */
export function recomputeTimesheet(id, { actor = 'system' } = {}) {
  const row = get(
    `SELECT t.*, a.monthly_rate, c.divisor_mode, c.divisor_value, c.customer_id,
            c.start_date AS contract_start, c.end_date AS contract_end
       FROM timesheets t
       LEFT JOIN assignments a ON a.employee_id = t.employee_id AND a.contract_id = t.contract_id
       LEFT JOIN contracts   c ON c.id = t.contract_id
      WHERE t.id = $id`,
    { id },
  );
  if (!row) throw new Error(`ไม่พบ Timesheet ${id}`);

  const leave = all(
    'SELECT date, leave_type FROM leave_days WHERE timesheet_id = $id',
    { id },
  ).map((l) => ({ date: l.date, type: l.leave_type }));

  const dayLabels = all(
    'SELECT date, label FROM timesheet_days WHERE timesheet_id = $id',
    { id },
  );

  const manday = calculateManday({
    period: row.period,
    monthlyRate: row.monthly_rate,
    reportedWorkDays: row.reported_workdays,
    leaveDays: leave,
    holidays: holidayMap(row.customer_id),
    divisor: { mode: row.divisor_mode, value: row.divisor_value },
    reportedDayLabels: dayLabels,
  });

  // รอบบิลต้องอยู่ในช่วงสัญญา
  const periodStart = manday.calendar.firstDate;
  const periodEnd = manday.calendar.lastDate;
  const inContract = periodStart >= row.contract_start && periodEnd <= row.contract_end;
  manday.checks.push(
    inContract
      ? {
          id: 'contract_period',
          severity: SEVERITY.PASS,
          title: 'รอบบิลอยู่ในช่วงสัญญา',
          detail: `${thaiDate(periodStart)} – ${thaiDate(periodEnd)} อยู่ในช่วง ${thaiDate(row.contract_start)} – ${thaiDate(row.contract_end)}`,
        }
      : {
          id: 'contract_period',
          severity: SEVERITY.FAIL,
          title: 'รอบบิลอยู่นอกช่วงสัญญา',
          detail: `${thaiDate(periodStart)} – ${thaiDate(periodEnd)} ไม่อยู่ในช่วง ${thaiDate(row.contract_start)} – ${thaiDate(row.contract_end)}`,
        },
  );

  // ต้องได้ Timesheet ครบทุกคนในสัญญาก่อนวางบิล
  const cycle = getCycleStatus(row.contract_id, row.period);
  manday.checks.push(
    cycle.complete
      ? {
          id: 'cycle_complete',
          severity: SEVERITY.PASS,
          title: 'Timesheet ครบทุกคนในใบว่าจ้าง',
          detail: `ได้รับ ${cycle.received}/${cycle.expected} คน`,
        }
      : {
          id: 'cycle_complete',
          severity: SEVERITY.WARN,
          title: 'ยังได้ Timesheet ไม่ครบทุกคน',
          detail: `ได้รับ ${cycle.received}/${cycle.expected} คน — ${cycle.missing.join(', ')} ยังไม่ส่ง`,
        },
  );

  const ok = manday.checks.every((c) => c.severity !== SEVERITY.FAIL);
  const status = ok ? 'verified' : 'mismatch';
  const reason = ok
    ? null
    : manday.checks.filter((c) => c.severity === SEVERITY.FAIL).map((c) => c.title).join(' · ');

  run(
    `UPDATE timesheets
        SET computed = $computed, status = $status, status_reason = $reason,
            updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now')
      WHERE id = $id`,
    { id, computed: JSON.stringify({ ...manday, ok }), status, reason },
  );

  logAudit({
    actor,
    action: 'recompute_manday',
    entityType: 'timesheet',
    entityId: id,
    detail: {
      payableDays: manday.payableDays,
      discount: manday.discount,
      status,
      failures: manday.checks.filter((c) => c.severity === SEVERITY.FAIL).map((c) => c.id),
    },
  });

  return { ...manday, ok, status };
}

// ── แก้ข้อมูลหลักด้วยมือ ─────────────────────────────────────
/* ระบบเคยอ่านข้อมูลหลักได้อย่างเดียว จึงมีทางตัน: เมื่อจับคู่ชื่อไม่ได้
   ระบบบอกว่า "ต้องเพิ่มชื่อพ้อง" แต่ไม่มีที่ให้ทำ ต้องแก้โค้ดหรือรัน SQL
   สี่ฟังก์ชันนี้ปิดวงจรนั้น — แก้แล้วสั่งคำนวณใหม่ได้ทันที */

/** เพิ่มชื่อพ้องของพนักงาน — kind: 'name' (ชื่อ) หรือ 'position' (ตำแหน่ง) */
export function addEmployeeAlias({ employeeId, kind, alias, source = 'ป้อนด้วยมือ', actor }) {
  if (!['name', 'position'].includes(kind)) {
    throw Object.assign(new Error("kind ต้องเป็น 'name' หรือ 'position'"), { status: 400 });
  }
  const clean = (alias ?? '').trim();
  if (!clean) throw Object.assign(new Error('ต้องกรอกชื่อพ้อง'), { status: 400 });

  const employee = get('SELECT id, name_th FROM employees WHERE id = $id', { id: employeeId });
  if (!employee) throw Object.assign(new Error(`ไม่พบพนักงาน ${employeeId}`), { status: 404 });

  const dup = get(
    'SELECT 1 FROM employee_aliases WHERE employee_id = $id AND kind = $k AND alias = $a',
    { id: employeeId, k: kind, a: clean },
  );
  if (dup) throw Object.assign(new Error(`"${clean}" มีอยู่แล้ว`), { status: 409 });

  run(
    `INSERT INTO employee_aliases (employee_id, kind, alias, source)
     VALUES ($id, $k, $a, $s)`,
    { id: employeeId, k: kind, a: clean, s: source },
  );
  logAudit({
    actor, action: 'add_alias', entityType: 'employee', entityId: employeeId,
    detail: { kind, alias: clean },
  });
  return { employeeId, employeeName: employee.name_th, kind, alias: clean };
}

/** ลบชื่อพ้อง */
export function removeEmployeeAlias({ employeeId, kind, alias, actor }) {
  const found = get(
    'SELECT 1 FROM employee_aliases WHERE employee_id = $id AND kind = $k AND alias = $a',
    { id: employeeId, k: kind, a: alias },
  );
  if (!found) throw Object.assign(new Error('ไม่พบชื่อพ้องนี้'), { status: 404 });
  run(
    'DELETE FROM employee_aliases WHERE employee_id = $id AND kind = $k AND alias = $a',
    { id: employeeId, k: kind, a: alias },
  );
  logAudit({
    actor, action: 'remove_alias', entityType: 'employee', entityId: employeeId,
    detail: { kind, alias },
  });
  return { employeeId, kind, alias, removed: true };
}

/**
 * แก้เรทต่อเดือนของสัญญาจ้างรายคน
 * ⚠️ ไม่แตะใบแจ้งหนี้ที่ออกไปแล้ว — ใบเก่าเก็บยอดของตัวเองไว้แล้ว
 *    ถ้าต้องแก้ใบที่วางบิลไปแล้วต้องทำที่ FlowAccount ไม่ใช่ที่นี่
 */
export function updateAssignmentRate({ assignmentId, monthlyRate, quotationNo, actor }) {
  const rate = Number(monthlyRate);
  if (!Number.isFinite(rate) || rate <= 0) {
    throw Object.assign(new Error('เรทต่อเดือนต้องเป็นจำนวนเงินที่มากกว่า 0'), { status: 400 });
  }
  const row = get(
    `SELECT a.id, a.monthly_rate, a.quotation_no, e.name_th
       FROM assignments a JOIN employees e ON e.id = a.employee_id
      WHERE a.id = $id`,
    { id: assignmentId },
  );
  if (!row) throw Object.assign(new Error(`ไม่พบสัญญาจ้าง ${assignmentId}`), { status: 404 });

  run(
    `UPDATE assignments
        SET monthly_rate = $rate,
            quotation_no = COALESCE($qt, quotation_no)
      WHERE id = $id`,
    { id: assignmentId, rate: round2(rate), qt: quotationNo ?? null },
  );
  logAudit({
    actor, action: 'update_rate', entityType: 'assignment', entityId: assignmentId,
    detail: { employee: row.name_th, from: row.monthly_rate, to: round2(rate) },
  });
  return {
    assignmentId, employeeName: row.name_th,
    from: row.monthly_rate, to: round2(rate),
    note: 'ใบแจ้งหนี้ที่ออกไปแล้วไม่เปลี่ยน — ต้องสั่งคำนวณ Timesheet ใหม่ถ้าอยากให้ใช้เรทใหม่',
  };
}

/** เพิ่มวันหยุด — customerId ว่าง = ใช้กับทุกลูกค้า */
export function addHoliday({ date, name, customerId = null, actor }) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date ?? '')) {
    throw Object.assign(new Error('วันที่ต้องเป็นรูปแบบ YYYY-MM-DD'), { status: 400 });
  }
  if (!(name ?? '').trim()) {
    throw Object.assign(new Error('ต้องกรอกชื่อวันหยุด'), { status: 400 });
  }
  const dup = get(
    'SELECT 1 FROM holidays WHERE date = $d AND customer_id IS $c',
    { d: date, c: customerId },
  );
  if (dup) throw Object.assign(new Error(`มีวันหยุดของวันที่ ${date} อยู่แล้ว`), { status: 409 });

  run(
    'INSERT INTO holidays (date, name, customer_id) VALUES ($d, $n, $c)',
    { d: date, n: name.trim(), c: customerId },
  );
  logAudit({
    actor, action: 'add_holiday', entityType: 'holiday', entityId: date,
    detail: { name: name.trim(), customerId },
  });
  return { date, name: name.trim(), customerId };
}

/** ลบวันหยุด */
export function removeHoliday({ date, customerId = null, actor }) {
  const found = get(
    'SELECT name FROM holidays WHERE date = $d AND customer_id IS $c',
    { d: date, c: customerId },
  );
  if (!found) throw Object.assign(new Error(`ไม่พบวันหยุดของวันที่ ${date}`), { status: 404 });
  run('DELETE FROM holidays WHERE date = $d AND customer_id IS $c', { d: date, c: customerId });
  logAudit({
    actor, action: 'remove_holiday', entityType: 'holiday', entityId: date,
    detail: { name: found.name, customerId },
  });
  return { date, removed: true };
}

/**
 * ปิดงาน — คนส่งเมลจาก Gmail ของตัวเองแล้วมากดยืนยันที่นี่
 *
 * ระบบไม่ส่งเมลเอง (ข้อบังคับของงานนี้) จึงต้องมีขั้นนี้
 * ไม่มีขั้นนี้แล้วรอบบิลจะค้างอยู่ที่ "สร้างร่างแล้ว" ตลอดไป ไม่มีทางรู้ว่าอันไหนจบ
 */
export function markInvoiceEmailSent({ invoiceId, actor }) {
  const inv = get(
    'SELECT id, document_no, period, email_sent_at FROM invoices WHERE id = $id',
    { id: invoiceId },
  );
  if (!inv) throw Object.assign(new Error(`ไม่พบใบแจ้งหนี้ ${invoiceId}`), { status: 404 });
  if (inv.email_sent_at) {
    throw Object.assign(
      new Error(`ใบนี้ถูกบันทึกว่าส่งแล้วเมื่อ ${inv.email_sent_at}`), { status: 409 },
    );
  }
  const at = new Date().toISOString();
  run(
    'UPDATE invoices SET email_sent_at = $at, email_sent_by = $by WHERE id = $id',
    { id: invoiceId, at, by: actor },
  );
  logAudit({
    actor, action: 'email_sent', entityType: 'invoice', entityId: invoiceId,
    detail: { documentNo: inv.document_no, period: inv.period },
  });
  return { invoiceId, documentNo: inv.document_no, sentAt: at, sentBy: actor };
}

/**
 * ป้อน Timesheet ด้วยมือ — ทางเข้าของการใช้งานแบบ manual
 *
 * ระบบต้องใช้งานได้ครบวงจรด้วยคนก่อน แล้วค่อยต่อ n8n ทีหลัง ทางนี้จึงไม่พึ่ง
 * ทั้งอีเมลและ Claude แต่ไหลผ่าน ingestTimesheet() ตัวเดียวกับที่ n8n ใช้
 * ผลลัพธ์จึงเหมือนกันทุกอย่าง — จับคู่ชื่อ ตรวจปฏิทิน ตรวจ Manday คิดส่วนลด
 *
 * ตารางรายวันทั้งเดือนสร้างจากปฏิทินวันหยุดของลูกค้ารายนั้น คนกรอกแค่วันที่ลา
 */
/**
 * ขั้นที่ 1 ของงานแบบ manual — คนอัปโหลดไฟล์เอง แล้วให้ AI อ่านให้ดูก่อน
 *
 * ตั้งใจแยกออกจาก ingestTimesheet() ตรงที่ **ยังไม่บันทึกอะไรลงฐานข้อมูล**
 * เพราะสิ่งที่ AI อ่านมายังไม่ใช่ข้อสรุป คนต้องได้เห็นและแก้ก่อนกดยืนยัน
 * (ของโหมด auto ไม่มีขั้นนี้ — n8n ยิง /ingest ทีเดียวจบ)
 */
export async function readTimesheetFile({
  fileBase64,
  filePath,
  fileName = null,
  expectedPeriod = null,
  extractor = extractTimesheet,
}) {
  if (!fileBase64 && !filePath) {
    throw Object.assign(new Error('ยังไม่ได้เลือกไฟล์ Timesheet'), { status: 400 });
  }

  const source = fileBase64 ? Buffer.from(fileBase64, 'base64') : filePath;
  const { data, verification, usage, model } = await extractor(source, { expectedPeriod });

  // จับคู่ให้ดูก่อน ยังไม่ผูกอะไร — คนจะได้รู้ตั้งแต่ยังไม่บันทึกว่าชื่อนี้ไปลงที่ใคร
  const employees = employeesForMatching();
  const nameMatch = matchEmployee(data.employeeName, employees);
  const employee = nameMatch.employee ?? null;

  const assignment = employee
    ? get(
        `SELECT a.*, c.id AS contract_id, c.po_no, c.project_name, cu.name_th AS customer_name
           FROM assignments a
           JOIN contracts c ON c.id = a.contract_id
           JOIN customers cu ON cu.id = c.customer_id
          WHERE a.employee_id = $emp AND a.status = 'active'
            AND $first >= a.start_date AND $first <= a.end_date`,
        { emp: employee.id, first: `${data.period}-01` },
      )
    : null;

  logAudit({
    actor: 'llm',
    action: 'read_timesheet_file',
    entityType: 'timesheet',
    entityId: fileName ?? 'อัปโหลด',
    detail: { model, usage, employeeName: data.employeeName, period: data.period, ok: verification.ok },
  });

  return {
    fileName,
    model,
    usage,
    data,
    verification,
    matching: {
      kind: nameMatch.match,
      reason: nameMatch.reason,
      employee: employee
        ? { id: employee.id, nameTh: employee.nameTh, invoicePosition: employee.invoicePosition }
        : null,
      position: employee ? checkPosition(data.position, employee) : null,
    },
    contract: assignment
      ? {
          id: assignment.contract_id,
          poNo: assignment.po_no,
          projectName: assignment.project_name,
          customerName: assignment.customer_name,
          monthlyRate: assignment.monthly_rate,
          quotationNo: assignment.quotation_no,
        }
      : null,
    blockers: [
      ...(employee ? [] : [`จับคู่ชื่อ "${data.employeeName}" กับพนักงานในระบบไม่ได้ — ไปเพิ่มชื่อพ้องที่หน้าข้อมูลหลักก่อน`]),
      ...(employee && !assignment ? [`${employee.nameTh} ไม่มีสัญญาที่ครอบรอบ ${data.period}`] : []),
      ...verification.issues.filter((i) => i.severity === 'fail').map((i) => i.message),
    ],
  };
}

/**
 * บันทึกสิ่งที่คนตรวจแล้วจากหน้าอัปโหลดเข้าระบบ
 *
 * ไม่เรียกโมเดลซ้ำ — ใช้ผลที่คนเห็นบนจอ (แก้แล้วหรือไม่แก้ก็ตาม) เป็นตัวจริง
 * แล้วปล่อยไหลผ่าน ingestTimesheet() เส้นเดียวกับ n8n เพื่อให้กฎคิดเงินชุดเดียวกัน
 */
export async function confirmTimesheet({
  documentNo,
  extraction,
  fileName = null,
  sourceEmailId = null,
  approvedBy = null,
  approvedAt = null,
  readModel = null,
  actor,
}) {
  if (!documentNo) {
    throw Object.assign(new Error('ต้องระบุเลขที่เอกสารจากใบ Timesheet'), { status: 400 });
  }
  if (!extraction?.employeeName || !extraction?.period) {
    throw Object.assign(new Error('ข้อมูลที่อ่านได้ไม่ครบ — ต้องมีอย่างน้อยชื่อพนักงานและรอบเดือน'), { status: 400 });
  }

  const data = {
    ...extraction,
    days: extraction.days ?? [],
    leaveDays: extraction.leaveDays ?? [],
    totalWorkDays: Number(extraction.totalWorkDays ?? 0),
    totalLeaveDays: Number(extraction.totalLeaveDays ?? (extraction.leaveDays ?? []).length),
    notes: extraction.notes ?? [],
  };

  const stamped = readModel ? `${readModel} · คนยืนยัน` : 'ป้อนด้วยมือ';

  return ingestTimesheet({
    documentNo,
    fileName: fileName ?? `อัปโหลดด้วยมือ · ${data.period}`,
    filePath: `upload://${documentNo}`,
    sourceEmailId,
    approvedBy,
    approvedAt,
    expectedPeriod: data.period,
    actor,
    extractor: async () => ({
      data,
      verification: { ok: true, issues: [] },
      usage: { input_tokens: 0, output_tokens: 0 },
      model: stamped,
    }),
  });
}

/* ── ขั้นที่ 1 ทางเลือกที่สอง: ดึงจากกล่องเมลโดยตรง ─────────
   ต่างจากการอัปโหลดไฟล์ตรงที่ได้ **เนื้ออีเมล** มาด้วย
   ซึ่งเป็นที่อยู่ของเลขที่เอกสารและสถานะ "อนุมัติ" ที่ไฟล์ PDF ไม่มี
   คนยังเป็นคนกดว่าจะเอาฉบับไหนเข้าระบบ ไม่ได้ดูดเข้าเองทั้งกล่อง */

const DEFAULT_GMAIL_QUERY =
  process.env.GMAIL_QUERY ??
  'subject:(TimeSheet OR "แจ้งอนุมัติ") has:attachment filename:pdf newer_than:90d';

export async function gmailInbox({ query = DEFAULT_GMAIL_QUERY, max = 15, client } = {}) {
  const gmail = client ?? new GmailClient();
  const [profile, messages] = await Promise.all([
    gmail.profile(),
    gmail.searchMessages({ query, max }),
  ]);

  const known = new Set(all('SELECT source_email_id FROM timesheets').map((r) => r.source_email_id));

  return {
    account: profile.email,
    query,
    messages: messages
      .filter((m) => m.pdfAttachments.length > 0)
      .map((m) => ({
        id: m.id,
        subject: m.subject,
        from: m.from,
        receivedAt: m.receivedAt,
        snippet: m.snippet,
        attachments: m.pdfAttachments.map((a) => ({
          filename: a.filename, size: a.size, attachmentId: a.attachmentId,
        })),
        /* เคยดึงฉบับนี้เข้าระบบไปแล้วหรือยัง — กันคนกดซ้ำโดยไม่ตั้งใจ */
        alreadyIngested: known.has(m.id),
      })),
  };
}

/**
 * ดึงอีเมลหนึ่งฉบับมาอ่าน — ทั้งไฟล์แนบและเนื้อความ
 * คืนโครงเดียวกับ readTimesheetFile() เพื่อให้หน้าจอใช้ตัวแสดงผลชุดเดียวกันได้
 */
export async function readTimesheetFromEmail({
  messageId,
  attachmentId = null,
  client,
  extractor = extractTimesheet,
  emailReader = readApprovalEmail,
}) {
  if (!messageId) throw Object.assign(new Error('ต้องระบุอีเมลที่จะดึง'), { status: 400 });

  const gmail = client ?? new GmailClient();
  const message = await gmail.getMessage(messageId);

  const target = attachmentId
    ? message.attachments.find((a) => a.attachmentId === attachmentId)
    : message.pdfAttachments[0];

  if (!target) {
    throw Object.assign(new Error('อีเมลฉบับนี้ไม่มีไฟล์ PDF แนบมา'), { status: 400 });
  }

  // อ่านเนื้ออีเมลกับอ่านไฟล์ PDF พร้อมกัน — สองอย่างนี้ไม่ขึ้นต่อกัน
  const pdf = await gmail.getAttachment(messageId, target.attachmentId);
  const [emailMeta, sheet] = await Promise.all([
    emailReader({
      subject: message.subject, from: message.from, date: message.date, body: message.body,
    }),
    readTimesheetFile({
      fileBase64: pdf.toString('base64'),
      fileName: target.filename,
      extractor,
    }),
  ]);

  const blockers = [...sheet.blockers];

  /* เอกสารข้อ 1.2 บังคับว่าต้องเป็น "อนุมัติ" เท่านั้นจึงเอาเข้าระบบได้
     ถ้าอีเมลไม่ได้บอกว่าอนุมัติ ต้องกันไว้ ไม่ใช่แค่ทัก */
  if (emailMeta.approvalStatus && !emailMeta.approvalStatus.includes('อนุมัติ')) {
    blockers.push(`อีเมลระบุสถานะ "${emailMeta.approvalStatus}" ไม่ใช่ "อนุมัติ"`);
  } else if (emailMeta.approvalStatus?.includes('ไม่อนุมัติ')) {
    blockers.push('อีเมลระบุว่า "ไม่อนุมัติ"');
  }

  // เดือนในอีเมลกับในไฟล์ไม่ตรงกัน = หยิบไฟล์ผิดฉบับ ต้องให้คนดูก่อน
  if (emailMeta.period && sheet.data.period && emailMeta.period !== sheet.data.period) {
    blockers.push(`อีเมลบอกรอบ ${emailMeta.period} แต่ในไฟล์เป็น ${sheet.data.period}`);
  }

  logAudit({
    actor: 'llm',
    action: 'read_email_approval',
    entityType: 'timesheet',
    entityId: emailMeta.documentNo ?? messageId,
    detail: {
      model: emailMeta.model, subject: message.subject,
      documentNo: emailMeta.documentNo, status: emailMeta.approvalStatus,
    },
  });

  return {
    ...sheet,
    blockers,
    /* เติมค่าที่อีเมลรู้แต่ไฟล์ไม่รู้ — คนแก้ได้ทุกช่องก่อนกดยืนยันอยู่แล้ว */
    documentNo: emailMeta.documentNo ?? null,
    approvedBy: emailMeta.approvedBy ?? null,
    approvedAt: emailMeta.approvedAt ?? null,
    sourceEmailId: messageId,
    email: {
      subject: message.subject,
      from: message.from,
      receivedAt: message.receivedAt,
      body: message.body.slice(0, 4000),
      meta: emailMeta,
    },
  };
}

/**
 * ขั้นที่ 4 — วาง **ร่าง** อีเมลวางบิลไว้ในกล่อง Drafts ของผู้ใช้
 * ระบบไม่กดส่ง และในตัวเชื่อม Gmail ก็ไม่มีโค้ดส่งอยู่เลย
 */
export async function createGmailDraft(contractId, period, { actor, client } = {}) {
  const preview = previewCycleInvoice(contractId, period);
  if (!preview.invoice) {
    throw Object.assign(new Error('ยังไม่มีรายการที่วางบิลได้ในรอบนี้'), { status: 400 });
  }

  const to = preview.contract.contact_email;
  if (!to) {
    throw Object.assign(
      new Error('ยังไม่มีอีเมลผู้ประสานงานของลูกค้าในระบบ — ใส่ที่หน้าข้อมูลหลักก่อน'),
      { status: 400 },
    );
  }

  const draft = preview.existing?.email_draft
    ? JSON.parse(preview.existing.email_draft)
    : preview.emailDraft;

  const gmail = client ?? new GmailClient();
  const result = await gmail.createDraft({
    to,
    cc: getSetting('company', {})?.email ?? null,
    subject: draft.subject,
    body: draft.body,
    // ไฟล์แนบยังไม่มี — PDF ใบแจ้งหนี้อยู่ใน FlowAccount ต้องทำข้อ 4.3 ก่อน
    attachments: [],
  });

  logAudit({
    actor,
    action: 'gmail_draft_created',
    entityType: 'invoice',
    entityId: preview.existing?.id ?? `${contractId}-${period}`,
    detail: { draftId: result.draftId, to, period },
  });

  return {
    ...result,
    to,
    subject: draft.subject,
    note: 'สร้างเป็นร่างในกล่อง Drafts แล้ว — ต้องแนบใบแจ้งหนี้กับ Timesheet เองก่อนกดส่ง',
  };
}

export async function enterTimesheetManually({
  documentNo,
  employeeName,
  position,
  period,
  leaveDays = [],
  approvedBy = null,
  approvedAt = null,
  customerId = null,
  actor,
}) {
  const data = buildManualSheet({
    employeeName,
    position,
    period,
    leaveDays,
    holidays: holidayMap(customerId),
  });

  return ingestTimesheet({
    documentNo,
    fileName: `ป้อนด้วยมือ · ${period}`,
    sourceEmailId: null,
    approvedBy,
    expectedPeriod: period,
    actor,
    extractor: manualExtractor(data),
    // ingestTimesheet บังคับให้มีไฟล์ ส่ง marker ไปให้ผ่านด่านนั้น
    filePath: `manual://${documentNo}`,
    approvedAt,
  });
}

// ── รับ Timesheet เข้าระบบ (จุดต่อกับ n8n) ─────────────────

export const NEXT_ACTION = {
  APPROVE_CYCLE: 'approve_cycle',       // ครบและตรวจผ่าน → n8n เรียก approve ได้เลย
  WAIT_FOR_OTHERS: 'wait_for_others',   // ตรวจผ่านแต่ยังไม่ครบทุกคน → รอรอบต่อไป
  FIX_MISMATCH: 'fix_mismatch',         // ตรวจไม่ผ่าน → n8n แจ้งทีม
  NEEDS_MATCH: 'needs_match',           // จับคู่พนักงานไม่ได้ → ต้องเพิ่มชื่อพ้อง
  ALREADY_BILLED: 'already_billed',     // รอบนี้วางบิลไปแล้ว
};

/**
 * รับไฟล์ Timesheet เข้าระบบแบบครบวงจร — อ่าน → จับคู่ → บันทึก → คำนวณ
 *
 * นี่คือจุดที่ n8n เรียกหลังดึงไฟล์แนบจากอีเมล
 * ใช้ documentNo (เลขเอกสารจากอีเมล) เป็น primary key จึงยิงซ้ำได้ไม่เกิดข้อมูลซ้ำ
 *
 * @param {object} input
 * @param {string} input.documentNo            เลขเอกสารจากอีเมล เช่น '2026010091'
 * @param {string} [input.filePath]            path ไฟล์ (ถ้า n8n อยู่เครื่องเดียวกัน)
 * @param {string} [input.fileBase64]          ไฟล์เป็น base64 (ถ้า n8n อยู่ต่างเครื่อง)
 * @param {string} [input.fileName]
 * @param {string} [input.sourceEmailId]
 * @param {string} [input.receivedAt]          ISO datetime ที่รับอีเมล
 * @param {string} [input.approvedBy]          ผู้อนุมัติฝั่งลูกค้า
 * @param {string} [input.expectedPeriod]      'YYYY-MM'
 * @param {Function} [input.extractor]         ฟังก์ชันอ่านไฟล์ — แทนได้เพื่อทดสอบ
 */
export async function ingestTimesheet({
  documentNo,
  filePath,
  fileBase64,
  fileName = null,
  sourceEmailId = null,
  receivedAt = new Date().toISOString(),
  approvedBy = null,
  /* วันที่ลูกค้าอนุมัติ Timesheet — ถ้าไม่ส่งมาจะเดาเป็นวันที่ 28 ของรอบ
     ซึ่งเป็นค่าประมาณ ตอนป้อนด้วยมือคนอ่านวันจริงจากใบได้ ควรส่งมาให้ตรง */
  approvedAt = null,
  expectedPeriod,
  actor = 'n8n',
  extractor = extractTimesheet,
}) {
  if (!documentNo) {
    throw Object.assign(new Error('ต้องระบุ documentNo (เลขเอกสารจากอีเมล)'), { status: 400 });
  }
  if (!filePath && !fileBase64) {
    throw Object.assign(new Error('ต้องส่ง filePath หรือ fileBase64 อย่างใดอย่างหนึ่ง'), { status: 400 });
  }

  const source = fileBase64 ? Buffer.from(fileBase64, 'base64') : filePath;
  const { data, verification, usage, model } = await extractor(source, { expectedPeriod });

  logAudit({
    actor: 'llm',
    action: 'extract_timesheet',
    entityType: 'timesheet',
    entityId: documentNo,
    detail: {
      model, usage, employeeName: data.employeeName, period: data.period,
      ok: verification.ok, issues: verification.issues.length,
    },
  });

  // ── จับคู่พนักงานผ่านตารางชื่อพ้อง ──
  const employees = employeesForMatching();
  const nameMatch = matchEmployee(data.employeeName, employees);

  if (nameMatch.match === MATCH.NONE) {
    logAudit({
      actor, action: 'ingest_failed_no_match',
      entityType: 'timesheet', entityId: documentNo,
      detail: { rawName: data.employeeName, reason: nameMatch.reason },
    });
    return {
      timesheetId: null,
      created: false,
      nextAction: NEXT_ACTION.NEEDS_MATCH,
      reason: nameMatch.reason,
      extraction: data,
      verification,
      matching: { name: { raw: data.employeeName, ...nameMatch } },
    };
  }

  const employee = nameMatch.employee;
  const period = data.period;

  // ── หาสัญญาที่ครอบคลุมรอบบิลนี้ ──
  const assignment = get(
    `SELECT a.*, c.id AS contract_id FROM assignments a
       JOIN contracts c ON c.id = a.contract_id
      WHERE a.employee_id = $emp AND a.status = 'active'
        AND $first >= a.start_date AND $first <= a.end_date`,
    { emp: employee.id, first: `${period}-01` },
  );

  if (!assignment) {
    logAudit({
      actor, action: 'ingest_failed_no_contract',
      entityType: 'timesheet', entityId: documentNo,
      detail: { employeeId: employee.id, period },
    });
    return {
      timesheetId: null,
      created: false,
      nextAction: NEXT_ACTION.NEEDS_MATCH,
      reason: `${employee.nameTh} ไม่มีสัญญาที่ครอบคลุมรอบ ${period}`,
      extraction: data,
      verification,
    };
  }

  const existing = get('SELECT id, status FROM timesheets WHERE id = $id', { id: documentNo });
  if (existing?.status === 'billed') {
    return {
      timesheetId: documentNo,
      created: false,
      nextAction: NEXT_ACTION.ALREADY_BILLED,
      reason: `เอกสาร ${documentNo} วางบิลไปแล้ว ไม่เขียนทับ`,
    };
  }

  const positionCheck = checkPosition(data.position, employee);

  // ── บันทึกลงฐานข้อมูล (upsert ตาม documentNo) ──
  tx(() => {
    run('DELETE FROM leave_days WHERE timesheet_id = $id', { id: documentNo });
    run('DELETE FROM timesheet_days WHERE timesheet_id = $id', { id: documentNo });
    run('DELETE FROM timesheets WHERE id = $id', { id: documentNo });

    run(
      `INSERT INTO timesheets
         (id, contract_id, employee_id, period, source_email_id, source_file, received_at,
          approved_by, approved_at, raw_employee_name, raw_position,
          reported_workdays, reported_leave, extraction, status)
       VALUES ($id, $contract, $emp, $period, $emailId, $file, $receivedAt,
               $approvedBy, $approvedAt, $rawName, $rawPos,
               $workdays, $leave, $extraction, 'extracted')`,
      {
        id: documentNo,
        contract: assignment.contract_id,
        emp: employee.id,
        period,
        emailId: sourceEmailId,
        file: fileName ?? (typeof filePath === 'string' ? filePath : null),
        receivedAt,
        approvedBy,
        approvedAt: approvedAt ?? (data.signedByProjectManager ? `${period}-28` : null),
        rawName: data.employeeName,
        rawPos: data.position,
        workdays: data.totalWorkDays,
        leave: data.totalLeaveDays,
        extraction: JSON.stringify({
          source: 'llm',
          model,
          verification,
          positionCheck,
          notes: data.notes ?? [],
          signedByEmployee: data.signedByEmployee,
          signedByProjectManager: data.signedByProjectManager,
        }),
      },
    );

    for (const leave of data.leaveDays ?? []) {
      run(
        `INSERT INTO leave_days (timesheet_id, date, leave_type)
         VALUES ($id, $date, $type)`,
        { id: documentNo, date: leave.date, type: leave.type },
      );
    }

    // เก็บเฉพาะวันที่มีป้ายกำกับหรือมีเวลาเข้า-ออก
    for (const day of data.days ?? []) {
      if (!day.label && !day.timeIn) continue;
      run(
        `INSERT INTO timesheet_days (timesheet_id, date, time_in, time_out, label, job_desc)
         VALUES ($id, $date, $in, $out, $label, $job)`,
        {
          id: documentNo, date: day.date, in: day.timeIn, out: day.timeOut,
          label: day.label, job: day.jobDescription,
        },
      );
    }
  });

  logAudit({
    actor,
    action: existing ? 'ingest_timesheet_replaced' : 'ingest_timesheet',
    entityType: 'timesheet',
    entityId: documentNo,
    detail: {
      employeeId: employee.id, period, matchKind: nameMatch.match,
      workdays: data.totalWorkDays, leave: data.totalLeaveDays,
    },
  });

  // ── คำนวณ Manday + validate ──
  const manday = recomputeTimesheet(documentNo, { actor });
  const cycle = getCycleStatus(assignment.contract_id, period);

  let nextAction;
  if (!manday.ok) nextAction = NEXT_ACTION.FIX_MISMATCH;
  else if (cycle.complete) nextAction = NEXT_ACTION.APPROVE_CYCLE;
  else nextAction = NEXT_ACTION.WAIT_FOR_OTHERS;

  return {
    timesheetId: documentNo,
    created: !existing,
    replaced: Boolean(existing),
    nextAction,
    status: manday.status,
    contractId: assignment.contract_id,
    period,
    employee: { id: employee.id, nameTh: employee.nameTh, position: employee.invoicePosition },
    matching: {
      name: { raw: data.employeeName, kind: nameMatch.match, reason: nameMatch.reason },
      position: { raw: data.position, ...positionCheck },
    },
    verification,
    manday: {
      standardWorkingDays: manday.standardWorkingDays,
      payableDays: manday.payableDays,
      leaveCount: manday.leaveCount,
      dailyRate: manday.dailyRate,
      discount: manday.discount,
      lineAmount: manday.lineAmount,
    },
    failures: manday.checks.filter((c) => c.severity === SEVERITY.FAIL).map((c) => c.title),
    warnings: manday.checks.filter((c) => c.severity === SEVERITY.WARN).map((c) => c.title),
    cycle,
  };
}

/**
 * รอบบิลที่พร้อมวางบิล — ให้ n8n ตัวตั้งเวลาถามว่า "วันนี้ต้องวางบิลอะไร"
 * แทนที่จะให้ n8n ไปคำนวณเงื่อนไขเอง
 */
export function readyCycles() {
  const today = isoToday();
  const out = [];

  for (const contract of listContracts()) {
    for (const cycle of contractCycles(contract.id, { today })) {
      if (cycle.state !== CYCLE_STATE.READY) continue;
      const preview = previewCycleInvoice(contract.id, cycle.period);
      out.push({
        contractId: contract.id,
        period: cycle.period,
        periodLabel: cycle.periodLabel,
        customerName: contract.customer_name,
        poNo: contract.po_no,
        headcount: cycle.received,
        expectedBillDate: cycle.expectedBillDate,
        overdueToBill: cycle.overdueToBill,
        paymentAmount: preview.invoice?.totals.paymentAmount ?? null,
        blockers: preview.blockers,
        canApprove: preview.blockers.length === 0,
      });
    }
  }
  return { today, count: out.length, cycles: out };
}

export function getCycleStatus(contractId, period) {
  const expected = all(
    `SELECT a.employee_id, e.name_th FROM assignments a
       JOIN employees e ON e.id = a.employee_id
      WHERE a.contract_id = $contractId AND a.status = 'active'`,
    { contractId },
  );
  const received = all(
    `SELECT employee_id FROM timesheets WHERE contract_id = $contractId AND period = $period`,
    { contractId, period },
  );
  const receivedIds = new Set(received.map((r) => r.employee_id));

  return {
    contractId,
    period,
    expected: expected.length,
    received: received.length,
    complete: expected.length > 0 && expected.every((e) => receivedIds.has(e.employee_id)),
    missing: expected.filter((e) => !receivedIds.has(e.employee_id)).map((e) => e.name_th),
  };
}

export function rejectTimesheet(id, { actor, reason }) {
  run(
    `UPDATE timesheets SET status = 'rejected', status_reason = $reason,
            updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id = $id`,
    { id, reason },
  );
  logAudit({ actor, action: 'reject_timesheet', entityType: 'timesheet', entityId: id, detail: { reason } });
  return getTimesheet(id);
}

/**
 * ขั้นที่ 2 ของงานแบบ manual — คนอ่านผลตรวจแล้วกดยืนยันว่ายอดนี้ใช้ได้
 *
 * เครื่องตรวจ 8 เงื่อนไขได้แค่ว่า "ตัวเลขสอดคล้องกันเอง" ไม่ได้แปลว่าถูกต้องตามความจริง
 * เช่นลาแล้วไม่ได้เขียนในใบ ระบบก็มองว่าผ่าน คนที่เห็นปฏิทินเท่านั้นที่รู้
 * ตราที่ประทับผูกกับยอดชุดนั้น ถ้ายอดเปลี่ยนทีหลังตราหมดอายุเอง (ดู checkStamp)
 */
export function markTimesheetChecked(id, { actor }) {
  const sheet = getTimesheet(id);
  if (!sheet) throw Object.assign(new Error(`ไม่พบ Timesheet ${id}`), { status: 404 });

  if (!sheet.manday) {
    throw Object.assign(new Error('ยังไม่ได้คำนวณ Manday — กดคำนวณก่อนจึงจะยืนยันได้'), { status: 400 });
  }
  if (sheet.status === 'rejected') {
    throw Object.assign(new Error('ใบนี้ถูกตีกลับไปแล้ว ต้องได้ฉบับแก้ไขก่อน'), { status: 409 });
  }

  const failures = (sheet.manday.checks ?? []).filter((c) => c.severity === SEVERITY.FAIL);
  if (failures.length) {
    throw Object.assign(
      new Error(`ยังยืนยันไม่ได้ ตรวจไม่ผ่าน ${failures.length} ข้อ: ${failures.map((f) => f.title).join(' · ')}`),
      { status: 409, blockers: failures.map((f) => f.title) },
    );
  }

  logAudit({
    actor,
    action: 'human_checked',
    entityType: 'timesheet',
    entityId: id,
    detail: {
      lineAmount: sheet.manday.lineAmount,
      payableDays: sheet.manday.payableDays,
      discount: sheet.manday.discount,
      warnings: (sheet.manday.checks ?? []).filter((c) => c.severity === SEVERITY.WARN).length,
    },
  });

  return getTimesheet(id);
}

// ── รอบบิล ────────────────────────────────────────────────

export function previewCycleInvoice(contractId, period) {
  const contract = get(
    `SELECT c.*, cu.name_th AS customer_name, cu.tax_id, cu.branch,
            cu.billing_place, cu.contact_name, cu.contact_phone, cu.contact_email
       FROM contracts c JOIN customers cu ON cu.id = c.customer_id
      WHERE c.id = $contractId`,
    { contractId },
  );
  if (!contract) throw new Error(`ไม่พบสัญญา ${contractId}`);

  const sheets = all(
    `SELECT t.id FROM timesheets t
      WHERE t.contract_id = $contractId AND t.period = $period
        AND t.status IN ('verified','approved','billed')
      ORDER BY (SELECT a.monthly_rate FROM assignments a
                 WHERE a.employee_id = t.employee_id AND a.contract_id = t.contract_id) DESC`,
    { contractId, period },
  );

  if (sheets.length === 0) {
    return {
      contract,
      period,
      cycle: getCycleStatus(contractId, period),
      invoice: null,
      blockers: ['ยังไม่มี Timesheet ที่ผ่านการตรวจในรอบบิลนี้'],
    };
  }

  const entries = sheets.map(({ id }) => {
    const sheet = getTimesheet(id);
    return {
      timesheetId: id,
      employee: {
        id: sheet.employee.id,
        nameTh: sheet.employee.nameTh,
        invoicePosition: sheet.employee.invoicePosition,
        quotationNo: sheet.employee.quotationNo,
      },
      manday: sheet.manday,
      check: sheet.check,
    };
  });

  const rules = getSetting('billing_rules', {
    billOnDayOfNextMonth: 2, requireAllTimesheets: true, requireHumanCheck: true,
  });
  const billPeriod = nextPeriod(period);
  const documentDate = `${billPeriod}-${String(rules.billOnDayOfNextMonth ?? 2).padStart(2, '0')}`;

  const invoice = buildInvoice({
    period,
    documentDate,
    creditDays: contract.credit_days,
    customer: {
      name: contract.customer_name,
      taxId: contract.tax_id,
      branch: contract.branch,
    },
    entries,
    vatRate: contract.vat_rate,
    whtRate: contract.wht_rate,
  });

  const cycle = getCycleStatus(contractId, period);
  const blockers = [];
  if (rules.requireAllTimesheets && !cycle.complete) {
    blockers.push(
      `ยังได้ Timesheet ไม่ครบ (${cycle.received}/${cycle.expected}) — ${cycle.missing.join(', ')}`,
    );
  }
  for (const entry of entries) {
    for (const check of entry.manday.checks ?? []) {
      if (check.severity === SEVERITY.FAIL) {
        blockers.push(`${entry.employee.nameTh}: ${check.title}`);
      }
    }

    /* ประตูของโหมด manual — ต้องมีคนเปิดใบนั้นดูแล้วกดยืนยันก่อน
       ปิดประตูนี้ได้ด้วย billing_rules.requireHumanCheck = false เมื่อย้ายไปโหมด auto
       แล้วให้ n8n ไหลจาก /ingest → /approve ได้เองโดยไม่มีคนคั่น */
    if (rules.requireHumanCheck !== false && !entry.check?.checked) {
      blockers.push(
        entry.check?.stale
          ? `${entry.employee.nameTh}: ยอดเปลี่ยนหลังยืนยันไปแล้ว ต้องเข้าไปตรวจและยืนยันใหม่`
          : `${entry.employee.nameTh}: ยังไม่มีคนกดยืนยันผลตรวจ Timesheet`,
      );
    }
  }

  const warnings = entries.flatMap((entry) =>
    (entry.manday.checks ?? [])
      .filter((c) => c.severity === SEVERITY.WARN)
      .map((c) => ({ employee: entry.employee.nameTh, ...c })),
  );

  return {
    contract,
    period,
    periodLabel: thaiMonth(period),
    cycle,
    invoice,
    entries,
    blockers,
    warnings,
    payload: toFlowAccountPayload(invoice),
    emailDraft: buildEmailDraft({ contract, invoice }),
    existing: get(
      `SELECT id, document_no, status, created_at, email_sent_at, email_sent_by
         FROM invoices WHERE contract_id = $c AND period = $p`,
      { c: contractId, p: period },
    ),
  };
}

/**
 * ร่างอีเมลวางบิล — สร้างเป็นร่างเท่านั้น ระบบไม่ส่งเอง
 */
export function buildEmailDraft({ contract, invoice, documentNo = null }) {
  const company = getSetting('company', { nameTh: 'บริษัท ไอ แพสชั่น จำกัด' });
  const t = invoice.totals;
  const monthLabel = thaiMonth(invoice.period);

  const lines = invoice.items.map((item) => {
    const base = `  • ${item.name} (${item.employeeName}) จำนวน 1 เดือน เป็นเงิน ${money(item.pricePerUnit)} บาท`;
    if (item.discount > 0) {
      return `${base}\n    หักส่วนลดวันลา ${item.leaveCount} วัน เป็นเงิน ${money(item.discount)} บาท`;
    }
    return base;
  });

  const quotations = [...new Set(invoice.items.map((i) => i.quotationNo).filter(Boolean))];

  const body = [
    `เรียน ${contract.contact_name ?? 'ผู้ประสานงาน'}`,
    '',
    `${company.nameTh} ขอนำส่งใบแจ้งหนี้ค่าบริการพนักงาน Outsource โครงการ ${contract.project_name} ` +
      `ประจำเดือน${monthLabel} รายละเอียดดังนี้`,
    '',
    ...lines,
    '',
    `รวมหลังหักส่วนลด ${money(t.totalAfterDiscount)} บาท ` +
      `ภาษีมูลค่าเพิ่ม ${Math.round(t.vatRate * 100)}% จำนวน ${money(t.vat)} บาท ` +
      `รวมทั้งสิ้น ${money(t.grandTotal)} บาท`,
    `หักภาษี ณ ที่จ่าย ${Math.round(t.whtRate * 100)}% จำนวน ${money(t.withholdingTax)} บาท ` +
      `คงเหลือยอดรับชำระ ${money(t.paymentAmount)} บาท`,
    `กำหนดชำระภายใน ${invoice.creditDays} วัน ครบกำหนดวันที่ ${thaiDate(invoice.dueDate)}`,
    '',
    `อ้างอิงใบว่าจ้างเลขที่ ${contract.po_no}` +
      (quotations.length ? ` และใบเสนอราคาเลขที่ ${quotations.join(', ')}` : ''),
    contract.billing_place
      ? `ทั้งนี้ทางบริษัทจะนำเอกสารเข้าวางบิลที่ ${contract.billing_place} ตามรอบที่กำหนด`
      : null,
    '',
    'จึงเรียนมาเพื่อโปรดพิจารณา ขอบพระคุณเป็นอย่างสูง',
  ]
    .filter((line) => line !== null)
    .join('\n');

  return {
    to: contract.contact_email
      ? `${contract.contact_email} (${contract.contact_name ?? contract.customer_name})`
      : contract.contact_name
        ? `${contract.contact_name} — ผู้ประสานงาน (${contract.customer_name}) · ยังไม่มีอีเมลในระบบ`
        : contract.customer_name,
    cc: company.email ?? 'accounting@ipassion.co.th',
    subject:
      `วางบิลค่าบริการ ${contract.project_name} ประจำเดือน${monthLabel}` +
      (documentNo ? ` (${documentNo})` : ''),
    body,
    attachments: [
      documentNo ? `ใบแจ้งหนี้ ${documentNo}.pdf` : 'ใบแจ้งหนี้ (รอเลขจาก FlowAccount).pdf',
      ...invoice.items.map((i) => `Timesheet ${i.employeeName} ${invoice.period}.pdf`),
    ],
    note: 'ระบบสร้างเป็นร่างเท่านั้น การเซ็นเอกสารและการกดส่งยังเป็นงานของเจ้าหน้าที่',
  };
}

/**
 * ขั้นที่ 4 ของงานแบบ manual — ให้ AI เรียบเรียงอีเมลจากตัวเลขที่ระบบคำนวณไว้
 *
 * ระบบยังไม่ส่งอีเมลเอง และจะไม่ส่ง — คนคัดลอกไปส่งจากกล่องเมลตัวเอง
 * ที่นี่ทำแค่เปลี่ยนตัวเลขให้เป็นภาษาคน แล้วเก็บทับร่าง template เดิมของใบนั้น
 */
export async function draftEmailWithAi(contractId, period, { actor, drafter = draftBillingEmail } = {}) {
  const preview = previewCycleInvoice(contractId, period);
  if (!preview.invoice) {
    throw Object.assign(new Error('ยังไม่มีรายการที่วางบิลได้ในรอบนี้'), { status: 400 });
  }

  const inv = preview.invoice;
  const t = inv.totals;
  const template = preview.emailDraft;

  // เดือนก่อนหน้าไว้ให้โมเดลเทียบ — ไม่มีก็ไม่ต้องเทียบ (สั่งห้ามพูดถึงไว้ใน system prompt)
  const [py, pm] = period.split('-').map(Number);
  const prevPeriod = pm === 1 ? `${py - 1}-12` : `${py}-${String(pm - 1).padStart(2, '0')}`;
  const previous = get(
    `SELECT period, total_after_discount, discount_total, payment_amount
       FROM invoices WHERE contract_id = $c AND period = $p`,
    { c: contractId, p: prevPeriod },
  );

  const facts = {
    ผู้ส่ง: getSetting('company', {})?.nameTh ?? 'บริษัท ไอ แพสชั่น จำกัด',
    ลูกค้า: preview.contract.customer_name,
    ผู้ประสานงาน: preview.contract.contact_name ?? null,
    โครงการ: preview.contract.project_name,
    เดือนที่วางบิล: preview.periodLabel,
    ใบว่าจ้าง: preview.contract.po_no,
    สถานที่วางบิล: preview.contract.billing_place ?? null,
    วันที่เอกสาร: thaiDate(inv.documentDate),
    เครดิต: `${inv.creditDays} วัน`,
    ครบกำหนดชำระ: thaiDate(inv.dueDate),
    รายการ: inv.items.map((i) => ({
      ตำแหน่ง: i.name,
      พนักงาน: i.employeeName,
      ใบเสนอราคา: i.quotationNo,
      จำนวน: `${i.quantity} ${i.unitName}`,
      เรทต่อเดือน: i.pricePerUnit,
      วันลา: i.leaveCount,
      อัตราต่อวัน: i.dailyRate,
      ส่วนลดวันลา: i.discount,
      ยอดรายการ: i.amount,
    })),
    หมายเหตุวันลา: inv.remark || null,
    ยอดรวม: {
      รวมเป็นเงิน: t.total,
      ส่วนลดรวม: t.discountTotal,
      รวมหลังหักส่วนลด: t.totalAfterDiscount,
      [`VAT ${Math.round(t.vatRate * 100)}%`]: t.vat,
      รวมทั้งสิ้น: t.grandTotal,
      [`หัก ณ ที่จ่าย ${Math.round(t.whtRate * 100)}%`]: t.withholdingTax,
      ยอดรับชำระ: t.paymentAmount,
    },
    เดือนก่อนหน้า: previous
      ? {
          เดือน: thaiMonth(previous.period),
          รวมหลังหักส่วนลด: previous.total_after_discount,
          ส่วนลดรวม: previous.discount_total,
          ยอดรับชำระ: previous.payment_amount,
        }
      : null,
  };

  const draft = await drafter(facts);

  const merged = {
    ...template,
    subject: draft.subject,
    body: draft.body,
    highlights: draft.highlights ?? [],
    source: 'llm',
    model: draft.model,
    note: 'AI เรียบเรียงจากตัวเลขที่ระบบคำนวณ — ระบบไม่ส่งอีเมลเอง ต้องอ่านทวนก่อนคัดลอกไปส่ง',
  };

  if (preview.existing) {
    run('UPDATE invoices SET email_draft = $draft WHERE id = $id',
      { draft: JSON.stringify(merged), id: preview.existing.id });
  }

  logAudit({
    actor,
    action: 'draft_email_llm',
    entityType: 'invoice',
    entityId: preview.existing?.id ?? `${contractId}-${period}`,
    detail: { model: draft.model, usage: draft.usage, period },
  });

  return merged;
}

/**
 * อนุมัติรอบบิล → สร้างเอกสารร่างใน FlowAccount → เก็บผลและร่างอีเมล
 */
export async function approveCycle(contractId, period, { actor, flowAccount } = {}) {
  const preview = previewCycleInvoice(contractId, period);

  if (!preview.invoice) {
    throw Object.assign(new Error('ยังไม่มีรายการที่วางบิลได้ในรอบนี้'), { status: 400 });
  }
  if (preview.blockers.length > 0) {
    throw Object.assign(
      new Error(`ยังวางบิลไม่ได้: ${preview.blockers.join(' · ')}`),
      { status: 409, blockers: preview.blockers },
    );
  }
  if (preview.existing && preview.existing.status === 'sent_to_flowaccount') {
    throw Object.assign(
      new Error(`รอบบิลนี้สร้างเอกสารไปแล้ว (${preview.existing.document_no})`),
      { status: 409 },
    );
  }

  const settings = getSetting('flowaccount', { mode: 'dry-run', documentType: 'billing-note' });
  const client =
    flowAccount ??
    new FlowAccountClient({ mode: settings.mode, documentType: settings.documentType });

  const invoiceId = `INV-${contractId}-${period}`;
  const sequence =
    (get('SELECT COUNT(*) AS n FROM invoices', {})?.n ?? 0) + 6; // ใบจริงของรอบแรกคือ ...0006

  let result;
  try {
    result = await client.createDraftDocument(preview.payload, { period, sequence });
  } catch (error) {
    saveInvoice({
      invoiceId, contractId, period, preview,
      status: 'failed', actor,
      response: { error: error.message, status: error.status ?? null, body: error.body ?? null },
    });
    logAudit({
      actor, action: 'flowaccount_create_failed',
      entityType: 'invoice', entityId: invoiceId,
      detail: { message: error.message, status: error.status ?? null },
    });
    throw error;
  }

  const emailDraft = buildEmailDraft({
    contract: preview.contract,
    invoice: preview.invoice,
    documentNo: result.documentNo,
  });

  saveInvoice({
    invoiceId, contractId, period, preview,
    status: 'sent_to_flowaccount', actor,
    documentNo: result.documentNo,
    response: result,
    emailDraft,
  });

  logAudit({
    actor,
    action: 'approve_cycle',
    entityType: 'invoice',
    entityId: invoiceId,
    detail: {
      period,
      documentNo: result.documentNo,
      mode: result.mode,
      paymentAmount: preview.invoice.totals.paymentAmount,
    },
  });

  return {
    invoiceId,
    documentNo: result.documentNo,
    mode: result.mode,
    note: result.note ?? null,
    invoice: preview.invoice,
    emailDraft,
  };
}

function saveInvoice({
  invoiceId, contractId, period, preview, status, actor,
  documentNo = null, response = null, emailDraft = null,
}) {
  const t = preview.invoice.totals;

  tx(() => {
    run('DELETE FROM invoice_items WHERE invoice_id = $id', { id: invoiceId });
    run('DELETE FROM invoices WHERE id = $id', { id: invoiceId });

    run(
      `INSERT INTO invoices
         (id, contract_id, period, document_no, document_date, due_date,
          total, discount_total, total_after_discount, vat, grand_total,
          withholding_tax, payment_amount, remark, payload, response,
          status, approved_by, approved_at, email_draft)
       VALUES ($id, $contractId, $period, $documentNo, $documentDate, $dueDate,
               $total, $discountTotal, $totalAfterDiscount, $vat, $grandTotal,
               $withholdingTax, $paymentAmount, $remark, $payload, $response,
               $status, $actor, strftime('%Y-%m-%dT%H:%M:%SZ','now'), $emailDraft)`,
      {
        id: invoiceId,
        contractId,
        period,
        documentNo,
        documentDate: preview.invoice.documentDate,
        dueDate: preview.invoice.dueDate,
        total: t.total,
        discountTotal: t.discountTotal,
        totalAfterDiscount: t.totalAfterDiscount,
        vat: t.vat,
        grandTotal: t.grandTotal,
        withholdingTax: t.withholdingTax,
        paymentAmount: t.paymentAmount,
        remark: preview.invoice.remark,
        payload: JSON.stringify(preview.payload),
        response: response ? JSON.stringify(response) : null,
        status,
        actor: actor ?? 'system',
        emailDraft: emailDraft ? JSON.stringify(emailDraft) : null,
      },
    );

    for (const [index, item] of preview.invoice.items.entries()) {
      run(
        `INSERT INTO invoice_items
           (invoice_id, seq, employee_id, timesheet_id, name, description,
            quantity, unit_name, price_per_unit, discount, amount)
         VALUES ($invoiceId, $seq, $employeeId, $timesheetId, $name, $description,
                 $quantity, $unitName, $pricePerUnit, $discount, $amount)`,
        {
          invoiceId,
          seq: index + 1,
          employeeId: item.employeeId,
          timesheetId: preview.entries[index]?.timesheetId ?? null,
          name: item.name,
          description: item.description,
          quantity: item.quantity,
          unitName: item.unitName,
          pricePerUnit: item.pricePerUnit,
          discount: item.discount,
          amount: item.amount,
        },
      );
    }

    if (status === 'sent_to_flowaccount') {
      for (const entry of preview.entries) {
        run(
          `UPDATE timesheets SET status = 'billed', updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now')
            WHERE id = $id`,
          { id: entry.timesheetId },
        );
      }
    }
  });
}


// ── ภาพรวม ────────────────────────────────────────────────

/** ไล่เดือนตั้งแต่ต้นสัญญาถึงสิ้นสัญญา: '2026-01' … '2026-06' */
function enumeratePeriods(startIso, endIso) {
  const out = [];
  let [year, month] = startIso.split('-').map(Number);
  const [endYear, endMonth] = endIso.split('-').map(Number);
  while (year < endYear || (year === endYear && month <= endMonth)) {
    out.push(`${year}-${String(month).padStart(2, '0')}`);
    month += 1;
    if (month > 12) { month = 1; year += 1; }
  }
  return out;
}

export const CYCLE_STATE = {
  AWAITING: 'awaiting',   // ยังไม่ได้ Timesheet เลย — ต้องตามทวงลูกค้า
  PARTIAL: 'partial',     // ได้บางคน ยังไม่ครบ
  MISMATCH: 'mismatch',   // มีรายการที่ข้อมูลไม่ตรง
  CHECKING: 'checking',   // ครบและเครื่องตรวจผ่าน แต่ยังไม่มีคนกดยืนยัน (เฉพาะโหมด manual)
  READY: 'ready',         // ครบ ตรวจผ่าน และคนยืนยันแล้ว — รออนุมัติ
  BILLED: 'billed',       // สร้างเอกสารใน FlowAccount แล้ว
};

const CYCLE_STATE_LABEL = {
  awaiting: 'รอ Timesheet',
  partial: 'ได้ไม่ครบ',
  mismatch: 'ข้อมูลไม่ตรง',
  checking: 'รอคนตรวจ',
  ready: 'รออนุมัติ',
  billed: 'วางบิลแล้ว',
};

/**
 * กางทุกเดือนตามสัญญา ไม่ใช่แสดงเฉพาะเดือนที่มี Timesheet เข้ามาแล้ว
 * เดือนที่ยังไม่ได้ Timesheet คือรายการที่ back-office ต้องตามทวง
 */
export function contractCycles(contractId, { today = isoToday() } = {}) {
  const contract = get(
    `SELECT c.*, cu.name_th AS customer_name FROM contracts c
       JOIN customers cu ON cu.id = c.customer_id WHERE c.id = $id`,
    { id: contractId },
  );
  if (!contract) return [];

  const rules = getSetting('billing_rules', { billOnDayOfNextMonth: 2, requireHumanCheck: true });

  return enumeratePeriods(contract.start_date, contract.end_date).map((period) => {
    const cycle = getCycleStatus(contractId, period);
    const sheets = all(
      `SELECT t.id, t.status, t.computed, ${CHECK_COLUMNS}
         FROM timesheets t WHERE t.contract_id = $c AND t.period = $p`,
      { c: contractId, p: period },
    );
    const unchecked = sheets.filter((s) => {
      const computed = s.computed ? JSON.parse(s.computed) : null;
      return !checkStamp(s, computed).checked;
    }).length;
    const invoice = get(
      `SELECT document_no, status, payment_amount, document_date, due_date
         FROM invoices WHERE contract_id = $c AND period = $p`,
      { c: contractId, p: period },
    );

    let state;
    if (invoice?.status === 'sent_to_flowaccount') state = CYCLE_STATE.BILLED;
    else if (sheets.some((s) => s.status === 'mismatch')) state = CYCLE_STATE.MISMATCH;
    else if (sheets.length === 0) state = CYCLE_STATE.AWAITING;
    else if (!cycle.complete) state = CYCLE_STATE.PARTIAL;
    else if (rules.requireHumanCheck !== false && unchecked > 0) state = CYCLE_STATE.CHECKING;
    else state = CYCLE_STATE.READY;

    // มูลค่าที่คาดว่าจะวางบิลได้ ใช้ผลคำนวณจริงถ้ามี ไม่มีก็ใช้เรทเต็มตามสัญญา
    const computedValue = sheets.reduce((sum, s) => {
      const c = s.computed ? JSON.parse(s.computed) : null;
      return sum + (c?.lineAmount ?? 0);
    }, 0);

    const expectedBillDate = `${nextPeriod(period)}-${String(rules.billOnDayOfNextMonth ?? 2).padStart(2, '0')}`;
    const dueDate = invoice?.due_date ?? null;

    return {
      contractId,
      poNo: contract.po_no,
      customerName: contract.customer_name,
      period,
      periodLabel: thaiMonth(period),
      state,
      stateLabel: CYCLE_STATE_LABEL[state],
      expected: cycle.expected,
      received: cycle.received,
      missing: cycle.missing,
      uncheckedCount: unchecked,
      expectedBillDate,
      overdueToBill: state !== CYCLE_STATE.BILLED && expectedBillDate < today,
      invoiceNo: invoice?.document_no ?? null,
      documentDate: invoice?.document_date ?? null,
      dueDate,
      overduePayment: Boolean(dueDate && dueDate < today && state === CYCLE_STATE.BILLED),
      paymentAmount: invoice?.payment_amount ?? null,
      value: state === CYCLE_STATE.BILLED ? invoice.payment_amount : computedValue || null,
    };
  });
}

function isoToday() {
  return new Date().toISOString().slice(0, 10);
}

/* ── แดชบอร์ด ────────────────────────────────────────────────
   หน้ารายงานภาพรวม ไม่ใช่ขั้นตอนการทำงาน — เก็บไว้เพราะใช้ดูข้อมูลรวมได้
   ทุกตัวเลขในนี้คำนวณจากสถานะจริงในฐานข้อมูล ไม่มีอะไรที่ระบบไม่ได้บันทึกเอง
   โดยเฉพาะ **ไม่มีเรื่องการรับชำระเงิน** เพราะระบบนี้ไม่ได้บันทึกการรับเงิน
   สถานะชำระจริงอยู่ที่ FlowAccount ถ้าเอามาแสดงจะกลายเป็นตัวเลขที่ทำให้เข้าใจผิด */

const THAI_MONTH_SHORT = [
  'ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.',
  'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.',
];

/** ใบแจ้งหนี้ที่ระบบสร้างไว้ — ใช้ในแดชบอร์ดเท่านั้น ไม่มี endpoint เพราะทะเบียนตัวจริงอยู่ที่ FlowAccount */
function invoiceRows() {
  return all(`
    SELECT i.*, c.po_no, cu.name_th AS customer_name
      FROM invoices i
      JOIN contracts c ON c.id = i.contract_id
      JOIN customers cu ON cu.id = c.customer_id
     ORDER BY i.document_date DESC
  `);
}

/**
 * มูลค่ารายเดือนตลอดสัญญา — ใช้วาดกราฟแท่ง
 * planned = เรทรวมตามสัญญา · billed = ที่วางบิลจริง · pending = ที่ตรวจผ่านแต่ยังไม่ได้วางบิล
 */
export function monthlySeries() {
  const out = [];
  for (const contract of listContracts()) {
    for (const cycle of contractCycles(contract.id)) {
      const sheets = all(
        `SELECT computed FROM timesheets
          WHERE contract_id = $c AND period = $p AND status = 'verified'`,
        { c: contract.id, p: cycle.period },
      );
      const pending = round2(
        sheets.reduce((sum, s) => {
          const computed = s.computed ? JSON.parse(s.computed) : null;
          return sum + (computed?.lineAmount ?? 0);
        }, 0),
      );

      out.push({
        contractId: contract.id,
        period: cycle.period,
        periodLabel: thaiMonth(cycle.period),
        monthShort: THAI_MONTH_SHORT[Number(cycle.period.split('-')[1]) - 1],
        planned: round2(contract.monthly_total ?? 0),
        billed: cycle.state === CYCLE_STATE.BILLED ? round2(cycle.paymentAmount ?? 0) : 0,
        pending,
        state: cycle.state,
      });
    }
  }
  return out;
}

/** เปอร์เซ็นต์เปลี่ยนแปลงเทียบเดือนก่อน — null เมื่อเทียบไม่ได้ */
function trend(current, previous) {
  if (previous === null || previous === undefined || previous === 0) return null;
  return Math.round(((current - previous) / previous) * 1000) / 10;
}

export function dashboard() {
  const today = isoToday();
  const sheets = listTimesheets();
  const invoices = invoiceRows();

  const byStatus = {};
  for (const sheet of sheets) byStatus[sheet.status] = (byStatus[sheet.status] ?? 0) + 1;

  const waitingCheck = sheets.filter((s) => s.status === 'verified' && !s.check?.checked);
  const checkedWaitingBill = sheets.filter(
    (s) => s.status === 'verified' && s.check?.checked,
  );
  const leaveDeduction = sheets.reduce((sum, s) => sum + (s.discount ?? 0), 0);

  const contracts = listContracts().map((contract) => {
    const periods = contractCycles(contract.id, { today });
    const billed = periods.filter((p) => p.state === CYCLE_STATE.BILLED);
    const contractValue = round2((contract.monthly_total ?? 0) * periods.length);
    const billedValue = round2(billed.reduce((sum, p) => sum + (p.paymentAmount ?? 0), 0));

    return {
      id: contract.id,
      poNo: contract.po_no,
      customerName: contract.customer_name,
      projectName: contract.project_name,
      startDate: contract.start_date,
      endDate: contract.end_date,
      creditDays: contract.credit_days,
      headcount: contract.headcount,
      monthlyTotal: contract.monthly_total,
      monthsTotal: periods.length,
      monthsBilled: billed.length,
      contractValue,
      billedValue,
      remainingValue: round2(contractValue - billedValue),
      progress: periods.length ? Math.round((billed.length / periods.length) * 100) : 0,
      periods,
    };
  });

  const series = monthlySeries();
  const billedSeries = series.filter((s) => s.billed > 0);
  const latest = billedSeries[billedSeries.length - 1] ?? null;
  const previous = billedSeries[billedSeries.length - 2] ?? null;

  const allPeriods = contracts.flatMap((c) => c.periods);
  const toChase = allPeriods
    .filter((p) => p.state === CYCLE_STATE.AWAITING || p.state === CYCLE_STATE.PARTIAL)
    .sort((a, b) => a.period.localeCompare(b.period));

  /* งานที่ต้องทำ — เรียงตามลำดับขั้นที่คนต้องเดิน ไม่ใช่ตามความรุนแรง
     สร้างจากสถานะจริงตรงนี้เลย ไม่ต้องมีตัวคำนวณแจ้งเตือนแยกอีกชุด */
  const tasks = [
    ...sheets
      .filter((s) => s.status === 'mismatch')
      .map((s) => ({
        step: 2, level: 'critical',
        title: 'Timesheet ตรวจไม่ผ่าน',
        detail: `${s.employee.nameTh} รอบ ${s.periodLabel} — ${s.statusReason ?? 'ข้อมูลไม่ตรงปฏิทิน'}`,
        link: { view: 'detail', id: s.id },
      })),
    ...waitingCheck.map((s) => ({
      step: 2, level: 'warn',
      title: 'รอคนกดยืนยันผลตรวจ',
      detail: `${s.employee.nameTh} รอบ ${s.periodLabel} — ${money(s.lineAmount)} บาท`,
      link: { view: 'detail', id: s.id },
    })),
    ...allPeriods
      .filter((p) => p.state === CYCLE_STATE.READY)
      .map((p) => ({
        step: 3, level: 'info',
        title: 'รอบบิลพร้อมอนุมัติ',
        detail: `รอบ ${p.periodLabel} ตรวจและยืนยันครบ ${p.received}/${p.expected} คนแล้ว`,
        link: { view: 'cycle', contractId: p.contractId, period: p.period },
      })),
    ...toChase
      .filter((p) => p.overdueToBill)
      .map((p) => ({
        step: 1, level: 'warn',
        title: 'ยังไม่ได้ Timesheet',
        detail: `รอบ ${p.periodLabel} ควรวางบิล ${thaiDate(p.expectedBillDate)} — รอ ${p.missing.join(', ')}`,
        link: { view: 'cycle', contractId: p.contractId, period: p.period },
      })),
  ];
  /* จงใจไม่เรียงตามเลขขั้น — เรียงตาม "อะไรที่ลงมือทำที่นี่ได้เลย" ก่อน
     การตามทวง Timesheet (ขั้น 1) เป็นงานที่ต้องไปทำนอกระบบ จึงอยู่ท้ายสุด
     ไม่งั้นสัญญาที่ยังไม่ถึงรอบจะดันงานจริงตกจอไปหมด */

  return {
    today,
    counts: {
      total: sheets.length,
      waitingCheck: waitingCheck.length,
      readyToBill: checkedWaitingBill.length,
      mismatch: byStatus.mismatch ?? 0,
      billed: byStatus.billed ?? 0,
      rejected: byStatus.rejected ?? 0,
    },
    waitingCheckValue: round2(waitingCheck.reduce((sum, s) => sum + (s.lineAmount ?? 0), 0)),
    readyValue: round2(checkedWaitingBill.reduce((sum, s) => sum + (s.lineAmount ?? 0), 0)),
    leaveDeduction: round2(leaveDeduction),
    invoiceCount: invoices.length,
    billedAmount: round2(
      invoices
        .filter((i) => i.status === 'sent_to_flowaccount')
        .reduce((sum, i) => sum + i.payment_amount, 0),
    ),
    series,
    trends: {
      billed: trend(latest?.billed ?? 0, previous?.billed ?? null),
      latestPeriodLabel: latest?.periodLabel ?? null,
      previousPeriodLabel: previous?.periodLabel ?? null,
    },
    contracts,
    toChase,
    tasks,
    cycles: allPeriods.sort((a, b) => b.period.localeCompare(a.period)),
    recentAudit: all(
      'SELECT at, actor, action, entity_type, entity_id FROM audit_log ORDER BY id DESC LIMIT 12',
    ),
  };
}

/* ── ทะเบียนใบแจ้งหนี้ + สายกิจกรรมของกระดิ่ง ─────────────────
   ทั้งสองอย่างเป็นของ "ไว้ดู" ไม่ใช่ขั้นตอนงาน แต่มีคนใช้จริงจึงเก็บไว้
   กระดิ่งตอบคำถาม "อะไรเพิ่งเกิดขึ้น" ส่วนการ์ดงานที่ต้องทำบนแดชบอร์ด
   ตอบ "อะไรยังค้าง" — คนละคำถาม จึงไม่ใช่ของซ้ำกัน */

export function listInvoices() {
  return all(`
    SELECT i.*, c.po_no, c.project_name, cu.name_th AS customer_name
      FROM invoices i
      JOIN contracts c ON c.id = i.contract_id
      JOIN customers cu ON cu.id = c.customer_id
     ORDER BY i.document_date DESC
  `).map((row) => ({
    ...row,
    periodLabel: thaiMonth(row.period),
    response: row.response ? JSON.parse(row.response) : null,
    emailDraft: row.email_draft ? JSON.parse(row.email_draft) : null,
  }));
}

export function auditLog({ limit = 200 } = {}) {
  return all(
    'SELECT id, at, actor, action, entity_type, entity_id, detail FROM audit_log ORDER BY id DESC LIMIT $limit',
    { limit },
  ).map((a) => ({ ...a, detail: a.detail ? JSON.parse(a.detail) : null }));
}

const ACTOR_LABEL = { llm: 'AI', n8n: 'n8n', system: 'ระบบ' };

/** เหตุการณ์ที่ไม่ต้องแจ้ง — เป็นการตั้งค่าระบบ ไม่ใช่งานประจำวัน */
const FEED_SKIP = new Set(['seed']);

const FEED_SHAPE = {
  read_timesheet_file: (d) => ({
    level: 'info', title: 'AI อ่านไฟล์ที่อัปโหลด',
    detail: `${d?.employeeName ?? '—'}${d?.period ? ` · รอบ ${thaiMonth(d.period)}` : ''} — ยังไม่บันทึก รอคนยืนยัน`,
    link: null,
  }),
  extract_timesheet: (d, id) => ({
    level: 'info', title: 'AI อ่านไฟล์ Timesheet เสร็จ',
    detail: `${d?.employeeName ?? id}${d?.period ? ` · รอบ ${thaiMonth(d.period)}` : ''}`,
    link: { view: 'detail', id },
  }),
  ingest_timesheet: (d, id) => ({
    level: 'info', title: 'รับ Timesheet เข้าระบบ',
    detail: `เลขที่ ${id}${d?.period ? ` · รอบ ${thaiMonth(d.period)}` : ''}`,
    link: { view: 'detail', id },
  }),
  ingest_timesheet_replaced: (d, id) => ({
    level: 'info', title: 'รับ Timesheet ฉบับแก้ไข',
    detail: `เลขที่ ${id} ถูกส่งมาใหม่ ระบบเขียนทับและคำนวณใหม่แล้ว`,
    link: { view: 'detail', id },
  }),
  human_checked: (d, id) => ({
    level: 'ok', title: 'คนยืนยันผลตรวจแล้ว',
    detail: `เลขที่ ${id} · วางบิลได้ ${d?.payableDays ?? '—'} วัน · ${money(d?.lineAmount ?? 0)} บาท`,
    link: { view: 'detail', id },
  }),
  recompute_manday: (d, id) => ({
    level: 'info', title: 'คำนวณ Manday ใหม่',
    detail: `เลขที่ ${id} · วางบิลได้ ${d?.payableDays ?? '—'} วัน` +
            `${d?.discount ? ` · ส่วนลด ${money(d.discount)} บาท` : ''}`,
    link: { view: 'detail', id },
  }),
  reject_timesheet: (d, id) => ({
    level: 'warn', title: 'ตีกลับ Timesheet ให้แก้',
    detail: `เลขที่ ${id}${d?.reason ? ` · ${d.reason}` : ''}`,
    link: { view: 'detail', id },
  }),
  approve_cycle: (d) => ({
    level: 'ok', title: 'สร้างร่างใบแจ้งหนี้ใน FlowAccount',
    detail: `${d?.documentNo ?? 'ยังไม่ได้เลขเอกสาร'}` +
            `${d?.period ? ` · รอบ ${thaiMonth(d.period)}` : ''}` +
            `${d?.paymentAmount ? ` · ${money(d.paymentAmount)} บาท` : ''}` +
            `${d?.mode === 'dry-run' ? ' (dry-run)' : ''}`,
    link: d?.contractId && d?.period
      ? { view: 'cycle', contractId: d.contractId, period: d.period } : null,
  }),
  draft_email_llm: (d) => ({
    level: 'info', title: 'AI ร่างอีเมลวางบิล',
    detail: `รอบ ${d?.period ? thaiMonth(d.period) : '—'} · ยังไม่ส่ง รออ่านทวนก่อนคัดลอก`,
    link: null,
  }),
  invoice_email_sent: (d, id) => ({
    level: 'ok', title: 'ปิดงาน — ส่งเมลวางบิลแล้ว',
    detail: `${d?.documentNo ?? id}`,
    link: null,
  }),
  ingest_failed_no_match: (d, id) => ({
    level: 'critical', title: 'รับ Timesheet ไม่ได้ — จับคู่ชื่อไม่ได้',
    detail: `เลขที่ ${id} · ชื่อในไฟล์ "${d?.rawName ?? '—'}" ไม่ตรงกับใครในระบบ ต้องไปเพิ่มชื่อพ้อง`,
    link: null,
  }),
  ingest_failed_no_contract: (d, id) => ({
    level: 'critical', title: 'รับ Timesheet ไม่ได้ — ไม่พบสัญญา',
    detail: `เลขที่ ${id} · ไม่มีสัญญาที่ครอบรอบ ${d?.period ? thaiMonth(d.period) : 'นี้'}`,
    link: null,
  }),
  flowaccount_create_failed: (d, id) => ({
    level: 'critical', title: 'สร้างเอกสารใน FlowAccount ไม่สำเร็จ',
    detail: `${id}${d?.message ? ` · ${d.message}` : ''}`,
    link: null,
  }),
};

export function activityFeed({ limit = 30 } = {}) {
  const rows = auditLog({ limit: limit * 3 })
    .filter((r) => !FEED_SKIP.has(r.action))
    .slice(0, limit);

  const items = rows.map((r) => {
    const shape = FEED_SHAPE[r.action];
    const base = shape
      ? shape(r.detail, r.entity_id)
      : { level: 'info', title: r.action, detail: r.entity_id ?? '', link: null };
    return { ...base, id: r.id, at: r.at, by: ACTOR_LABEL[r.actor] ?? r.actor };
  });

  return {
    items,
    latestAt: items[0]?.at ?? null,
    counts: { total: items.length, critical: items.filter((i) => i.level === 'critical').length },
  };
}

export function settingsSnapshot() {
  return {
    company: getSetting('company'),
    emailIngest: getSetting('email_ingest'),
    flowaccount: getSetting('flowaccount'),
    billingRules: getSetting('billing_rules'),
    holidays: listHolidays(),
    env: {
      flowAccountMode: process.env.FLOWACCOUNT_MODE ?? 'dry-run',
      hasFlowAccountCredentials: Boolean(
        process.env.FLOWACCOUNT_CLIENT_ID && process.env.FLOWACCOUNT_CLIENT_SECRET,
      ),
      hasAnthropicKey: Boolean(process.env.ANTHROPIC_API_KEY),
      claudeModel: process.env.CLAUDE_MODEL ?? 'claude-opus-5',
      hasGmail: hasGmailCredentials(),
      gmailQuery: DEFAULT_GMAIL_QUERY,
    },
  };
}

export function listEmployees() {
  const employees = all(`
    SELECT e.id, e.name_th, e.name_en, e.invoice_position,
           a.id AS assignment_id,
           a.monthly_rate, a.quotation_no, a.start_date, a.end_date, a.status,
           c.po_no, c.contract_no, cu.name_th AS customer_name
      FROM employees e
      LEFT JOIN assignments a ON a.employee_id = e.id
      LEFT JOIN contracts  c  ON c.id = a.contract_id
      LEFT JOIN customers  cu ON cu.id = c.customer_id
     ORDER BY a.monthly_rate DESC
  `);

  const aliases = all('SELECT employee_id, kind, alias, source FROM employee_aliases');

  return employees.map((employee) => ({
    ...employee,
    nameAliases: aliases
      .filter((a) => a.employee_id === employee.id && a.kind === 'name')
      .map((a) => ({ alias: a.alias, source: a.source })),
    positionAliases: aliases
      .filter((a) => a.employee_id === employee.id && a.kind === 'position')
      .map((a) => ({ alias: a.alias, source: a.source })),
  }));
}

export function listHolidays(year) {
  const rows = year
    ? all('SELECT * FROM holidays WHERE date LIKE $like ORDER BY date', { like: `${year}-%` })
    : all('SELECT * FROM holidays ORDER BY date');
  return rows;
}

/**
 * รอบบิลทุกเดือนตามสัญญา — ข้อมูลที่หน้า "รอบบิล" ต้องใช้
 *
 * แยกออกมาจาก dashboard() เดิมที่ถูกลบทิ้ง เพราะแดชบอร์ดเป็นหน้ารายงาน
 * ที่ไม่มีอยู่ในเอกสารออกแบบ ส่วนรอบบิลคือจุดที่เอกสารข้อ 4.2 บังคับให้มีคนอนุมัติ
 */
export function billingCycles() {
  const today = isoToday();

  const contracts = listContracts().map((contract) => {
    const periods = contractCycles(contract.id, { today });
    const billed = periods.filter((p) => p.state === CYCLE_STATE.BILLED);
    const contractValue = round2((contract.monthly_total ?? 0) * periods.length);
    const billedValue = round2(billed.reduce((sum, p) => sum + (p.paymentAmount ?? 0), 0));

    return {
      id: contract.id,
      poNo: contract.po_no,
      contractNo: contract.contract_no,
      customerName: contract.customer_name,
      projectName: contract.project_name,
      startDate: contract.start_date,
      endDate: contract.end_date,
      creditDays: contract.credit_days,
      headcount: contract.headcount,
      monthlyTotal: contract.monthly_total,
      monthsTotal: periods.length,
      /* หัวการ์ดของหน้ารอบบิลใช้สี่ค่านี้ — ตอนแยกฟังก์ชันนี้ออกมาจาก dashboard()
         ผมตัดออกไปด้วย ทำให้หน้าขึ้น undefined ต้องอยู่ครบเสมอ */
      monthsBilled: billed.length,
      contractValue,
      billedValue,
      remainingValue: round2(contractValue - billedValue),
      progress: periods.length ? Math.round((billed.length / periods.length) * 100) : 0,
      periods,
    };
  });

  return {
    contracts,
    cycles: contracts
      .flatMap((c) => c.periods)
      .sort((a, b) => b.period.localeCompare(a.period)),
  };
}

export function pulse() {
  const sheets = listTimesheets();
  const byStatus = {};
  for (const sheet of sheets) {
    byStatus[sheet.status] = (byStatus[sheet.status] ?? 0) + 1;
  }

  /* ป้ายบนเมนูบอกจำนวนงานค้างของแต่ละขั้น ตามลำดับที่คนต้องเดิน
     ขั้น 2 = ใบที่ยังไม่มีคนกดยืนยัน (รวมของที่ตรวจไม่ผ่านและของที่ค้างกลางทาง)
     ขั้น 3 = รอบบิลที่ครบและยืนยันแล้ว เหลือแค่กดอนุมัติ */
  const waitingCheck = sheets.filter(
    (s) => s.status === 'verified' && !s.check?.checked,
  ).length;

  let readyToApprove = 0;
  for (const contract of listContracts()) {
    for (const cycle of contractCycles(contract.id)) {
      if (cycle.state === CYCLE_STATE.READY) readyToApprove += 1;
    }
  }

  return {
    needsAction: NEEDS_ACTION.reduce((sum, k) => sum + (byStatus[k] ?? 0), 0) + waitingCheck,
    waitingCheck,
    readyToApprove,
    /* สายกิจกรรมของกระดิ่ง — ติดมากับ pulse เพราะหน้าจอถามอยู่แล้วทุก 60 วิ
       ป้ายบนกระดิ่งจึงขึ้นเองโดยไม่ต้องยิงถามเพิ่มอีกเส้น */
    feed: activityFeed({ limit: 25 }),
    /* คนที่กดอนุมัติต้องรู้ว่านี่ยิงเข้า FlowAccount จริงหรือแค่ dry-run
       ติดมากับ pulse เพราะถามอยู่แล้ว ไม่ต้องมี endpoint หรือหน้าตั้งค่าเพิ่ม */
    flowAccountMode: process.env.FLOWACCOUNT_MODE ?? 'dry-run',
    manualMode: getSetting('billing_rules', {})?.requireHumanCheck !== false,
    /* ชื่อที่จะถูกบันทึกว่าเป็นคนกด — ต้องโชว์บนหน้าจอให้ตรงกับที่บันทึกจริง
       ไม่งั้นหน้าจอขึ้นชื่อหนึ่ง แต่ audit log เก็บอีกชื่อหนึ่ง */
    actor: process.env.ACTOR?.trim() || 'ยังไม่ได้ระบุผู้ใช้',
  };
}



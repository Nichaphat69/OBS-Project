/**
 * ใส่ข้อมูลเริ่มต้นจากเอกสารจริงของโครงการ Outsource for BAU Project
 *
 * แหล่งที่มาของทุกค่าในไฟล์นี้:
 *   ใบว่าจ้าง 26/B0113 (14 Jan 2026)
 *   ใบเสนอราคา QT2025120005 (04/12/2025) และ QT2025110015
 *   Timesheet-Pongpun_012026.pdf
 *   ใบแจ้งหนี้ INV2026020006 (02/02/2026)
 *
 * รัน:  npm run seed          เพิ่มข้อมูลถ้ายังไม่มี
 *       npm run reset         ล้างข้อมูลแล้วใส่ใหม่
 */

import '../env.js';
import { getDb, run, get, setSetting, logAudit, closeDb, DB_PATH } from './index.js';
import { calculateManday, DIVISOR_MODE } from '../domain/manday.js';

const RESET = process.argv.includes('--reset');

const CUSTOMER = {
  id: 'CUS-TLI',
  name_th: 'บริษัท ไทยประกันชีวิต จำกัด (มหาชน)',
  name_en: 'ThaiLife Insurance Public Co., Ltd.',
  tax_id: '0107555000104',
  branch: 'สำนักงานใหญ่',
  address: '123 อาคารไทยประกันชีวิต 1 ถนนรัชดาภิเษก แขวงดินแดง เขตดินแดง กรุงเทพมหานคร 10400',
  credit_days: 30,
  billing_place: 'อาคารไทยประกันชีวิต 1/1 สายงานการบริหารและการวางแผนเชิงกลยุทธ์เทคโนโลยีสารสนเทศ ชั้น 6',
  contact_name: 'คุณธัญวรัตน์',
  contact_phone: '02-247-0247 ต่อ 04699',
  contact_email: null,
};

const CONTRACT = {
  id: 'CT-26B0113',
  customer_id: CUSTOMER.id,
  po_no: '26/B0113',
  contract_no: 'จซ.002/2569',
  project_name: 'Outsource for BAU Project',
  po_date: '2026-01-14',
  start_date: '2026-01-01',
  end_date: '2026-06-30',
  credit_days: 30,
  divisor_mode: DIVISOR_MODE.FIXED,
  divisor_value: 20,
  vat_rate: 0.07,
  wht_rate: 0.03,
  status: 'active',
};

const EMPLOYEES = [
  {
    id: 'EMP-0042',
    name_th: 'พงศ์พันธ์ มามาก',
    name_en: 'Pongpun Mamak',
    invoice_position: 'Developer',
    aliases: {
      name: [
        { alias: 'Pongpun Mamark', source: 'เอกสาร workflow design' },
        { alias: 'พงษ์พันธ์ มามาก', source: 'การสะกดที่พบบ่อย' },
      ],
      position: [
        { alias: 'Dev', source: 'ใบว่าจ้าง 26/B0113' },
        { alias: 'Java Programmer', source: 'Timesheet-Pongpun_012026' },
      ],
    },
    assignment: {
      id: 'ASG-0042-26B0113',
      quotation_no: 'QT2025120005',
      monthly_rate: 52943.93,
    },
  },
  {
    id: 'EMP-0018',
    name_th: 'สุนีย์ มณีเกษมสุข',
    name_en: 'Sunee Maneekasemsuk',
    invoice_position: 'Senior Project Manager',
    aliases: {
      name: [{ alias: 'Sunee Maneekasemsook', source: 'การสะกดที่พบบ่อย' }],
      position: [
        { alias: 'PM', source: 'ใบว่าจ้าง 26/B0113' },
        { alias: 'Senior PM', source: 'เอกสาร workflow design' },
      ],
    },
    assignment: {
      id: 'ASG-0018-26B0113',
      quotation_no: 'QT2025110015',
      monthly_rate: 123420.0,
    },
  },
];

/**
 * วันหยุดปี 2026
 * 1–2 ม.ค. ยืนยันจาก Timesheet จริง — ทำให้เดือน ม.ค. มีวันทำงาน 20 วัน
 * ที่เหลือเป็นวันหยุดราชการตามปกติ ต้องยืนยันกับปฏิทินบริษัทลูกค้าอีกครั้ง
 */
const HOLIDAYS_2026 = [
  ['2026-01-01', 'วันขึ้นปีใหม่', true],
  ['2026-01-02', 'วันหยุดพิเศษ', true],
  ['2026-03-03', 'วันมาฆบูชา', false],
  ['2026-04-06', 'วันจักรี', false],
  ['2026-04-13', 'วันสงกรานต์', false],
  ['2026-04-14', 'วันสงกรานต์', false],
  ['2026-04-15', 'วันสงกรานต์', false],
  ['2026-05-01', 'วันแรงงานแห่งชาติ', false],
  ['2026-05-04', 'วันฉัตรมงคล', false],
  ['2026-06-01', 'วันวิสาขบูชา', false],
  ['2026-06-03', 'วันเฉลิมพระชนมพรรษาสมเด็จพระนางเจ้าฯ พระบรมราชินี', false],
];

const TIMESHEET_DEV = {
  id: '2026010091',
  contract_id: CONTRACT.id,
  employee_id: 'EMP-0042',
  period: '2026-01',
  source_email_id: 'tli-approval-2026010091',
  source_file: 'Timesheet-Pongpun_012026.pdf',
  received_at: '2026-02-01T08:42:00+07:00',
  approved_by: 'Project Manager (TLI)',
  approved_at: '2026-01-31',
  raw_employee_name: 'Pongpun Mamak',
  raw_position: 'Java Programmer',
  reported_workdays: 19,
  reported_leave: 1,
  leave: [{ date: '2026-01-29', leave_type: 'sick' }],
  /** ป้ายกำกับที่เขียนไว้ในไฟล์จริง — 31 ม.ค. เป็นวันเสาร์ แต่เขียนว่า Holiday */
  dayLabels: [
    { date: '2026-01-01', label: 'Holiday' },
    { date: '2026-01-02', label: 'Holiday' },
    { date: '2026-01-29', label: 'Sick leave' },
    { date: '2026-01-31', label: 'Holiday' },
  ],
};

const TIMESHEET_PM = {
  id: '2026010090',
  contract_id: CONTRACT.id,
  employee_id: 'EMP-0018',
  period: '2026-01',
  source_email_id: 'tli-approval-2026010090',
  source_file: 'Timesheet-Sunee_012026.pdf',
  received_at: '2026-02-01T08:41:00+07:00',
  approved_by: 'Project Manager (TLI)',
  approved_at: '2026-01-31',
  raw_employee_name: 'Sunee Maneekasemsuk',
  raw_position: 'Senior Project Manager',
  reported_workdays: 20,
  reported_leave: 0,
  leave: [],
  dayLabels: [
    { date: '2026-01-01', label: 'Holiday' },
    { date: '2026-01-02', label: 'Holiday' },
  ],
};

function seed() {
  const db = getDb();

  if (RESET) {
    for (const table of [
      'invoice_items', 'invoices', 'leave_days', 'timesheet_days', 'timesheets',
      'assignments', 'employee_aliases', 'employees', 'holidays',
      'contracts', 'customers', 'audit_log', 'settings',
    ]) {
      db.exec(`DELETE FROM ${table}`);
    }
    console.log('ล้างข้อมูลเดิมแล้ว');
  }

  if (get('SELECT id FROM customers WHERE id = $id', { id: CUSTOMER.id }) && !RESET) {
    console.log('มีข้อมูลอยู่แล้ว — ใช้ npm run reset ถ้าต้องการใส่ใหม่');
    return;
  }

  run(
    `INSERT INTO customers
       (id, name_th, name_en, tax_id, branch, address, credit_days,
        billing_place, contact_name, contact_phone, contact_email)
     VALUES ($id, $name_th, $name_en, $tax_id, $branch, $address, $credit_days,
             $billing_place, $contact_name, $contact_phone, $contact_email)`,
    CUSTOMER,
  );

  run(
    `INSERT INTO contracts
       (id, customer_id, po_no, contract_no, project_name, po_date, start_date, end_date,
        credit_days, divisor_mode, divisor_value, vat_rate, wht_rate, status)
     VALUES ($id, $customer_id, $po_no, $contract_no, $project_name, $po_date,
             $start_date, $end_date, $credit_days, $divisor_mode, $divisor_value,
             $vat_rate, $wht_rate, $status)`,
    CONTRACT,
  );

  for (const employee of EMPLOYEES) {
    run(
      `INSERT INTO employees (id, name_th, name_en, invoice_position)
       VALUES ($id, $name_th, $name_en, $invoice_position)`,
      {
        id: employee.id,
        name_th: employee.name_th,
        name_en: employee.name_en,
        invoice_position: employee.invoice_position,
      },
    );

    for (const [kind, list] of Object.entries(employee.aliases)) {
      for (const { alias, source } of list) {
        run(
          `INSERT INTO employee_aliases (employee_id, kind, alias, source)
           VALUES ($employee_id, $kind, $alias, $source)`,
          { employee_id: employee.id, kind, alias, source },
        );
      }
    }

    run(
      `INSERT INTO assignments
         (id, contract_id, employee_id, quotation_no, monthly_rate, start_date, end_date, status)
       VALUES ($id, $contract_id, $employee_id, $quotation_no, $monthly_rate,
               $start_date, $end_date, 'active')`,
      {
        id: employee.assignment.id,
        contract_id: CONTRACT.id,
        employee_id: employee.id,
        quotation_no: employee.assignment.quotation_no,
        monthly_rate: employee.assignment.monthly_rate,
        start_date: CONTRACT.start_date,
        end_date: CONTRACT.end_date,
      },
    );
  }

  for (const [date, name, verified] of HOLIDAYS_2026) {
    run(
      `INSERT INTO holidays (date, name, customer_id) VALUES ($date, $name, NULL)`,
      { date, name: verified ? name : `${name} (รอยืนยันกับปฏิทินลูกค้า)` },
    );
  }

  const holidayMap = new Map(HOLIDAYS_2026.map(([date, name]) => [date, name]));

  for (const sheet of [TIMESHEET_PM, TIMESHEET_DEV]) {
    const employee = EMPLOYEES.find((e) => e.id === sheet.employee_id);
    const manday = calculateManday({
      period: sheet.period,
      monthlyRate: employee.assignment.monthly_rate,
      reportedWorkDays: sheet.reported_workdays,
      leaveDays: sheet.leave.map((l) => ({ date: l.date, type: l.leave_type })),
      holidays: holidayMap,
      divisor: { mode: CONTRACT.divisor_mode, value: CONTRACT.divisor_value },
      reportedDayLabels: sheet.dayLabels,
    });

    run(
      `INSERT INTO timesheets
         (id, contract_id, employee_id, period, source_email_id, source_file, received_at,
          approved_by, approved_at, raw_employee_name, raw_position,
          reported_workdays, reported_leave, extraction, status, computed)
       VALUES ($id, $contract_id, $employee_id, $period, $source_email_id, $source_file,
               $received_at, $approved_by, $approved_at, $raw_employee_name, $raw_position,
               $reported_workdays, $reported_leave, $extraction, $status, $computed)`,
      {
        id: sheet.id,
        contract_id: sheet.contract_id,
        employee_id: sheet.employee_id,
        period: sheet.period,
        source_email_id: sheet.source_email_id,
        source_file: sheet.source_file,
        received_at: sheet.received_at,
        approved_by: sheet.approved_by,
        approved_at: sheet.approved_at,
        raw_employee_name: sheet.raw_employee_name,
        raw_position: sheet.raw_position,
        reported_workdays: sheet.reported_workdays,
        reported_leave: sheet.reported_leave,
        extraction: JSON.stringify({
          source: 'seed (คัดจากเอกสารจริงด้วยมือ)',
          dayLabels: sheet.dayLabels,
        }),
        status: manday.ok ? 'verified' : 'mismatch',
        computed: JSON.stringify(manday),
      },
    );

    for (const leave of sheet.leave) {
      run(
        `INSERT INTO leave_days (timesheet_id, date, leave_type)
         VALUES ($timesheet_id, $date, $leave_type)`,
        { timesheet_id: sheet.id, date: leave.date, leave_type: leave.leave_type },
      );
    }

    for (const day of sheet.dayLabels) {
      run(
        `INSERT INTO timesheet_days (timesheet_id, date, label) VALUES ($id, $date, $label)`,
        { id: sheet.id, date: day.date, label: day.label },
      );
    }
  }

  setSetting('company', {
    nameTh: 'บริษัท ไอ แพสชั่น จำกัด',
    nameEn: 'iPassion Co., Ltd',
    taxId: '0125560007845',
    address: '382 อาคารไนซ์ 2 ชั้น 4 ห้อง 4/4-4/6 ถนนรัชดาภิเษก แขวงสามเสนนอก เขตห้วยขวาง กรุงเทพมหานคร 10310',
    phone: '02-115-2799',
    email: 'accounting@ipassion.co.th',
  });
  setSetting('email_ingest', {
    mailbox: 'billing@ipassion.co.th',
    subjectPattern: 'แจ้งอนุมัติเอกสาร TimeSheet',
    requiredStatusText: 'อนุมัติ',
    pollMinutes: 30,
  });
  setSetting('flowaccount', {
    mode: process.env.FLOWACCOUNT_MODE ?? 'dry-run',
    documentType: 'billing-note',
    autoApprove: false,
  });
  setSetting('billing_rules', {
    billOnDayOfNextMonth: 2,
    requireAllTimesheets: true,
    autoSendEmail: false,
    /* สวิตช์เดียวที่แยกโหมด manual ออกจาก auto
       true  = ต้องมีคนเปิด Timesheet ดูแล้วกดยืนยันก่อน จึงจะอนุมัติรอบบิลได้ (โหมดเดโมตอนนี้)
       false = ปล่อยให้ n8n ไหลจาก /ingest ไป /approve ได้เองโดยไม่มีคนคั่น */
    requireHumanCheck: true,
  });

  logAudit({
    actor: 'system',
    action: 'seed',
    detail: {
      customer: CUSTOMER.id,
      contract: CONTRACT.po_no,
      employees: EMPLOYEES.map((e) => e.id),
      timesheets: [TIMESHEET_PM.id, TIMESHEET_DEV.id],
    },
  });

  console.log(`ใส่ข้อมูลเรียบร้อย → ${DB_PATH}`);
  console.log(`  ลูกค้า      ${CUSTOMER.name_th}`);
  console.log(`  ใบว่าจ้าง   ${CONTRACT.po_no} (${CONTRACT.contract_no})`);
  console.log(`  พนักงาน     ${EMPLOYEES.map((e) => `${e.name_th} — ${e.invoice_position}`).join(' · ')}`);
  console.log(`  Timesheet   ${TIMESHEET_PM.id}, ${TIMESHEET_DEV.id} (รอบ 2026-01)`);
}

seed();
closeDb();

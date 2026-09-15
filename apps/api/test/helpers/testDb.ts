/**
 * ฐานข้อมูลสำหรับเทสต์ — Postgres ตัวแยก (`obs_test`) ไม่ใช่ `obs` ตัวจริง
 *
 * เทสต์ต้นฉบับ (`test/overdue-timesheet.test.js` ฯลฯ) ตั้ง `process.env.DB_PATH` ชี้ไฟล์ SQLite
 * ชั่วคราวใน tmpdir แล้ว `import('../src/db/seed.js')` — สแต็กใหม่ทำแบบนั้นไม่ได้เพราะ Prisma ต้องมี
 * schema ที่ migrate ไว้แล้ว จึงใช้ฐานข้อมูลแยกถาวรแทน แล้วล้าง+ใส่ fixture ใหม่ทุกไฟล์เทสต์
 *
 * เตรียมครั้งเดียวก่อนรันเทสต์ (มี npm script `test:db:setup` ให้):
 *   createdb obs_test && prisma migrate deploy
 */
import { prisma } from '@obs/db';
import { calculateManday, DIVISOR_MODE } from '@obs/domain';

// กันเขียนทับฐานข้อมูลจริงโดยอุบัติเหตุ — ชื่อฐานข้อมูลต้องลงท้าย _test เท่านั้น
const url = process.env.DATABASE_URL ?? '';
if (!/\/[A-Za-z0-9_]+_test(\?|$)/.test(url)) {
  throw new Error(
    `เทสต์ต้องชี้ DATABASE_URL ไปฐานข้อมูลที่ชื่อลงท้ายด้วย "_test" เท่านั้น (ตอนนี้: ${url || 'ไม่ได้ตั้ง'}) — ` +
      'รันผ่าน `npm run test` ของ apps/api ซึ่งตั้งค่านี้ให้แล้ว',
  );
}

/** ตารางทั้งหมด เรียงตามลำดับที่ลบได้โดยไม่ติด FK (TRUNCATE ... CASCADE ก็ได้แต่ระบุชัดอ่านง่ายกว่า) */
const TABLES = [
  'invoice_items', 'invoices', 'cycle_approvals', 'overtime_days', 'leave_days', 'timesheet_days',
  'timesheets', 'assignments', 'employee_aliases', 'support_tickets', 'ai_reads', 'gmail_dismissed',
  'sessions', 'users', 'employees', 'holidays', 'contracts', 'customers', 'audit_log', 'settings',
  'abbyy_skills',
];

export async function resetDb(): Promise<void> {
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${TABLES.map((t) => `"${t}"`).join(', ')} RESTART IDENTITY CASCADE`);
}

const NOW = '2026-02-01T00:00:00.000Z';

/* ── ข้อมูล fixture — พอร์ตตรงจาก src/db/seed.js ───────────────────────────
   ทุกค่ามาจากเอกสารจริงของโครงการ Outsource for BAU Project:
     ใบว่าจ้าง 26/B0113 · ใบเสนอราคา QT2025120005/QT2025110015 ·
     Timesheet-Pongpun_012026.pdf · ใบแจ้งหนี้ INV2026020006                      */

export const CUSTOMER = {
  id: 'CUS-TLI',
  nameTh: 'บริษัท ไทยประกันชีวิต จำกัด (มหาชน)',
  nameEn: 'ThaiLife Insurance Public Co., Ltd.',
  taxId: '0107555000104',
  branch: 'สำนักงานใหญ่',
  address: '123 อาคารไทยประกันชีวิต 1 ถนนรัชดาภิเษก แขวงดินแดง เขตดินแดง กรุงเทพมหานคร 10400',
  creditDays: 30,
  billingPlace: 'อาคารไทยประกันชีวิต 1/1 สายงานการบริหารและการวางแผนเชิงกลยุทธ์เทคโนโลยีสารสนเทศ ชั้น 6',
  contactName: 'คุณธัญวรัตน์',
  contactPhone: '02-247-0247 ต่อ 04699',
  contactEmail: null,
};

export const CONTRACT = {
  id: 'CT-26B0113',
  customerId: CUSTOMER.id,
  poNo: '26/B0113',
  contractNo: 'จซ.002/2569',
  projectName: 'Outsource for BAU Project',
  poDate: '2026-01-14',
  startDate: '2026-01-01',
  endDate: '2026-06-30',
  creditDays: 30,
  divisorMode: DIVISOR_MODE.FIXED,
  divisorValue: 20,
  vatRate: 0.07,
  whtRate: 0.03,
  status: 'active',
};

const EMPLOYEES = [
  {
    id: 'EMP-0042',
    nameTh: 'พงศ์พันธ์ มามาก',
    nameEn: 'Pongpun Mamak',
    invoicePosition: 'Developer',
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
    assignment: { id: 'ASG-0042-26B0113', quotationNo: 'QT2025120005', monthlyRate: 52943.93 },
  },
  {
    id: 'EMP-0018',
    nameTh: 'สุนีย์ มณีเกษมสุข',
    nameEn: 'Sunee Maneekasemsuk',
    invoicePosition: 'Senior Project Manager',
    aliases: {
      name: [{ alias: 'Sunee Maneekasemsook', source: 'การสะกดที่พบบ่อย' }],
      position: [
        { alias: 'PM', source: 'ใบว่าจ้าง 26/B0113' },
        { alias: 'Senior PM', source: 'เอกสาร workflow design' },
      ],
    },
    assignment: { id: 'ASG-0018-26B0113', quotationNo: 'QT2025110015', monthlyRate: 123420.0 },
  },
];

/**
 * วันหยุดปี 2026
 * 1–2 ม.ค. ยืนยันจาก Timesheet จริง — ทำให้เดือน ม.ค. มีวันทำงาน 20 วัน
 * ที่เหลือเป็นวันหยุดราชการตามปกติ ต้องยืนยันกับปฏิทินบริษัทลูกค้าอีกครั้ง
 */
const HOLIDAYS_2026: Array<[string, string, boolean]> = [
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

const TIMESHEETS = [
  {
    id: '2026010090',
    employeeId: 'EMP-0018',
    period: '2026-01',
    sourceEmailId: 'tli-approval-2026010090',
    sourceFile: 'Timesheet-Sunee_012026.pdf',
    receivedAt: '2026-02-01T08:41:00+07:00',
    rawEmployeeName: 'Sunee Maneekasemsuk',
    rawPosition: 'Senior Project Manager',
    reportedWorkdays: 20,
    reportedLeave: 0,
    leave: [] as Array<{ date: string; leaveType: string }>,
    dayLabels: [
      { date: '2026-01-01', label: 'Holiday' },
      { date: '2026-01-02', label: 'Holiday' },
    ],
  },
  {
    id: '2026010091',
    employeeId: 'EMP-0042',
    period: '2026-01',
    sourceEmailId: 'tli-approval-2026010091',
    sourceFile: 'Timesheet-Pongpun_012026.pdf',
    receivedAt: '2026-02-01T08:42:00+07:00',
    rawEmployeeName: 'Pongpun Mamak',
    rawPosition: 'Java Programmer',
    reportedWorkdays: 19,
    reportedLeave: 1,
    leave: [{ date: '2026-01-29', leaveType: 'sick' }],
    /** ป้ายกำกับที่เขียนไว้ในไฟล์จริง — 31 ม.ค. เป็นวันเสาร์ แต่เขียนว่า Holiday */
    dayLabels: [
      { date: '2026-01-01', label: 'Holiday' },
      { date: '2026-01-02', label: 'Holiday' },
      { date: '2026-01-29', label: 'Sick leave' },
      { date: '2026-01-31', label: 'Holiday' },
    ],
  },
];

/** ล้างฐานข้อมูลแล้วใส่ fixture ชุดเดียวกับ seed ของระบบเดิม */
export async function seedFixtures(): Promise<void> {
  await resetDb();

  await prisma.customer.create({ data: { ...CUSTOMER, createdAt: NOW } });
  await prisma.contract.create({ data: { ...CONTRACT, createdAt: NOW } });

  for (const employee of EMPLOYEES) {
    await prisma.employee.create({
      data: {
        id: employee.id,
        nameTh: employee.nameTh,
        nameEn: employee.nameEn,
        invoicePosition: employee.invoicePosition,
        createdAt: NOW,
      },
    });
    for (const [kind, list] of Object.entries(employee.aliases)) {
      await prisma.employeeAlias.createMany({
        data: list.map(({ alias, source }) => ({ employeeId: employee.id, kind, alias, source })),
      });
    }
    await prisma.assignment.create({
      data: {
        id: employee.assignment.id,
        contractId: CONTRACT.id,
        employeeId: employee.id,
        quotationNo: employee.assignment.quotationNo,
        monthlyRate: employee.assignment.monthlyRate,
        startDate: CONTRACT.startDate,
        endDate: CONTRACT.endDate,
        status: 'active',
      },
    });
  }

  await prisma.holiday.createMany({
    data: HOLIDAYS_2026.map(([date, name, verified]) => ({
      date,
      name: verified ? name : `${name} (รอยืนยันกับปฏิทินลูกค้า)`,
      customerId: null,
    })),
  });

  const holidayMap = new Map(HOLIDAYS_2026.map(([date, name]) => [date, name]));

  for (const sheet of TIMESHEETS) {
    const employee = EMPLOYEES.find((e) => e.id === sheet.employeeId)!;
    const manday = calculateManday({
      period: sheet.period,
      monthlyRate: employee.assignment.monthlyRate,
      reportedWorkDays: sheet.reportedWorkdays,
      leaveDays: sheet.leave.map((l) => ({ date: l.date, type: l.leaveType })),
      holidays: holidayMap,
      divisor: { mode: CONTRACT.divisorMode, value: CONTRACT.divisorValue },
      reportedDayLabels: sheet.dayLabels,
    } as any);

    await prisma.timesheet.create({
      data: {
        id: sheet.id,
        contractId: CONTRACT.id,
        employeeId: sheet.employeeId,
        period: sheet.period,
        sourceEmailId: sheet.sourceEmailId,
        sourceFile: sheet.sourceFile,
        receivedAt: sheet.receivedAt,
        approvedBy: 'Project Manager (TLI)',
        approvedAt: '2026-01-31',
        rawEmployeeName: sheet.rawEmployeeName,
        rawPosition: sheet.rawPosition,
        reportedWorkdays: sheet.reportedWorkdays,
        reportedLeave: sheet.reportedLeave,
        extraction: { source: 'seed (คัดจากเอกสารจริงด้วยมือ)', dayLabels: sheet.dayLabels },
        status: manday.ok ? 'verified' : 'mismatch',
        computed: manday as any,
        createdAt: NOW,
        updatedAt: NOW,
      },
    });

    if (sheet.leave.length > 0) {
      await prisma.leaveDay.createMany({
        data: sheet.leave.map((l) => ({ timesheetId: sheet.id, date: l.date, leaveType: l.leaveType })),
      });
    }
    await prisma.timesheetDay.createMany({
      data: sheet.dayLabels.map((d) => ({ timesheetId: sheet.id, date: d.date, label: d.label })),
    });
  }

  await prisma.setting.createMany({
    data: [
      { key: 'flowaccount', value: JSON.stringify({ mode: 'dry-run', documentType: 'billing-note', autoApprove: false }) },
      {
        key: 'billing_rules',
        value: JSON.stringify({
          billOnDayOfNextMonth: 2,
          requireAllTimesheets: true,
          autoSendEmail: false,
          requireHumanCheck: true,
        }),
      },
    ],
  });
}

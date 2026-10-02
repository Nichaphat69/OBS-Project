/**
 * วางบิล & ร่างอีเมล — ported from src/service.js (`billingCycles`, `contractPeriodEmployees`,
 * `previewCycleInvoice`, `buildEmailDraft`, `listInvoices`, `approveCycle`, `saveInvoice`,
 * `deleteInvoice`, `requestCycleApproval`/`decideCycleApproval`, `draftEmailWithAi`), rewritten
 * against Prisma.
 *
 * `approveCycle` creates a REAL draft document via the configured FlowAccount client (sandbox
 * per current .env) — confirmed with the user before wiring this up, since it's a real external
 * side effect, not a local computation like everything else in this file. `draftEmailWithAi`
 * (Phase 5.7) calls the local-LLM text model to rewrite `buildEmailDraft`'s template into prose —
 * code-complete but unverified against real data (see llmEmailService.ts's file header).
 *
 * Deferred (per MIGRATION_PLAN.md):
 * - `cacheInvoicePdf` (best-effort PDF caching from the FlowAccount share link right after
 *   approval) — approveCycle here stores the share link but not the cached PDF bytes.
 */
import { prisma } from '@obs/db';
import { SEVERITY, buildInvoice, money, nextPeriod, thaiMonth, thaiDate, toFlowAccountPayload } from '@obs/domain';
import {
  CYCLE_STATE,
  STATUS_LABEL,
  contractCycles,
  getCycleStatus,
  getSetting,
  isoToday,
  listContracts,
  pickOnePerEmployee,
} from './dashboardService.js';
import { getTimesheet } from './timesheetsService.js';
import { FlowAccountClient, type FlowAccountDocumentType } from './flowaccountClient.js';
import { logAudit } from './audit.js';
import { LineClient } from './lineClient.js';
import { lineApproverTargets } from './notificationRecipientsService.js';
import { webBase } from './timesheetSubmissionService.js';
import { draftBillingEmail } from './llmEmailService.js';
import { storeFile } from './fileStorage.js';

export async function listBillingCycles(scope?: string | string[] | null) {
  const today = isoToday();
  const allContracts = await listContracts();
  // สัญญาเดียว (ของเดิม) หรือรายการสัญญาจากตัวกรอง site/PO/พนักงาน — null/ไม่ระบุ = ทุกสัญญา
  const ids = Array.isArray(scope) ? scope : scope ? [scope] : null;
  const filtered = ids ? allContracts.filter((c) => ids.includes(c.id)) : allContracts;
  // รายชื่อพนักงานของแต่ละสัญญา — หน้ารอบบิลต้องบอกได้ว่ารอบนี้เป็นของใคร
  const assignmentRows = await prisma.assignment.findMany({
    where: { contractId: { in: filtered.map((c) => c.id) } },
    include: { employee: true },
    orderBy: { startDate: 'asc' },
  });

  const contracts = [];
  for (const contract of filtered) {
    const periods = await contractCycles(contract.id, today);
    const billed = periods.filter((p) => p.state === CYCLE_STATE.BILLED);
    const contractValue = Math.round((contract.monthlyTotal ?? 0) * periods.length * 100) / 100;
    const billedValue = Math.round(billed.reduce((sum, p) => sum + (p.paymentAmount ?? 0), 0) * 100) / 100;

    contracts.push({
      ...contract,
      employees: assignmentRows
        .filter((a) => a.contractId === contract.id)
        .map((a) => ({ id: a.employeeId, nameTh: a.employee.nameTh, position: a.employee.invoicePosition })),
      monthsTotal: periods.length,
      monthsBilled: billed.length,
      contractValue,
      billedValue,
      remainingValue: Math.round((contractValue - billedValue) * 100) / 100,
      progress: periods.length ? Math.round((billed.length / periods.length) * 100) : 0,
      periods,
    });
  }

  return {
    contracts,
    cycles: contracts.flatMap((c) => c.periods).sort((a, b) => b.period.localeCompare(a.period)),
  };
}

export interface ContractPeriodEmployee {
  employeeId: string;
  nameTh: string;
  position: string;
  timesheetId: string | null;
  status: string;
  statusLabel: string;
}

/** ported from service.js contractPeriodEmployees() */
export async function contractPeriodEmployees(contractId: string, period: string): Promise<ContractPeriodEmployee[]> {
  const assignments = await prisma.assignment.findMany({
    where: { contractId, status: 'active' },
    include: { employee: true },
  });

  const out: ContractPeriodEmployee[] = [];
  for (const a of assignments) {
    // เลือกใบที่ยัง active ก่อนใบตีกลับเสมอ เหมือนต้นฉบับ (ORDER BY status='rejected', id DESC)
    const sheets = await prisma.timesheet.findMany({
      where: { contractId, period, employeeId: a.employeeId },
      orderBy: { id: 'desc' },
    });
    const sheet = sheets.sort((x, y) => Number(x.status === 'rejected') - Number(y.status === 'rejected'))[0];

    out.push({
      employeeId: a.employeeId,
      nameTh: a.employee.nameTh,
      position: a.employee.invoicePosition,
      timesheetId: sheet?.id ?? null,
      status: sheet?.status ?? 'not_submitted',
      statusLabel: sheet ? STATUS_LABEL[sheet.status] ?? sheet.status : 'ยังไม่ได้ส่ง Timesheet',
    });
  }
  return out;
}

async function buildEmailDraft({ contract, invoice, documentNo = null, shareLink = null, invoiceId = null }: any) {
  const company = await getSetting<any>('company', {});
  const t = invoice.totals;
  const monthLabel = thaiMonth(invoice.period);

  const companyName = company.nameTh ?? 'บริษัท ไอ แพสชั่น จำกัด';
  const employeeCount = new Set(invoice.items.map((i: any) => i.employeeId)).size;

  const body = [
    `เรียน ${contract.customerName}`,
    `${companyName} ขอส่งเอกสารประกอบการวางบิล สำหรับการให้บริการประจำเดือน${monthLabel} เพื่อโปรดตรวจสอบและดำเนินการตามขั้นตอนของบริษัท`,
    'รายละเอียดการวางบิล',
    '',
    `* รอบการให้บริการ: ${monthLabel}`,
    `* จำนวนพนักงาน: ${employeeCount} คน`,
    `* เลขที่ใบวางบิล: ${documentNo ?? '—'}`,
    `* ยอดรวมสุทธิ: ${money(t.paymentAmount)} บาท`,
    '',
    '',
    'จึงเรียนมาเพื่อโปรดตรวจสอบและดำเนินการในส่วนที่เกี่ยวข้อง',
    `หากต้องการข้อมูลหรือเอกสารเพิ่มเติม กรุณาติดต่อ${companyName}`,
    'ขอแสดงความนับถือ',
    companyName,
    ...(company.phone ? [`โทร. ${company.phone}`] : []),
    ...(company.email ? [`อีเมล ${company.email}`] : []),
  ].join('\n');

  const attachments: Array<{ label: string; invoiceId: string | null; timesheetId: string | null }> = [
    {
      label: documentNo ? `ใบวางบิล ${documentNo}.pdf` : 'ใบวางบิล (รอเลขจาก FlowAccount).pdf',
      invoiceId,
      timesheetId: null,
    },
  ];
  const seenEmployees = new Map<string, any>();
  for (const item of invoice.items) {
    if (!seenEmployees.has(item.employeeId)) seenEmployees.set(item.employeeId, item);
  }
  for (const item of seenEmployees.values()) {
    const sheet = await prisma.timesheet.findFirst({
      where: { contractId: contract.id, employeeId: item.employeeId, period: invoice.period },
      orderBy: { createdAt: 'desc' },
    });
    attachments.push({
      label: `Timesheet ${item.employeeName} ${invoice.period}.pdf`,
      invoiceId: null,
      timesheetId: sheet?.id ?? null,
    });
  }

  return {
    to: contract.customer.contactEmail
      ? `${contract.customer.contactEmail} (${contract.customer.contactName ?? contract.customerName})`
      : contract.customer.contactName
        ? `${contract.customer.contactName} — ผู้ประสานงาน (${contract.customerName}) · ยังไม่มีอีเมลในระบบ`
        : contract.customerName,
    cc: company.email ?? 'accounting@ipassion.co.th',
    subject: `วางบิลค่าบริการ ${contract.projectName} ประจำเดือน${monthLabel}` + (documentNo ? ` (${documentNo})` : ''),
    body,
    invoiceLink: shareLink,
    attachments,
  };
}

export interface CyclePreview {
  contract: any;
  period: string;
  periodLabel: string;
  cycle: Awaited<ReturnType<typeof getCycleStatus>>;
  invoice: any | null;
  entries: Array<{ timesheetId: string; employee: any; manday: any; check: any }>;
  blockers: string[];
  warnings: Array<{ employee: string; id: string; severity: string; title: string; detail: string }>;
  emailDraft: any;
  existing: { id: string; documentNo: string | null; shareLink: string | null; status: string } | null;
}

/** ported from service.js previewCycleInvoice() — the Gmail-sync step in the original's
 * cycleDetail() wrapper is skipped (deferred, see MIGRATION_PLAN.md). */
export async function previewCycleInvoice(contractId: string, period: string): Promise<CyclePreview> {
  const contract = await prisma.contract.findUnique({ where: { id: contractId }, include: { customer: true } });
  if (!contract) throw Object.assign(new Error(`ไม่พบสัญญา ${contractId}`), { status: 404 });

  const contractView = {
    ...contract,
    customerName: contract.customer.nameTh,
    customer: contract.customer,
  };

  const sheetsAll = await prisma.timesheet.findMany({
    where: { contractId, period, status: { in: ['verified', 'approved', 'billed'] } },
  });

  // ⚠️ 1 ต.ค. 69 — พนักงานคนเดียวกันต้องมี Timesheet ได้ใบเดียวต่อรอบ ไม่งั้นใบแจ้งหนี้จะได้บรรทัดซ้ำและยอดเบิ้ล
  // (เกิดจริงเมื่ออัปโหลดไฟล์เดิมซ้ำ) ตอนรับเข้าระบบ ingestTimesheet() ตัดใบเก่าออกให้แล้ว ตรงนี้เป็นด่านสุดท้าย
  // กันข้อมูลที่ซ้ำอยู่ก่อนแก้ — ตัวเลือกเดียวกับหน้ารอบบิล/แดชบอร์ด (pickOnePerEmployee) ตัวเลขจะได้ตรงกันทุกที่
  // (คนที่มี OT มี 2 บรรทัดในใบเดียวได้ตามปกติ — เพราะ 1 ใบ Timesheet ต่อ 2 บรรทัด ไม่ใช่ 2 ใบ Timesheet)
  const { kept: sheetsRaw, dropped: droppedDuplicates } = pickOnePerEmployee(sheetsAll);
  const pickOne = new Map(sheetsRaw.filter((t) => t.employeeId).map((t) => [t.employeeId!, t]));

  const cycle = await getCycleStatus(contractId, period);
  const periodLabel = thaiMonth(period);

  if (sheetsRaw.length === 0) {
    return {
      contract: contractView,
      period,
      periodLabel,
      cycle,
      invoice: null,
      entries: [],
      blockers: ['ยังไม่มี Timesheet ที่ผ่านการตรวจในรอบบิลนี้'],
      warnings: [],
      emailDraft: null,
      existing: null,
    };
  }

  // เรียงตามเรทรายเดือนมากไปน้อย เหมือนต้นฉบับ
  const withRate = await Promise.all(
    sheetsRaw.map(async (s) => {
      const a = s.employeeId
        ? await prisma.assignment.findUnique({ where: { contractId_employeeId: { contractId, employeeId: s.employeeId } } })
        : null;
      return { id: s.id, rate: a?.monthlyRate ?? 0 };
    }),
  );
  withRate.sort((a, b) => b.rate - a.rate);

  const entries = [];
  for (const { id } of withRate) {
    const sheet = await getTimesheet(id);
    if (!sheet) continue;
    entries.push({
      timesheetId: id,
      employee: {
        id: sheet.employee.id,
        nameTh: sheet.employee.nameTh,
        invoicePosition: sheet.employee.invoicePosition,
        quotationNo: sheet.employee.quotationNo,
      },
      manday: sheet.manday,
      check: sheet.check,
    });
  }

  const rules = await getSetting('billing_rules', {
    billOnDayOfNextMonth: 2,
    requireAllTimesheets: true,
    requireHumanCheck: true,
  });
  const billPeriod = nextPeriod(period);
  const documentDate = `${billPeriod}-${String((rules as any).billOnDayOfNextMonth ?? 2).padStart(2, '0')}`;

  const invoice = buildInvoice({
    period,
    documentDate,
    creditDays: contract.creditDays,
    customer: {
      name: contract.customer.nameTh,
      taxId: contract.customer.taxId,
      branch: contract.customer.branch ?? undefined,
      flowAccountContactId: contract.customer.flowaccountContactId,
    },
    // employee.id is nullable in the DB (a timesheet can in theory arrive unmatched to anyone),
    // but only ever null before a human matches it — by the time it's 'verified'/'approved'/
    // 'billed' (the statuses fetched above) it always has an employee. Guard rather than cast.
    entries: entries
      .filter((e) => e.employee.id !== null)
      .map((e) => ({ employee: e.employee as { id: string; nameTh: string; invoicePosition: string; quotationNo: string | null }, manday: e.manday })),
    vatRate: contract.vatRate,
    whtRate: contract.whtRate,
  });

  const blockers: string[] = [];
  if ((rules as any).requireAllTimesheets && !cycle.complete) {
    blockers.push(`ยังได้ Timesheet ไม่ครบ (${cycle.received}/${cycle.expected}) — ${cycle.missing.join(', ')}`);
  }
  for (const entry of entries) {
    for (const check of entry.manday?.checks ?? []) {
      if (check.severity === SEVERITY.FAIL) blockers.push(`${entry.employee.nameTh}: ${check.title}`);
    }
    if ((rules as any).requireHumanCheck !== false && !entry.check?.checked) {
      blockers.push(
        entry.check?.stale
          ? `${entry.employee.nameTh}: ยอดเปลี่ยนหลังยืนยันไปแล้ว ต้องเข้าไปตรวจและยืนยันใหม่`
          : `${entry.employee.nameTh}: ยังไม่มีคนกดยืนยันผลตรวจ Timesheet`,
      );
    }
  }

  const warnings: Array<{ employee: string; id: string; severity: string; title: string; detail: string }> = entries.flatMap((entry) =>
    (entry.manday?.checks ?? [])
      .filter((c: any) => c.severity === SEVERITY.WARN)
      .map((c: any) => ({ employee: entry.employee.nameTh, ...c })),
  );
  for (const dup of droppedDuplicates) {
    const kept = pickOne.get(dup.employeeId!)!;
    const entry = entries.find((e) => e.employee.id === dup.employeeId);
    warnings.push({
      employee: entry?.employee.nameTh ?? dup.rawEmployeeName ?? '',
      id: 'duplicate_timesheet',
      severity: SEVERITY.WARN,
      title: 'พบ Timesheet ซ้ำของคนเดียวกันในรอบนี้',
      detail: `ใช้ฉบับ ${kept.id} วางบิล ไม่นับฉบับ ${dup.id}`,
    });
  }

  const existing = await prisma.invoice.findUnique({ where: { contractId_period: { contractId, period } } });
  const emailDraft = existing?.emailDraft
    ? JSON.parse(existing.emailDraft)
    : await buildEmailDraft({ contract: contractView, invoice });

  return {
    contract: contractView,
    period,
    periodLabel,
    cycle,
    invoice: { ...invoice, payload: toFlowAccountPayload(invoice) },
    entries,
    blockers,
    warnings,
    emailDraft,
    existing: existing
      ? { id: existing.id, documentNo: existing.documentNo, shareLink: existing.shareLink, status: existing.status }
      : null,
  };
}

/**
 * ขั้นที่ 4 — ให้ AI เรียบเรียงอีเมลจากตัวเลขที่ระบบคำนวณไว้ (ยังไม่ส่ง) — ported from service.js
 * draftEmailWithAi(). ระบบไม่ส่งอีเมลเอง — คนคัดลอกไปส่งจากกล่องเมลตัวเอง ที่นี่ทำแค่เปลี่ยนตัวเลขให้
 * เป็นภาษาคน แล้วเก็บทับร่าง template เดิมของใบนั้น (ตัวเลขทุกตัวยังมาจาก @obs/domain เส้นเดียวกับที่
 * buildEmailDraft() ใช้ — โมเดลได้รับแค่ตัวเลขที่คำนวณแล้ว ห้ามคิดเลขเอง)
 */
export async function draftEmailWithAi(contractId: string, period: string, { actor }: { actor: string }) {
  const preview = await previewCycleInvoice(contractId, period);
  if (!preview.invoice) throw new CycleActionError('ยังไม่มีรายการที่วางบิลได้ในรอบนี้', 400);

  const inv = preview.invoice;
  const t = inv.totals;
  const template = preview.emailDraft;

  // เดือนก่อนหน้าไว้ให้โมเดลเทียบ — ไม่มีก็ไม่ต้องเทียบ (สั่งห้ามพูดถึงไว้ใน system prompt)
  const [py, pm] = period.split('-').map(Number);
  const prevPeriod = pm === 1 ? `${py - 1}-12` : `${py}-${String(pm - 1).padStart(2, '0')}`;
  const previous = await prisma.invoice.findUnique({ where: { contractId_period: { contractId, period: prevPeriod } } });

  const facts = {
    ผู้ส่ง: ((await getSetting('company', {})) as any)?.nameTh ?? 'บริษัท ไอ แพสชั่น จำกัด',
    ลูกค้า: preview.contract.customerName,
    ผู้ประสานงาน: preview.contract.customer.contactName ?? null,
    โครงการ: preview.contract.projectName,
    เดือนที่วางบิล: preview.periodLabel,
    ใบว่าจ้าง: preview.contract.poNo,
    สถานที่วางบิล: preview.contract.customer.billingPlace ?? null,
    วันที่เอกสาร: thaiDate(inv.documentDate),
    เครดิต: `${inv.creditDays} วัน`,
    ครบกำหนดชำระ: thaiDate(inv.dueDate),
    รายการ: inv.items.map((i: any) => ({
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
    ลิงก์ดูเอกสารเต็ม: preview.existing?.shareLink ?? null,
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
          รวมหลังหักส่วนลด: previous.totalAfterDiscount,
          ส่วนลดรวม: previous.discountTotal,
          ยอดรับชำระ: previous.paymentAmount,
        }
      : null,
  };

  const draft = await draftBillingEmail(facts);

  // กันลิงก์หายจากตัวเมล — ถ้า AI ไม่ได้พูดถึงไว้เอง (เช่นไม่รู้ว่าต้องพูด) ต่อให้ท้ายเนื้อเมลเสมอ
  const shareLink = template.invoiceLink;
  const body =
    shareLink && !draft.body.includes(shareLink)
      ? `${draft.body}\n\nดูใบแจ้งหนี้ฉบับเต็ม (เปิดแล้วพิมพ์เป็น PDF ได้จากเบราว์เซอร์): ${shareLink}`
      : draft.body;

  const merged = {
    ...template,
    subject: draft.subject,
    body,
    highlights: draft.highlights ?? [],
    source: 'llm',
    model: draft.model,
    note: 'ระบบเรียบเรียงจากตัวเลขที่คำนวณไว้ — ระบบไม่ส่งอีเมลเอง ต้องอ่านทวนก่อนคัดลอกไปส่ง',
  };

  if (preview.existing) {
    await prisma.invoice.update({ where: { id: preview.existing.id }, data: { emailDraft: JSON.stringify(merged) } });
  }

  await logAudit({
    actor,
    action: 'draft_email_llm',
    entityType: 'invoice',
    entityId: preview.existing?.id ?? `${contractId}-${period}`,
    detail: { model: draft.model, usage: draft.usage, period, contractId },
  });

  return merged;
}

export async function listInvoices(contractId?: string) {
  const rows = await prisma.invoice.findMany({
    where: contractId ? { contractId } : undefined,
    include: { contract: { include: { customer: true } } },
    orderBy: { documentDate: 'desc' },
  });
  return rows.map((r) => ({
    id: r.id,
    contractId: r.contractId,
    poNo: r.contract.poNo,
    projectName: r.contract.projectName,
    customerName: r.contract.customer.nameTh,
    period: r.period,
    periodLabel: thaiMonth(r.period),
    documentNo: r.documentNo,
    shareLink: r.shareLink,
    documentDate: r.documentDate,
    dueDate: r.dueDate,
    total: r.total,
    discountTotal: r.discountTotal,
    totalAfterDiscount: r.totalAfterDiscount,
    vat: r.vat,
    grandTotal: r.grandTotal,
    withholdingTax: r.withholdingTax,
    paymentAmount: r.paymentAmount,
    status: r.status,
    emailSentAt: r.emailSentAt,
    emailDraft: r.emailDraft ? JSON.parse(r.emailDraft) : null,
  }));
}

export class CycleActionError extends Error {
  status: number;
  blockers?: string[];
  constructor(message: string, status: number, blockers?: string[]) {
    super(message);
    this.status = status;
    this.blockers = blockers;
  }
}

/** ported from service.js newFlowAccountClient() — settings.flowaccount overrides .env once
 * someone has actually saved a mode from the "จัดการระบบ" screen; falls back to .env until then. */
async function newFlowAccountClient(): Promise<FlowAccountClient> {
  const settings = await getSetting('flowaccount', {
    mode: process.env.FLOWACCOUNT_MODE ?? 'dry-run',
    documentType: 'billing-note' as FlowAccountDocumentType,
  });
  return new FlowAccountClient({ mode: (settings as any).mode, documentType: (settings as any).documentType });
}

/** ported from service.js saveInvoice() */
async function saveInvoice({
  invoiceId,
  contractId,
  period,
  preview,
  status,
  actor,
  documentNo = null,
  shareLink = null,
  documentPdf = null,
  response = null,
  emailDraft = null,
}: {
  invoiceId: string;
  contractId: string;
  period: string;
  preview: CyclePreview;
  status: string;
  actor: string;
  documentNo?: string | null;
  shareLink?: string | null;
  documentPdf?: Buffer | null;
  response?: unknown;
  emailDraft?: unknown;
}) {
  const t = preview.invoice!.totals;
  // เก็บไฟล์ก่อนเปิด transaction ด้วยเหตุผลเดียวกับ ingestService
  const documentPdfKey = documentPdf
    ? await storeFile('invoice', documentPdf, { fileName: `${documentNo ?? invoiceId}.pdf`, mimeType: 'application/pdf' })
    : null;

  await prisma.$transaction(async (tx) => {
    await tx.invoiceItem.deleteMany({ where: { invoiceId } });
    await tx.invoice.deleteMany({ where: { id: invoiceId } });

    await tx.invoice.create({
      data: {
        id: invoiceId,
        contractId,
        period,
        documentNo,
        shareLink,
        documentPdfKey,
        documentDate: preview.invoice!.documentDate,
        dueDate: preview.invoice!.dueDate,
        total: t.total,
        discountTotal: t.discountTotal,
        totalAfterDiscount: t.totalAfterDiscount,
        vat: t.vat,
        grandTotal: t.grandTotal,
        withholdingTax: t.withholdingTax,
        paymentAmount: t.paymentAmount,
        remark: preview.invoice!.remark,
        payload: JSON.stringify(preview.invoice!.payload),
        response: response ? JSON.stringify(response) : null,
        status,
        approvedBy: actor,
        approvedAt: new Date().toISOString(),
        emailDraft: emailDraft ? JSON.stringify(emailDraft) : null,
        createdAt: new Date().toISOString(),
      },
    });

    // จับคู่ item → timesheet ด้วย employeeId ไม่ใช่ index — คนที่มี OT จะมี 2 items ในใบเดียวกัน
    for (const [index, item] of preview.invoice!.items.entries()) {
      const entry = preview.entries.find((e) => e.employee.id === item.employeeId);
      await tx.invoiceItem.create({
        data: {
          invoiceId,
          seq: index + 1,
          employeeId: item.employeeId,
          timesheetId: entry?.timesheetId ?? null,
          name: item.name,
          description: item.description,
          quantity: item.quantity,
          unitName: item.unitName,
          pricePerUnit: item.pricePerUnit,
          discount: item.discount,
          amount: item.amount,
        },
      });
    }

    if (status === 'sent_to_flowaccount') {
      for (const entry of preview.entries) {
        await tx.timesheet.update({
          where: { id: entry.timesheetId },
          data: { status: 'billed', updatedAt: new Date().toISOString() },
        });
      }
    }
  });
}

/** ported from service.js approveCycle() — creates the real billing-note draft via FlowAccount
 * (sandbox, per current .env), persists it, and marks the cycle's timesheets 'billed'. */
/** รอบบิลที่กำลังอนุมัติอยู่ตอนนี้ — กดยืนยันซ้ำ/สองคนกดพร้อมกันต้องไม่สร้างเอกสารใน FlowAccount สองใบ (API รันตัวเดียว
 * ล็อกในหน่วยความจำจึงพอ) ด่านเช็ก existing ด้านล่างกันได้เฉพาะกรณีที่ใบแรกบันทึกเสร็จแล้ว */
const approvingNow = new Set<string>();

export async function approveCycle(contractId: string, period: string, { actor }: { actor: string }) {
  const lockKey = `${contractId}:${period}`;
  if (approvingNow.has(lockKey)) {
    throw new CycleActionError('รอบบิลนี้กำลังถูกยืนยันวางบิลอยู่ — รอสักครู่แล้วรีเฟรชดูผล ไม่ต้องกดซ้ำ', 409);
  }
  approvingNow.add(lockKey);
  try {
    return await approveCycleUnlocked(contractId, period, { actor });
  } finally {
    approvingNow.delete(lockKey);
  }
}

async function approveCycleUnlocked(contractId: string, period: string, { actor }: { actor: string }) {
  const preview = await previewCycleInvoice(contractId, period);

  if (!preview.invoice) {
    throw new CycleActionError('ยังไม่มีรายการที่วางบิลได้ในรอบนี้', 400);
  }
  if (preview.blockers.length > 0) {
    throw new CycleActionError(`ยังวางบิลไม่ได้: ${preview.blockers.join(' · ')}`, 409, preview.blockers);
  }
  if (preview.existing && preview.existing.status === 'sent_to_flowaccount') {
    throw new CycleActionError(`รอบบิลนี้สร้างเอกสารไปแล้ว (${preview.existing.documentNo})`, 409);
  }

  const client = await newFlowAccountClient();
  const invoiceId = `INV-${contractId}-${period}`;
  const invoiceCount = await prisma.invoice.count();
  const sequence = invoiceCount + 6; // ใบจริงของรอบแรกคือ ...0006

  let result;
  try {
    result = await client.createDraftDocument(preview.invoice.payload, { period, sequence });
  } catch (error: any) {
    await saveInvoice({
      invoiceId,
      contractId,
      period,
      preview,
      status: 'failed',
      actor,
      response: { error: error.message, status: error.status ?? null, body: error.body ?? null },
    });
    await logAudit({
      actor,
      action: 'flowaccount_create_failed',
      entityType: 'invoice',
      entityId: invoiceId,
      detail: { message: error.message, status: error.status ?? null, contractId },
    });
    throw error;
  }

  if (result.contactId && !preview.contract.customer.flowaccountContactId) {
    await prisma.customer.update({
      where: { id: preview.contract.customer.id },
      data: { flowaccountContactId: String(result.contactId) },
    });
    await logAudit({
      actor,
      action: 'flowaccount_contact_linked',
      entityType: 'customer',
      entityId: preview.contract.customer.id,
      detail: { contactId: result.contactId },
    });
  }

  let shareLink: string | null = null;
  if (result.documentId) {
    try {
      shareLink = (await client.getShareLink(result.documentId)).link;
    } catch (error: any) {
      await logAudit({
        actor,
        action: 'flowaccount_share_link_failed',
        entityType: 'invoice',
        entityId: invoiceId,
        detail: { message: error.message },
      });
    }
  }

  // ดึงไฟล์ PDF จริงมา cache ไว้ในระบบเรา (15 ก.ย. 69 ตามที่ user ขอ) — best-effort เหมือน shareLink
  // ด้านบน ล้มเหลวได้โดยไม่ทำให้การอนุมัติทั้งหมดพัง (เช่นโหมด dry-run ที่ shareLink เป็น null เสมอ หรือ
  // FlowAccount เปลี่ยนรูปแบบหน้า share ไป) ผู้ใช้ยังกดลิงก์ shareLink ดูเองได้เสมอถ้า cache ไม่สำเร็จ
  let documentPdf: Buffer | null = null;
  if (shareLink) {
    try {
      documentPdf = (await client.fetchSharedPdf(shareLink)).bytes;
    } catch (error: any) {
      await logAudit({
        actor,
        action: 'flowaccount_pdf_cache_failed',
        entityType: 'invoice',
        entityId: invoiceId,
        detail: { message: error.message },
      });
    }
  }

  const emailDraft = await buildEmailDraft({
    contract: preview.contract,
    invoice: preview.invoice,
    documentNo: result.documentNo,
    shareLink,
    invoiceId,
  });

  await saveInvoice({
    invoiceId,
    contractId,
    period,
    preview,
    status: 'sent_to_flowaccount',
    actor,
    documentNo: result.documentNo,
    shareLink,
    documentPdf,
    response: result,
    emailDraft,
  });

  await logAudit({
    actor,
    action: 'approve_cycle',
    entityType: 'invoice',
    entityId: invoiceId,
    detail: {
      period,
      documentNo: result.documentNo,
      mode: result.mode,
      paymentAmount: preview.invoice.totals.paymentAmount,
      contractId,
    },
  });

  return {
    invoiceId,
    documentNo: result.documentNo,
    shareLink,
    mode: result.mode,
    note: result.note ?? null,
    invoice: preview.invoice,
    emailDraft,
  };
}

/**
 * ลบใบแจ้งหนี้ทิ้ง — ทั้งเอกสารจริงใน FlowAccount และแถวในระบบเรา ใช้ตอนวางบิลผิดรอบ/ผิดคน แล้วต้อง
 * เปิดทางให้ส่ง Timesheet รอบเดือนนั้นเข้าระบบใหม่ได้อีกครั้ง (ingestTimesheet บล็อกไว้ถ้ารอบนั้นมี
 * ใบแจ้งหนี้ค้างอยู่แล้ว) Timesheet ทุกใบที่เคยผูกกับใบนี้ถูกดึงกลับไปสถานะ "ตรวจผ่านแล้ว" (verified)
 * เหมือนก่อนวางบิล ไม่ใช่ลบ Timesheet ทิ้งไปด้วย — ported from service.js deleteInvoice()
 */
export async function deleteInvoice(invoiceId: string, { actor, client }: { actor: string; client?: FlowAccountClient }): Promise<{ deleted: true; invoiceId: string; timesheetIds: string[] }> {
  const invoice = await prisma.invoice.findUnique({ where: { id: invoiceId } });
  if (!invoice) throw new CycleActionError('ไม่พบใบแจ้งหนี้นี้', 404);

  const response: any = invoice.response ? JSON.parse(invoice.response) : null;
  const documentId = response?.documentId ?? null;

  // มีเอกสารจริงใน FlowAccount ให้ลบด้วย — โหมด dry-run ไม่มีเอกสารจริงตั้งแต่แรก documentId จะเป็น
  // null เสมอ จึงข้ามขั้นนี้ไปเองโดยธรรมชาติ
  if (documentId) {
    const fa = client ?? new FlowAccountClient({ documentType: response?.documentType });
    await fa.deleteDocument(documentId);
  }

  const items = await prisma.invoiceItem.findMany({ where: { invoiceId, timesheetId: { not: null } } });
  const timesheetIds = items.map((i) => i.timesheetId!);

  await prisma.$transaction(async (tx) => {
    for (const tsId of timesheetIds) {
      await tx.timesheet.updateMany({ where: { id: tsId, status: 'billed' }, data: { status: 'verified', updatedAt: new Date().toISOString() } });
    }
    await tx.invoiceItem.deleteMany({ where: { invoiceId } });
    await tx.invoice.delete({ where: { id: invoiceId } });
  });

  await logAudit({
    actor,
    action: 'delete_invoice',
    entityType: 'invoice',
    entityId: invoiceId,
    detail: { documentNo: invoice.documentNo, period: invoice.period, contractId: invoice.contractId, timesheetCount: timesheetIds.length },
  });

  return { deleted: true, invoiceId, timesheetIds };
}

/** ลิงก์กดเข้าหน้ารายละเอียด Timesheet ใบนั้นตรงๆ — เดิมข้อความ LINE (notifyNeedsCheck/
 * notifyCheckFailed ใน ingestService.ts) มีปุ่ม "ตรวจ Manday" ที่พาไปหน้ารายการทั้งหมด `/manday`
 * (queueLink() เดิม — ported from service.js ที่ใช้ `?view=queue`) ทั้งที่ข้อความนั้นพูดถึงเอกสาร
 * ใบเดียวเป๊ะๆ — เจ้าของระบบสั่ง 24 ก.ย. 69 ("กด filter จากการแจ้งเตือนแล้วไม่พาไปหน้าปลายทางที่ควรไป")
 * ให้พาเข้าใบนั้นตรงๆ แทน (documentNo ก็คือ timesheet.id ตรงๆ อยู่แล้ว) — ไม่มีที่ใช้ queueLink() แบบ
 * ทั่วไปเหลืออยู่แล้ว จึงตัดออกแทนที่จะปล่อยเป็นโค้ดตาย */
export function documentLink(documentNo: string): string | null {
  const base = webBase();
  return base ? `${base}/manday/${encodeURIComponent(documentNo)}` : null;
}

/** ลิงก์กดเข้าหน้า "วางบิล & ร่างอีเมล" ของรอบบิลนั้นโดยตรง — ใช้กับปุ่มในคำขออนุมัติ — ported from
 * service.js cycleLink() */
export function cycleLink(contractId: string, period: string): string | null {
  const base = webBase();
  return base ? `${base}/billing/${encodeURIComponent(contractId)}/${encodeURIComponent(period)}` : null;
}

export interface CycleApprovalRow {
  contractId: string;
  period: string;
  status: string;
  requestedAt: string;
  requestedBy: string | null;
  decidedAt: string | null;
  decidedBy: string | null;
  lineMessageId: string | null;
}

/** สถานะคำขออนุมัติของรอบบิลนี้ — null ถ้ายังไม่เคยขอ — ported from service.js getCycleApproval() */
export async function getCycleApproval(contractId: string, period: string): Promise<CycleApprovalRow | null> {
  return prisma.cycleApproval.findUnique({ where: { contractId_period: { contractId, period } } });
}

/**
 * ขั้น 4.2 — ประตูมนุษย์จริงก่อนสร้างร่างใน FlowAccount — ported from service.js
 * requestCycleApproval(). ที่นี่แค่ส่งสรุปเข้า LINE ให้คนกด ไม่สร้างเอกสารใดๆ ร่างใน FlowAccount จะ
 * เกิดขึ้นต่อเมื่อ decideCycleApproval() ได้รับ "approved" กลับมาเท่านั้น เรียกได้จาก 3 ทาง: n8n เรียก
 * `/request-approval` ตรงๆ, `ingestTimesheet()` เรียกเองอัตโนมัติทันทีที่รอบครบและตรวจผ่าน, หรือกดจาก
 * หน้าเว็บ — กันส่งซ้ำเองอยู่แล้วถ้ามีคำขอค้าง (status='pending') เรียกซ้ำจากหลายทางพร้อมกันได้โดยไม่
 * สแปม LINE
 */
export async function requestCycleApproval(contractId: string, period: string, { actor, client }: { actor: string; client?: LineClient }): Promise<CycleApprovalRow> {
  const preview = await previewCycleInvoice(contractId, period);
  if (!preview.invoice) throw new CycleActionError('ยังไม่มีรายการที่วางบิลได้ในรอบนี้', 400);
  if (preview.blockers.length > 0) throw new CycleActionError(`ยังส่งขออนุมัติไม่ได้: ${preview.blockers.join(' · ')}`, 409, preview.blockers);
  if (preview.existing && preview.existing.status === 'sent_to_flowaccount') {
    throw new CycleActionError(`รอบบิลนี้สร้างเอกสารไปแล้ว (${preview.existing.documentNo})`, 409);
  }

  const current = await getCycleApproval(contractId, period);
  if (current?.status === 'pending') return current; // กันการส่งซ้ำ — ยังรอคนกดอยู่ ไม่ต้องยิง LINE ซ้ำ

  const line = client ?? new LineClient();
  const t = preview.invoice.totals;
  // ⚠️ เดิมไม่ได้ห่อ try/catch เลย (จุดเดียวที่ต่างจากทุกจุดแจ้งเตือน LINE อื่นในระบบ) ถ้า LINE ไม่ได้
  // ตั้งค่าไว้/ไม่มีผู้รับแจ้งเตือนเลย pushApprovalRequest() จะ throw ตรงๆ ให้หลุดไปถึง route โดยไม่มี
  // ใครรู้จัก error type — ยังคงบันทึกคำขออนุมัติไว้เป็น pending ต่อไป (แค่ไม่มีใครได้รับแจ้งเตือนจริง)
  // แทนที่จะทำให้ทั้งคำขออนุมัติล้มเหลวไปด้วย ตรงกับ pattern เดียวกับ notifyCheckFailed/notifyNeedsCheck
  // ที่ ingestService.ts ใช้อยู่แล้ว (เจอจริง 15 ก.ย. 69 ตอนไล่ตรวจ audit ทั้งระบบ)
  let messageId: string | null = null;
  try {
    const sent = await line.pushApprovalRequest({
      contractId,
      period,
      customerName: preview.contract.customerName,
      projectName: preview.contract.projectName,
      periodLabel: preview.periodLabel,
      headcount: preview.entries.length,
      paymentAmount: t.paymentAmount,
      approveUrl: cycleLink(contractId, period),
      targets: await lineApproverTargets(),
    });
    messageId = sent.sentTo.length ? sent.sentTo.join(',') : null;
  } catch (error: any) {
    await logAudit({
      actor: 'system',
      action: 'request_line_approval_error',
      entityType: 'cycle',
      entityId: `${contractId}-${period}`,
      detail: { message: error.message },
    });
  }

  await prisma.cycleApproval.upsert({
    where: { contractId_period: { contractId, period } },
    create: { contractId, period, status: 'pending', requestedAt: new Date().toISOString(), requestedBy: actor, lineMessageId: messageId },
    update: { status: 'pending', requestedAt: new Date().toISOString(), requestedBy: actor, decidedAt: null, decidedBy: null, lineMessageId: messageId },
  });

  await logAudit({
    actor,
    action: 'request_line_approval',
    entityType: 'cycle',
    entityId: `${contractId}-${period}`,
    detail: { paymentAmount: t.paymentAmount, headcount: preview.entries.length },
  });

  return (await getCycleApproval(contractId, period))!;
}

/** ผลตัดสินจาก LINE (เรียกจาก processLineWebhook เมื่อคนกดปุ่ม) — เชื่อ lineUserId ที่ผ่านมาแล้วเท่านั้น
 * ไม่ตรวจสิทธิ์ซ้ำที่นี่ (ตรวจที่ lineWebhookService.ts ก่อนเรียกเข้ามา) — ported from service.js
 * decideCycleApproval() */
export async function decideCycleApproval({
  contractId,
  period,
  decision,
  lineUserId,
}: {
  contractId: string;
  period: string;
  decision: 'approved' | 'rejected';
  lineUserId: string;
}): Promise<CycleApprovalRow & { result?: unknown }> {
  const current = await getCycleApproval(contractId, period);
  if (!current) throw new CycleActionError(`ไม่พบคำขออนุมัติของรอบ ${contractId}/${period}`, 404);
  if (current.status !== 'pending') return current; // กดปุ่มซ้ำ/ปุ่มเก่าที่ค้างอยู่ในแชท — เงียบๆ ไม่ทำซ้ำ ไม่ error

  if (decision === 'approved') {
    const result = await approveCycle(contractId, period, { actor: `line:${lineUserId}` });
    await prisma.cycleApproval.update({
      where: { contractId_period: { contractId, period } },
      data: { status: 'approved', decidedAt: new Date().toISOString(), decidedBy: lineUserId },
    });
    await logAudit({ actor: `line:${lineUserId}`, action: 'approve_line', entityType: 'cycle', entityId: `${contractId}-${period}`, detail: { documentNo: result.documentNo } });
    return { ...(await getCycleApproval(contractId, period))!, result };
  }

  await prisma.cycleApproval.update({
    where: { contractId_period: { contractId, period } },
    data: { status: 'rejected', decidedAt: new Date().toISOString(), decidedBy: lineUserId },
  });
  await logAudit({ actor: `line:${lineUserId}`, action: 'reject_line', entityType: 'cycle', entityId: `${contractId}-${period}`, detail: {} });
  return (await getCycleApproval(contractId, period))!;
}

export interface ReadyCycle {
  contractId: string;
  period: string;
  periodLabel: string;
  customerName: string;
  poNo: string;
  headcount: number;
  expectedBillDate: string;
  overdueToBill: boolean;
  paymentAmount: number | null;
  blockers: string[];
  canApprove: boolean;
}

/** รอบบิลที่พร้อมวางบิล — ให้ n8n ตัวตั้งเวลาถามว่า "วันนี้ต้องวางบิลอะไร" แทนที่จะให้ n8n ไปคำนวณ
 * เงื่อนไขเอง — ported from service.js readyCycles() */
export async function readyCycles(): Promise<{ today: string; count: number; cycles: ReadyCycle[] }> {
  const today = isoToday();
  const out: ReadyCycle[] = [];

  for (const contract of await listContracts()) {
    for (const cycle of await contractCycles(contract.id, today)) {
      if (cycle.state !== CYCLE_STATE.READY) continue;
      const preview = await previewCycleInvoice(contract.id, cycle.period);
      out.push({
        contractId: contract.id,
        period: cycle.period,
        periodLabel: cycle.periodLabel,
        customerName: contract.customerName,
        poNo: contract.poNo,
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

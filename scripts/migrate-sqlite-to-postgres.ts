/**
 * One-time data migration: data/billing.sqlite (the live app's node:sqlite database, 21 tables)
 * → Postgres, via the Prisma client in packages/db.
 *
 * Safety: the source file is WAL-mode and the old app (src/server.js) may have it open right
 * now. This script NEVER opens data/billing.sqlite directly — it first takes an online backup
 * via the `sqlite3` CLI's `.backup` command (which safely captures any WAL-only committed data,
 * unlike a plain `cp`) into a scratch file, then opens only that scratch copy with node:sqlite.
 *
 * Usage:
 *   DATABASE_URL=postgresql://... npx tsx scripts/migrate-sqlite-to-postgres.ts [path/to/billing.sqlite]
 *
 * Inserts every row of every table in FK-safe order, then verifies source vs. destination row
 * counts per table and prints a report. Data volume is trivial (a few hundred rows total, per
 * the migration plan) so this runs as a single script with no batching/streaming.
 */
import { execFileSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PrismaClient, Prisma } from '@prisma/client';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..');

const sourcePath = resolve(process.argv[2] ?? join(repoRoot, 'data', 'billing.sqlite'));

function toJson(text: string | null): Prisma.InputJsonValue | typeof Prisma.JsonNull {
  if (text === null || text === undefined) return Prisma.JsonNull;
  try {
    return JSON.parse(text);
  } catch {
    // ไม่ใช่ JSON ที่ parse ได้ (ไม่ควรเกิดในข้อมูลจริง) — เก็บดิบไว้เป็น JSON string แทนที่จะทิ้ง
    return text;
  }
}

function toBytes(value: unknown): Buffer | null {
  if (value === null || value === undefined) return null;
  return Buffer.from(value as Uint8Array);
}

function toBool(value: unknown): boolean {
  return Number(value) === 1;
}

async function main() {
  if (!existsSync(sourcePath)) {
    console.error(`ไม่พบไฟล์ต้นทาง: ${sourcePath}`);
    process.exit(1);
  }

  const scratchDir = mkdtempSync(join(tmpdir(), 'obs-sqlite-migrate-'));
  const scratchPath = join(scratchDir, 'billing.snapshot.sqlite');

  console.log(`[1/4] ก๊อปปี้ ${sourcePath} → ${scratchPath} (online backup ผ่าน sqlite3 CLI, ไม่แตะไฟล์จริง)`);
  execFileSync('sqlite3', [sourcePath, `.backup '${scratchPath}'`], { stdio: 'inherit' });

  const src = new DatabaseSync(scratchPath, { readOnly: true });
  const prisma = new PrismaClient();

  const sourceCounts: Record<string, number> = {};
  const destCounts: Record<string, number> = {};
  const skippedCounts: Record<string, number> = {};

  function allRows<T = any>(sql: string): T[] {
    return src.prepare(sql).all() as T[];
  }

  try {
    console.log('[2/4] อ่านข้อมูลจาก snapshot และเขียนเข้า Postgres (ในลำดับที่ปลอดภัยกับ FK)...');

    await prisma.$transaction(async (tx) => {
      // ── customers ──────────────────────────────────────────
      const customers = allRows('SELECT * FROM customers');
      sourceCounts.customers = customers.length;
      await tx.customer.createMany({
        data: customers.map((r: any) => ({
          id: r.id,
          nameTh: r.name_th,
          nameEn: r.name_en,
          taxId: r.tax_id,
          branch: r.branch,
          address: r.address,
          creditDays: r.credit_days,
          billingPlace: r.billing_place,
          contactName: r.contact_name,
          contactPhone: r.contact_phone,
          contactEmail: r.contact_email,
          flowaccountContactId: r.flowaccount_contact_id,
          createdAt: r.created_at,
          emailDomain: r.email_domain,
        })),
      });

      // ── contracts ──────────────────────────────────────────
      const contracts = allRows('SELECT * FROM contracts');
      sourceCounts.contracts = contracts.length;
      await tx.contract.createMany({
        data: contracts.map((r: any) => ({
          id: r.id,
          customerId: r.customer_id,
          poNo: r.po_no,
          contractNo: r.contract_no,
          projectName: r.project_name,
          poDate: r.po_date,
          startDate: r.start_date,
          endDate: r.end_date,
          creditDays: r.credit_days,
          divisorMode: r.divisor_mode,
          divisorValue: r.divisor_value,
          vatRate: r.vat_rate,
          whtRate: r.wht_rate,
          status: r.status,
          abbyySkillId: r.abbyy_skill_id,
          createdAt: r.created_at,
        })),
      });

      // ── employees ──────────────────────────────────────────
      const employees = allRows('SELECT * FROM employees');
      sourceCounts.employees = employees.length;
      await tx.employee.createMany({
        data: employees.map((r: any) => ({
          id: r.id,
          nameTh: r.name_th,
          nameEn: r.name_en,
          invoicePosition: r.invoice_position,
          hrddEmployeeCode: r.hrdd_employee_code,
          createdAt: r.created_at,
          lineUserId: r.line_user_id,
          lineLinkCode: r.line_link_code,
          lineLinkCodeExpiresAt: r.line_link_code_expires_at,
          linePendingTicketCategory: r.line_pending_ticket_category,
        })),
      });

      // ── employee_aliases ─────────────────────────────────────
      const employeeAliases = allRows('SELECT * FROM employee_aliases');
      sourceCounts.employee_aliases = employeeAliases.length;
      await tx.employeeAlias.createMany({
        data: employeeAliases.map((r: any) => ({
          employeeId: r.employee_id,
          kind: r.kind,
          alias: r.alias,
          source: r.source,
        })),
      });

      // ── assignments ────────────────────────────────────────
      const assignments = allRows('SELECT * FROM assignments');
      sourceCounts.assignments = assignments.length;
      await tx.assignment.createMany({
        data: assignments.map((r: any) => ({
          id: r.id,
          contractId: r.contract_id,
          employeeId: r.employee_id,
          quotationNo: r.quotation_no,
          monthlyRate: r.monthly_rate,
          startDate: r.start_date,
          endDate: r.end_date,
          status: r.status,
        })),
      });

      // ── holidays ───────────────────────────────────────────
      const holidays = allRows('SELECT * FROM holidays');
      sourceCounts.holidays = holidays.length;
      await tx.holiday.createMany({
        data: holidays.map((r: any) => ({
          date: r.date,
          name: r.name,
          customerId: r.customer_id,
        })),
      });

      // ── timesheets ─────────────────────────────────────────
      const timesheets = allRows('SELECT * FROM timesheets');
      sourceCounts.timesheets = timesheets.length;
      await tx.timesheet.createMany({
        data: timesheets.map((r: any) => ({
          id: r.id,
          contractId: r.contract_id,
          employeeId: r.employee_id,
          period: r.period,
          sourceEmailId: r.source_email_id,
          sourceEmailSubject: r.source_email_subject,
          sourceFile: r.source_file,
          sourceFileBytes: toBytes(r.source_file_bytes),
          receivedAt: r.received_at,
          approvedBy: r.approved_by,
          approvedAt: r.approved_at,
          rawEmployeeName: r.raw_employee_name,
          rawPosition: r.raw_position,
          reportedWorkdays: r.reported_workdays,
          reportedLeave: r.reported_leave,
          extraction: toJson(r.extraction),
          status: r.status,
          statusReason: r.status_reason,
          computed: toJson(r.computed),
          createdAt: r.created_at,
          updatedAt: r.updated_at,
          submissionMethod: r.submission_method,
        })),
      });

      // ── timesheet_days / leave_days / overtime_days ─────────
      // Defensive: the source dev DB has been known to carry orphaned rows referencing a
      // timesheet_id that no longer exists (e.g. leftover test fixtures inserted directly into
      // the shared file) — filter those out rather than let the FK insert fail the whole
      // migration. sourceCounts records the RAW row count (so the final report still shows the
      // true source total, not a count already adjusted to match); skippedCounts records how
      // many of those were dropped as orphans, so "source - skipped === dest" is the real check.
      const validTimesheetIds = new Set(timesheets.map((r: any) => r.id));
      function dropOrphans<T extends { timesheet_id: string }>(rows: T[], table: string): T[] {
        const kept = rows.filter((r) => validTimesheetIds.has(r.timesheet_id));
        const skipped = rows.length - kept.length;
        skippedCounts[table] = skipped;
        if (skipped > 0) {
          const orphanIds = [...new Set(rows.filter((r) => !validTimesheetIds.has(r.timesheet_id)).map((r) => r.timesheet_id))];
          console.warn(`  ⚠ ${table}: ข้าม ${skipped} แถวที่อ้างอิง timesheet_id ที่ไม่มีอยู่จริง (${orphanIds.join(', ')})`);
        }
        return kept;
      }

      const timesheetDaysRaw = allRows('SELECT * FROM timesheet_days');
      sourceCounts.timesheet_days = timesheetDaysRaw.length;
      const timesheetDays = dropOrphans(timesheetDaysRaw, 'timesheet_days');
      await tx.timesheetDay.createMany({
        data: timesheetDays.map((r: any) => ({
          timesheetId: r.timesheet_id,
          date: r.date,
          dayOfWeek: r.day_of_week,
          project: r.project,
          timeIn: r.time_in,
          timeOut: r.time_out,
          otTimeIn: r.ot_time_in,
          otTimeOut: r.ot_time_out,
          type: r.type,
          label: r.label,
          jobDesc: r.job_desc,
          remark: r.remark,
          normalHours: r.normal_hours,
          otHours: r.ot_hours,
          totalHours: r.total_hours,
        })),
      });

      const leaveDaysRaw = allRows('SELECT * FROM leave_days');
      sourceCounts.leave_days = leaveDaysRaw.length;
      const leaveDays = dropOrphans(leaveDaysRaw, 'leave_days');
      await tx.leaveDay.createMany({
        data: leaveDays.map((r: any) => ({
          timesheetId: r.timesheet_id,
          date: r.date,
          leaveType: r.leave_type,
        })),
      });

      const overtimeDaysRaw = allRows('SELECT * FROM overtime_days');
      sourceCounts.overtime_days = overtimeDaysRaw.length;
      const overtimeDays = dropOrphans(overtimeDaysRaw, 'overtime_days');
      await tx.overtimeDay.createMany({
        data: overtimeDays.map((r: any) => ({
          timesheetId: r.timesheet_id,
          date: r.date,
          hours: r.hours,
        })),
      });

      // ── gmail_dismissed ────────────────────────────────────
      const gmailDismissed = allRows('SELECT * FROM gmail_dismissed');
      sourceCounts.gmail_dismissed = gmailDismissed.length;
      await tx.gmailDismissed.createMany({
        data: gmailDismissed.map((r: any) => ({
          messageId: r.message_id,
          dismissedBy: r.dismissed_by,
          dismissedAt: r.dismissed_at,
        })),
      });

      // ── support_tickets ────────────────────────────────────
      const supportTickets = allRows('SELECT * FROM support_tickets');
      sourceCounts.support_tickets = supportTickets.length;
      await tx.supportTicket.createMany({
        data: supportTickets.map((r: any) => ({
          id: r.id,
          employeeId: r.employee_id,
          category: r.category,
          description: r.description,
          status: r.status,
          createdAt: r.created_at,
          resolvedAt: r.resolved_at,
          resolvedBy: r.resolved_by,
        })),
      });

      // ── ai_reads ───────────────────────────────────────────
      const aiReads = allRows('SELECT * FROM ai_reads');
      sourceCounts.ai_reads = aiReads.length;
      await tx.aiRead.createMany({
        data: aiReads.map((r: any) => ({
          id: r.id,
          source: r.source,
          sourceEmailId: r.source_email_id,
          fileName: r.file_name,
          employeeName: r.employee_name,
          period: r.period,
          documentNo: r.document_no,
          status: r.status,
          model: r.model,
          extraction: toJson(r.extraction),
          fileBytes: toBytes(r.file_bytes),
          readAt: r.read_at,
          readBy: r.read_by,
        })),
      });

      // ── invoices ───────────────────────────────────────────
      const invoices = allRows('SELECT * FROM invoices');
      sourceCounts.invoices = invoices.length;
      await tx.invoice.createMany({
        data: invoices.map((r: any) => ({
          id: r.id,
          contractId: r.contract_id,
          period: r.period,
          documentNo: r.document_no,
          shareLink: r.share_link,
          documentPdf: toBytes(r.document_pdf),
          documentDate: r.document_date,
          dueDate: r.due_date,
          total: r.total,
          discountTotal: r.discount_total,
          totalAfterDiscount: r.total_after_discount,
          vat: r.vat,
          grandTotal: r.grand_total,
          withholdingTax: r.withholding_tax,
          paymentAmount: r.payment_amount,
          remark: r.remark,
          payload: r.payload,
          response: r.response,
          status: r.status,
          approvedBy: r.approved_by,
          approvedAt: r.approved_at,
          emailDraft: r.email_draft,
          gmailDraftId: r.gmail_draft_id,
          gmailThreadId: r.gmail_thread_id,
          emailSentAt: r.email_sent_at,
          emailSentBy: r.email_sent_by,
          createdAt: r.created_at,
        })),
      });

      // ── invoice_items ──────────────────────────────────────
      const invoiceItems = allRows('SELECT * FROM invoice_items');
      sourceCounts.invoice_items = invoiceItems.length;
      await tx.invoiceItem.createMany({
        data: invoiceItems.map((r: any) => ({
          invoiceId: r.invoice_id,
          seq: r.seq,
          employeeId: r.employee_id,
          timesheetId: r.timesheet_id,
          name: r.name,
          description: r.description,
          quantity: r.quantity,
          unitName: r.unit_name,
          pricePerUnit: r.price_per_unit,
          discount: r.discount,
          amount: r.amount,
        })),
      });

      // ── cycle_approvals ────────────────────────────────────
      const cycleApprovals = allRows('SELECT * FROM cycle_approvals');
      sourceCounts.cycle_approvals = cycleApprovals.length;
      await tx.cycleApproval.createMany({
        data: cycleApprovals.map((r: any) => ({
          contractId: r.contract_id,
          period: r.period,
          status: r.status,
          requestedAt: r.requested_at,
          requestedBy: r.requested_by,
          decidedAt: r.decided_at,
          decidedBy: r.decided_by,
          lineMessageId: r.line_message_id,
        })),
      });

      // ── users ──────────────────────────────────────────────
      const users = allRows('SELECT * FROM users');
      sourceCounts.users = users.length;
      await tx.user.createMany({
        data: users.map((r: any) => ({
          username: r.username,
          nameTh: r.name_th,
          role: r.role,
          active: toBool(r.active),
          passwordSalt: r.password_salt,
          passwordHash: r.password_hash,
          createdAt: r.created_at,
          employeeId: r.employee_id,
          email: r.email,
          selfRegistered: toBool(r.self_registered),
          googleSub: r.google_sub,
          resetCodeHash: r.reset_code_hash,
          resetCodeSalt: r.reset_code_salt,
          resetCodeExpiresAt: r.reset_code_expires_at,
          resetCodeAttempts: r.reset_code_attempts ?? 0,
          resetTokenHash: r.reset_token_hash,
          resetTokenSalt: r.reset_token_salt,
          resetTokenExpiresAt: r.reset_token_expires_at,
        })),
      });

      // ── sessions ───────────────────────────────────────────
      // Same defensive orphan-drop as timesheet_days/leave_days/overtime_days above, this time
      // for sessions referencing a since-deleted username (stale login session left behind after
      // a test/dev account was removed).
      const validUsernames = new Set(users.map((r: any) => r.username));
      const sessionsRaw = allRows('SELECT * FROM sessions');
      sourceCounts.sessions = sessionsRaw.length;
      const sessions = sessionsRaw.filter((r: any) => validUsernames.has(r.username));
      const sessionsSkipped = sessionsRaw.length - sessions.length;
      skippedCounts.sessions = sessionsSkipped;
      if (sessionsSkipped > 0) {
        const orphanUsers = [...new Set(sessionsRaw.filter((r: any) => !validUsernames.has(r.username)).map((r: any) => r.username))];
        console.warn(`  ⚠ sessions: ข้าม ${sessionsSkipped} แถวที่อ้างอิง username ที่ไม่มีอยู่จริง (${orphanUsers.join(', ')})`);
      }
      await tx.session.createMany({
        data: sessions.map((r: any) => ({
          token: r.token,
          username: r.username,
          createdAt: r.created_at,
          expiresAt: r.expires_at,
        })),
      });

      // ── audit_log ──────────────────────────────────────────
      const auditLog = allRows('SELECT * FROM audit_log');
      sourceCounts.audit_log = auditLog.length;
      await tx.auditLog.createMany({
        data: auditLog.map((r: any) => ({
          id: r.id,
          at: r.at,
          actor: r.actor,
          action: r.action,
          entityType: r.entity_type,
          entityId: r.entity_id,
          detail: r.detail,
        })),
      });
      // sync the autoincrement sequence past the highest migrated id, else the next INSERT
      // created by the app after migration would collide with a migrated row's id
      await tx.$executeRawUnsafe(
        `SELECT setval(pg_get_serial_sequence('audit_log', 'id'), COALESCE((SELECT MAX(id) FROM audit_log), 1))`,
      );

      // ── settings ───────────────────────────────────────────
      const settings = allRows('SELECT * FROM settings');
      sourceCounts.settings = settings.length;
      await tx.setting.createMany({
        data: settings.map((r: any) => ({ key: r.key, value: r.value })),
      });

      // ── abbyy_skills ───────────────────────────────────────
      const abbyySkills = allRows('SELECT * FROM abbyy_skills');
      sourceCounts.abbyy_skills = abbyySkills.length;
      await tx.abbyySkill.createMany({
        data: abbyySkills.map((r: any) => ({
          id: r.id,
          name: r.name,
          skillId: r.skill_id,
          createdAt: r.created_at,
        })),
      });

      // sync the other two autoincrement sequences too (support_tickets, ai_reads)
      await tx.$executeRawUnsafe(
        `SELECT setval(pg_get_serial_sequence('support_tickets', 'id'), COALESCE((SELECT MAX(id) FROM support_tickets), 1))`,
      );
      await tx.$executeRawUnsafe(
        `SELECT setval(pg_get_serial_sequence('ai_reads', 'id'), COALESCE((SELECT MAX(id) FROM ai_reads), 1))`,
      );
    }, { timeout: 120_000 });

    console.log('[3/4] ตรวจนับจำนวนแถวต้นทาง vs. ปลายทาง...');
    destCounts.customers = await prisma.customer.count();
    destCounts.contracts = await prisma.contract.count();
    destCounts.employees = await prisma.employee.count();
    destCounts.employee_aliases = await prisma.employeeAlias.count();
    destCounts.assignments = await prisma.assignment.count();
    destCounts.holidays = await prisma.holiday.count();
    destCounts.timesheets = await prisma.timesheet.count();
    destCounts.timesheet_days = await prisma.timesheetDay.count();
    destCounts.leave_days = await prisma.leaveDay.count();
    destCounts.overtime_days = await prisma.overtimeDay.count();
    destCounts.gmail_dismissed = await prisma.gmailDismissed.count();
    destCounts.support_tickets = await prisma.supportTicket.count();
    destCounts.ai_reads = await prisma.aiRead.count();
    destCounts.invoices = await prisma.invoice.count();
    destCounts.invoice_items = await prisma.invoiceItem.count();
    destCounts.cycle_approvals = await prisma.cycleApproval.count();
    destCounts.users = await prisma.user.count();
    destCounts.sessions = await prisma.session.count();
    destCounts.audit_log = await prisma.auditLog.count();
    destCounts.settings = await prisma.setting.count();
    destCounts.abbyy_skills = await prisma.abbyySkill.count();

    console.log('[4/4] ผลตรวจนับ:');
    console.log('table'.padEnd(20), 'source'.padStart(8), 'skipped'.padStart(8), 'dest'.padStart(8), 'match');
    let allMatch = true;
    for (const table of Object.keys(sourceCounts)) {
      const s = sourceCounts[table];
      const skipped = skippedCounts[table] ?? 0;
      const d = destCounts[table];
      const match = s - skipped === d;
      if (!match) allMatch = false;
      console.log(
        table.padEnd(20),
        String(s).padStart(8),
        String(skipped).padStart(8),
        String(d).padStart(8),
        match ? 'OK' : 'MISMATCH',
      );
    }
    if (!allMatch) {
      console.error('\nพบตารางที่จำนวนแถวไม่ตรงกัน (หลังหักแถวที่ข้ามไปแล้ว) — ดูรายละเอียดด้านบน');
      process.exitCode = 1;
    } else {
      console.log('\nทุกตารางจำนวนแถวตรงกัน (นับหลังหักแถว orphan ที่ข้ามไปตามที่แจ้งเตือนด้านบน)');
    }
  } finally {
    src.close();
    await prisma.$disconnect();
    rmSync(scratchDir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

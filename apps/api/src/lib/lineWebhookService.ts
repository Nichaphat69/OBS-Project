/**
 * รับ webhook จาก LINE — ported from service.js's processLineWebhook/handleEmployeeLineMessage/
 * handleTicketPostback/handleTimesheetMethodPostback, narrowed to LINE account linking, แจ้งปัญหา
 * (support tickets), เลือกช่องทางส่ง Timesheet (submission method), (5.5.4) the "สถานะ"/
 * "สถานะการวางบิล" employee status commands ที่ตอนนี้พอร์ต employeeProgress() มาแล้ว, and (5.6)
 * the billing-approval postback (`approve`/`reject:...`) กดจากการ์ดขออนุมัติวางบิลใน LINE โดยตรง
 */
import { thaiMonth, thaiDate, thaiDateShort } from '@obs/domain';
import { prisma } from '@obs/db';
import { logAudit } from './audit.js';
import { employeeProgress, type EmployeeProgress } from './dashboardService.js';
import {
  LineClient,
  verifyLineSignature,
  parseTicketPostback,
  parseTimesheetMethodPostback,
  parseApprovalPostback,
  isAuthorizedApprover,
  buildTicketCategoryFlex,
  buildOverdueReminderFlex,
  buildEmployeeStatusFlex,
  buildBillingCycleFlex,
  buildTimesheetObsRedirectFlex,
  buildTimesheetEmailConfirmFlex,
  buildTimesheetProxyConfirmFlex,
  buildTimesheetMethodNotifyFlex,
  EMPLOYEE_QUICK_REPLY,
  TICKET_CATEGORIES,
  type TimesheetMethod,
} from './lineClient.js';
import { startSupportTicket, submitSupportTicket, buildMyTicketsText, resolveSupportTicket, SupportTicketError } from './supportTicketsService.js';
import { pendingSubmissionFor, uploadLink, myProgressLink } from './timesheetSubmissionService.js';
import { SUBMISSION_METHOD_LABEL } from './activityFeedService.js';
import { lineApproverTargets, notificationEmailTargets } from './notificationRecipientsService.js';
import { decideCycleApproval } from './cyclesService.js';

/** ข้อความสรุปสถานะรอบบิลปัจจุบันของพนักงานคนนี้ — ทางสำรองถ้าสร้าง Flex การ์ดพัง ported from
 * service.js buildEmployeeStatusText() */
function buildEmployeeStatusText(nameTh: string, progress: EmployeeProgress | null): string {
  if (!progress || progress.contracts.length === 0) {
    return `สวัสดีคุณ${nameTh} 👋\nยังไม่มีสัญญาที่ผูกกับคุณในระบบตอนนี้`;
  }
  const lines = progress.contracts.map((c) => {
    const current = c.periods.find((p) => p.period === progress.currentPeriod);
    return `${c.customerName} · รอบ ${progress.currentPeriodLabel}\nสถานะ: ${current?.timesheetStatusLabel ?? 'ยังไม่ได้ส่ง Timesheet'}`;
  });
  const link = myProgressLink();
  return (
    `📋 สถานะ Timesheet ของคุณ${nameTh}\n\n${lines.join('\n\n')}` +
    (link ? `\n\nดูรายละเอียดทุกรอบที่ผ่านมา:\n${link}` : '')
  );
}

/** แปลง employeeProgress() เป็น input ให้ buildEmployeeStatusFlex() (บับเบิลตอบคำสั่ง "สถานะ") —
 * ported from service.js buildEmployeeStatusFlexInput() ⚠️ ห้ามใส่ paymentAmount/ยอดเงินใดๆ ลงในนี้
 * เด็ดขาด — การ์ดนี้พนักงานเห็นเอง เรื่องเงินเป็นข้อมูลของฝ่ายบัญชีเท่านั้น */
function buildEmployeeStatusFlexInput(progress: EmployeeProgress) {
  const contracts = progress.contracts.map((c) => {
    const current = c.periods.find((p) => p.period === progress.currentPeriod);
    const currentStatusLabel = current?.timesheetStatusLabel ?? 'ยังไม่ได้ส่ง Timesheet';

    let currentStatusDetail: string | null = null;
    if (current?.billed) {
      currentStatusDetail = `วางบิลแล้ว (เลขที่ ${current.invoiceNo}) เมื่อ ${thaiDate(current.billedAt!)}`;
    } else if (current?.emailSentAt) {
      currentStatusDetail = `ส่งเอกสารให้ลูกค้าแล้วเมื่อ ${thaiDate(current.emailSentAt)}`;
    } else if (current?.checkedAt) {
      currentStatusDetail = `ตรวจ Manday แล้วเมื่อ ${thaiDate(current.checkedAt)}${current.checkedBy ? ` โดย ${current.checkedBy}` : ''}`;
    } else if (current?.receivedAt) {
      currentStatusDetail = `ส่ง Timesheet แล้วเมื่อ ${thaiDate(current.receivedAt)}`;
    }

    const recentPeriods = c.periods.slice(0, 5).map((p) => ({
      periodLabel: p.periodLabel,
      badge: p.billed ? 'วางบิลแล้ว' : p.timesheetStatus === 'not_submitted' ? 'ยังไม่ส่ง' : 'รอดำเนินการ',
    }));

    return {
      customerName: c.customerName,
      projectName: c.projectName,
      currentPeriodLabel: progress.currentPeriodLabel,
      currentStatusLabel,
      currentStatusDetail,
      recentPeriods,
    };
  });

  return { contracts, progressUrl: myProgressLink() };
}

/**
 * แปลง employeeProgress() เป็น input ให้ buildBillingCycleFlex() (บับเบิลตอบคำสั่ง "สถานะการวางบิล")
 * — ported from service.js buildBillingCycleFlexInput() โชว์ 5 ขั้นของรอบบิลปัจจุบัน: Timesheet →
 * ตรวจ Manday → ออกใบแจ้งหนี้ (FlowAccount) → วางบิลส่งลูกค้า → รับชำระเงิน
 *
 * ⚠️ ห้ามใส่ยอดเงินเช่นเดียวกับ buildEmployeeStatusFlexInput — ขั้น "รับชำระเงิน" ใช้แค่ due_date เป็น
 * วันที่คาดการณ์ ไม่มีช่องใดในระบบยืนยันว่าลูกค้าโอนเงินจริงหรือยัง จึงไม่มีทาง mark ขั้นนี้ว่า "เสร็จ" ได้เลย
 */
function buildBillingCycleFlexInput(progress: EmployeeProgress) {
  const contracts = progress.contracts.map((c) => {
    const current = c.periods.find((p) => p.period === progress.currentPeriod) ?? c.periods[0] ?? null;

    const submitted = Boolean(current?.receivedAt);
    const checked = Boolean(current?.checkedAt);
    const hasInvoice = Boolean(current?.invoiceNo || current?.invoiceCreatedAt);
    const sentToCustomer = Boolean(current?.emailSentAt);

    const steps = [
      {
        label: 'Timesheet ประจำเดือน',
        sub: submitted ? SUBMISSION_METHOD_LABEL[current!.submissionMethod ?? ''] ?? 'ส่งเข้าระบบแล้ว' : 'ยังไม่ได้ส่ง',
        dateLabel: submitted ? thaiDateShort(current!.receivedAt!) : null,
        done: submitted,
      },
      {
        label: 'ตรวจ Manday',
        sub: checked ? 'ตรวจแล้ว' : 'รอตรวจสอบ',
        dateLabel: checked ? thaiDateShort(current!.checkedAt!) : null,
        done: checked,
      },
      {
        label: 'ออกใบแจ้งหนี้ (FlowAccount)',
        sub: hasInvoice ? (current!.billed ? 'ส่งเข้า FlowAccount แล้ว' : 'Drafted') : 'รอออกใบแจ้งหนี้',
        dateLabel: hasInvoice ? thaiDateShort(current!.invoiceCreatedAt!) : null,
        done: hasInvoice,
      },
      {
        label: 'วางบิลส่งลูกค้า',
        sub: sentToCustomer ? 'ส่งลูกค้าแล้ว' : 'รอส่งลูกค้า (ร่างอีเมลและเอกสารแนบ)',
        dateLabel: sentToCustomer ? thaiDateShort(current!.emailSentAt!) : current?.dueDate ? `กำหนดส่ง: ${thaiDate(current.dueDate)}` : null,
        done: sentToCustomer,
      },
      {
        label: 'การรับชำระเงิน',
        sub: current?.dueDate ? `รอรับชำระ (คาดการณ์รับเงิน ${thaiDate(current.dueDate)})` : 'รอรับชำระ',
        dateLabel: c.creditDays ? `Term ${c.creditDays} วัน` : null,
        done: false,
      },
    ];

    const doneCount = steps.filter((s) => s.done).length;
    let currentIndex = steps.findIndex((s) => !s.done);
    if (currentIndex === -1) currentIndex = steps.length - 1;

    return {
      customerName: c.customerName,
      projectName: c.projectName,
      periodLabel: current?.periodLabel ?? progress.currentPeriodLabel,
      progressPercent: Math.round((doneCount / (steps.length - 1)) * 100),
      steps: steps.map((s, i) => ({ ...s, state: (s.done ? 'done' : i === currentIndex ? 'current' : 'future') as 'done' | 'current' | 'future' })),
    };
  });

  return { contracts };
}

export class LineWebhookError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

interface LineEvent {
  type: string;
  message?: { type: string; text?: string };
  postback?: { data?: string };
  replyToken?: string;
  source?: { userId?: string };
}

/** ported from service.js processLineWebhook() */
export async function processLineWebhook(
  rawBody: Buffer,
  signature: string | null | undefined,
  { channelSecret, client }: { channelSecret?: string; client?: LineClient } = {},
) {
  const secret = channelSecret ?? process.env.LINE_CHANNEL_SECRET ?? '';
  if (!verifyLineSignature(rawBody, signature, secret)) {
    throw new LineWebhookError('LINE signature ไม่ถูกต้อง — ปฏิเสธ webhook นี้', 401);
  }

  let body: { events?: LineEvent[] };
  try {
    body = JSON.parse(rawBody.toString('utf8'));
  } catch {
    throw new LineWebhookError('รูปแบบ JSON ของ LINE webhook ไม่ถูกต้อง', 400);
  }

  const results: unknown[] = [];
  for (const event of body.events ?? []) {
    const userId = event.source?.userId ?? null;

    if (event.type === 'message' && event.message?.type === 'text' && userId) {
      const handled = await handleEmployeeLineMessage({ userId, text: event.message.text ?? '', replyToken: event.replyToken, client });
      if (handled) {
        results.push(handled);
        continue;
      }
    }

    if (event.type !== 'postback') {
      if (userId) {
        await logAudit({ actor: `line:${userId}`, action: 'line_event_seen', entityType: 'line_user', entityId: userId, detail: { eventType: event.type } });
      }
      continue;
    }

    const ticketPostback = parseTicketPostback(event.postback?.data ?? '');
    if (ticketPostback) {
      const outcome = await handleTicketPostback({ ...ticketPostback, userId, replyToken: event.replyToken, client });
      results.push({ ...ticketPostback, userId, outcome });
      continue;
    }

    const tsMethodPostback = parseTimesheetMethodPostback(event.postback?.data ?? '');
    if (tsMethodPostback) {
      const outcome = await handleTimesheetMethodPostback({ ...tsMethodPostback, userId, replyToken: event.replyToken, client });
      results.push({ ...tsMethodPostback, userId, outcome });
      continue;
    }

    const approvalPostback = parseApprovalPostback(event.postback?.data ?? '');
    if (approvalPostback) {
      const outcome = await handleApprovalPostback({ ...approvalPostback, userId });
      results.push({ ...approvalPostback, userId, outcome });
      continue;
    }
    // ไม่ใช่ postback ที่รู้จัก — ไม่ทำอะไร ตรงกับต้นฉบับ
  }

  return { received: body.events?.length ?? 0, processed: results.length, results };
}

/** ported from service.js handleEmployeeLineMessage() */
async function handleEmployeeLineMessage({
  userId,
  text,
  replyToken,
  client,
}: {
  userId: string;
  text: string;
  replyToken?: string;
  client?: LineClient;
}): Promise<unknown> {
  const trimmed = String(text ?? '').trim();
  const line = client ?? new LineClient();

  const pending = await prisma.employee.findFirst({
    where: { lineLinkCode: trimmed, lineLinkCodeExpiresAt: { gt: new Date().toISOString() } },
    select: { id: true, nameTh: true },
  });
  if (pending) {
    await prisma.employee.update({ where: { id: pending.id }, data: { lineUserId: userId, lineLinkCode: null, lineLinkCodeExpiresAt: null } });
    await logAudit({ actor: `line:${userId}`, action: 'link_employee_line', entityType: 'employee', entityId: pending.id, detail: {} });
    if (replyToken) {
      try {
        await line.reply(replyToken, `เชื่อมต่อไลน์กับคุณ${pending.nameTh} สำเร็จ ✅\nพิมพ์ "สถานะ" เพื่อดูความคืบหน้า Timesheet ได้ทุกเมื่อ`, EMPLOYEE_QUICK_REPLY);
      } catch {
        /* ตอบไม่ได้ก็แล้วไป ผูกบัญชีสำเร็จไปแล้ว */
      }
    }
    return { userId, outcome: 'linked', employeeId: pending.id };
  }

  const linked = await prisma.employee.findFirst({
    where: { lineUserId: userId },
    select: { id: true, nameTh: true, linePendingTicketCategory: true },
  });

  /* กำลังแจ้งปัญหาค้างอยู่ (เพิ่งกดเลือกหมวดจากการ์ด "แจ้งปัญหา") — ข้อความถัดไปไม่ว่าจะพิมพ์อะไรมา
     ถือเป็นรายละเอียดปัญหาเสมอ ต้องเช็คจุดนี้ก่อนคำสั่งอื่นทั้งหมด */
  if (linked?.linePendingTicketCategory) {
    const ticket = await submitSupportTicket({
      employeeId: linked.id,
      employeeName: linked.nameTh,
      category: linked.linePendingTicketCategory,
      description: trimmed,
      client: line,
    });
    if (replyToken) {
      try {
        await line.reply(replyToken, `แจ้งปัญหาเรียบร้อย เลขที่ #${ticket.id} ✅\nฝ่ายดูแลจะรีบตรวจสอบให้ครับ`, EMPLOYEE_QUICK_REPLY);
      } catch {
        /* เงียบไว้ */
      }
    }
    return { userId, outcome: 'ticket_created', employeeId: linked.id, ticketId: ticket.id };
  }

  /* ปุ่มลัด "ส่ง Timesheet" — เรียกดูการ์ดเลือกวิธีส่ง (OBS/Email/ให้ผู้ดูแลส่งแทน) ได้เองตลอด ไม่ต้องรอ
     ให้ระบบเตือนก่อน ใช้การ์ดเดียวกับที่ sendOverdueTimesheetReminders() ส่งอัตโนมัติ */
  if (linked && /^ส่ง ?Timesheet$/i.test(trimmed)) {
    if (replyToken) {
      try {
        const pending = await pendingSubmissionFor(linked.id);
        if (pending) {
          const flex = buildOverdueReminderFlex(pending);
          await line.replyFlex(replyToken, `ส่ง Timesheet รอบ ${pending.periodLabel}`, flex, EMPLOYEE_QUICK_REPLY);
        } else {
          await line.reply(replyToken, 'ตอนนี้ไม่มี Timesheet ที่ต้องส่งครับ ระบบจะแจ้งเตือนอัตโนมัติเมื่อถึงกำหนดรอบถัดไป', EMPLOYEE_QUICK_REPLY);
        }
      } catch {
        try {
          await line.reply(replyToken, 'ขอโทษครับ ระบบมีปัญหาชั่วคราว ลองพิมพ์ "ส่ง Timesheet" อีกครั้ง', EMPLOYEE_QUICK_REPLY);
        } catch {
          /* เงียบไว้ */
        }
      }
    }
    return { userId, outcome: 'submission_prompt', employeeId: linked.id };
  }

  /* ปุ่มลัด "สถานะ"/"สรุปรอบวางบิล" เป็นคำพ้องความหมายเดียวกัน ต้องเช็คก่อน "แจ้งปัญหา"/"help"
     "สถานะการวางบิล" แยกออกไปเป็นคนละการ์ด (flow 5 ขั้นของรอบบิล) ดูบล็อกถัดไป ไม่ใช่คำพ้องอีกต่อไป */
  if (linked && /^(สถานะ|status|สรุปรอบวางบิล)$/i.test(trimmed)) {
    if (replyToken) {
      /* ลอง Flex การ์ดสวยๆก่อน พังได้ก็แค่ตกกลับไปใช้ข้อความ text ธรรมดาแบบเดิม ไม่ควรทำให้คำสั่ง
         "สถานะ" เงียบไปเฉยๆถ้าการ์ดใหม่มี bug */
      try {
        const progress = await employeeProgress(linked.id);
        if (progress?.contracts.length) {
          const flex = buildEmployeeStatusFlex(buildEmployeeStatusFlexInput(progress));
          await line.replyFlex(replyToken, `สถานะ Timesheet ของคุณ${linked.nameTh}`, flex, EMPLOYEE_QUICK_REPLY);
        } else {
          await line.reply(replyToken, buildEmployeeStatusText(linked.nameTh, progress), EMPLOYEE_QUICK_REPLY);
        }
      } catch {
        try {
          const progress = await employeeProgress(linked.id);
          await line.reply(replyToken, buildEmployeeStatusText(linked.nameTh, progress), EMPLOYEE_QUICK_REPLY);
        } catch {
          /* เงียบไว้ */
        }
      }
    }
    return { userId, outcome: 'status', employeeId: linked.id };
  }

  /* "สถานะการวางบิล" — การ์ด flow 5 ขั้นของรอบบิลปัจจุบัน ไม่มียอดเงินเช่นเดียวกับ "สถานะ" ข้างบน */
  if (linked && /^สถานะการวางบิล$/i.test(trimmed)) {
    if (replyToken) {
      try {
        const progress = await employeeProgress(linked.id);
        if (progress?.contracts.length) {
          const flex = buildBillingCycleFlex(buildBillingCycleFlexInput(progress));
          await line.replyFlex(replyToken, `สถานะการวางบิลของคุณ${linked.nameTh}`, flex, EMPLOYEE_QUICK_REPLY);
        } else {
          await line.reply(replyToken, buildEmployeeStatusText(linked.nameTh, progress), EMPLOYEE_QUICK_REPLY);
        }
      } catch {
        try {
          const progress = await employeeProgress(linked.id);
          await line.reply(replyToken, buildEmployeeStatusText(linked.nameTh, progress), EMPLOYEE_QUICK_REPLY);
        } catch {
          /* เงียบไว้ */
        }
      }
    }
    return { userId, outcome: 'billing_cycle_status', employeeId: linked.id };
  }

  if (linked && /^(แจ้งปัญหา|help)$/i.test(trimmed)) {
    if (replyToken) {
      try {
        await line.replyFlex(replyToken, 'แจ้งปัญหา', buildTicketCategoryFlex(), EMPLOYEE_QUICK_REPLY);
      } catch {
        /* เงียบไว้ */
      }
    }
    return { userId, outcome: 'ticket_category_prompt', employeeId: linked.id };
  }

  if (linked && /^(ตั๋วของฉัน|tickets)$/i.test(trimmed)) {
    if (replyToken) {
      try {
        await line.reply(replyToken, await buildMyTicketsText(linked), EMPLOYEE_QUICK_REPLY);
      } catch {
        /* เงียบไว้ */
      }
    }
    return { userId, outcome: 'my_tickets', employeeId: linked.id };
  }

  if (linked && replyToken) {
    try {
      await line.reply(
        replyToken,
        'พิมพ์ "สถานะ" เพื่อดูความคืบหน้า Timesheet\nพิมพ์ "แจ้งปัญหา" ถ้าเจอปัญหาหรือมีข้อเสนอแนะ\nพิมพ์ "ตั๋วของฉัน" เพื่อดูสถานะเรื่องที่เคยแจ้งไว้',
        EMPLOYEE_QUICK_REPLY,
      );
    } catch {
      /* เงียบไว้ */
    }
    return { userId, outcome: 'help', employeeId: linked.id };
  }

  return null;
}

/** อนุมัติ/ตีกลับรอบบิลจากปุ่มในการ์ด LINE โดยตรง — เฉพาะรายชื่อผู้อนุมัติเท่านั้น (รายชื่อเดียวกับ
 * isAuthorizedApprover ที่ใช้กับ "resolve" ตั๋วแจ้งปัญหา) — ported from service.js
 * processLineWebhook()'s approve/reject dispatch branch */
async function handleApprovalPostback({
  decision,
  contractId,
  period,
  userId,
}: {
  decision: 'approved' | 'rejected';
  contractId: string;
  period: string;
  userId: string | null;
}): Promise<unknown> {
  if (!isAuthorizedApprover(userId)) {
    await logAudit({ actor: `line:${userId ?? 'unknown'}`, action: 'line_approval_denied', entityType: 'cycle', entityId: `${contractId}-${period}`, detail: {} });
    return { outcome: 'denied' };
  }
  try {
    return await decideCycleApproval({ contractId, period, decision, lineUserId: userId! });
  } catch (error: any) {
    return { error: error.message };
  }
}

/** ported from service.js handleTicketPostback() */
async function handleTicketPostback({
  action,
  value,
  userId,
  replyToken,
  client,
}: {
  action: string;
  value: string;
  userId: string | null;
  replyToken?: string;
  client?: LineClient;
}): Promise<unknown> {
  const line = client ?? new LineClient();

  if (action === 'start') {
    const linked = await prisma.employee.findFirst({ where: { lineUserId: userId ?? undefined }, select: { id: true } });
    if (!linked) return { outcome: 'not_linked' };
    await startSupportTicket(linked.id, value);
    if (replyToken) {
      try {
        await line.reply(replyToken, `หมวด: ${TICKET_CATEGORIES[value] ?? value}\nพิมพ์รายละเอียดปัญหาที่พบมาได้เลยครับ`);
      } catch {
        /* เงียบไว้ */
      }
    }
    return { outcome: 'category_selected', employeeId: linked.id, category: value };
  }

  /* resolve — เฉพาะคนในรายชื่อผู้อนุมัติเดียวกับที่กดอนุมัติวางบิลได้เท่านั้น (กันพนักงานกดแก้ตั๋วตัวเอง) */
  if (!isAuthorizedApprover(userId)) {
    await logAudit({ actor: `line:${userId ?? 'unknown'}`, action: 'ticket_resolve_denied', entityType: 'support_ticket', entityId: value, detail: {} });
    return { outcome: 'denied' };
  }
  try {
    const ticket = await resolveSupportTicket(Number(value), { actor: `line:${userId}` });
    if (replyToken) {
      try {
        await line.reply(replyToken, `ทำเครื่องหมายตั๋ว #${ticket.id} ว่าแก้แล้ว ✅`);
      } catch {
        /* เงียบไว้ */
      }
    }
    return { outcome: 'resolved', ticket };
  } catch (error) {
    if (error instanceof SupportTicketError) return { outcome: { error: error.message } };
    throw error;
  }
}

/** ported from service.js handleTimesheetMethodPostback() — บันทึกแค่ "เจตนา" ของพนักงานลง audit_log
 * เท่านั้น ไม่แตะ timesheets.submission_method/สร้างแถวใดๆ เลย (ดู timesheetSubmissionService.ts's
 * file header) */
async function handleTimesheetMethodPostback({
  method,
  contractId,
  period,
  userId,
  replyToken,
  client,
}: {
  method: TimesheetMethod;
  contractId: string;
  period: string;
  userId: string | null;
  replyToken?: string;
  client?: LineClient;
}): Promise<unknown> {
  const line = client ?? new LineClient();

  const employee = await prisma.employee.findFirst({ where: { lineUserId: userId ?? undefined }, select: { id: true, nameTh: true } });
  if (!employee) return { outcome: 'not_linked' };

  const contract = await prisma.contract.findUnique({ where: { id: contractId }, include: { customer: true } });
  const periodLabel = thaiMonth(period);

  if (method === 'snooze') {
    if (replyToken) {
      try {
        await line.reply(replyToken, 'รับทราบครับ ระบบจะเตือนอีกครั้งพรุ่งนี้', EMPLOYEE_QUICK_REPLY);
      } catch {
        /* เงียบไว้ */
      }
    }
    await logAudit({ actor: `line:${userId}`, action: 'timesheet_method_snooze', entityType: 'employee', entityId: employee.id, detail: { contractId, period } });
    return { outcome: 'snoozed' };
  }

  if (method === 'self_obs') {
    if (replyToken) {
      try {
        const flex = buildTimesheetObsRedirectFlex({
          employeeName: employee.nameTh,
          customerName: contract?.customer.nameTh,
          projectName: contract?.projectName,
          periodLabel,
          uploadUrl: uploadLink(),
        });
        await line.replyFlex(replyToken, 'ส่ง Timesheet ผ่านระบบ OBS', flex, EMPLOYEE_QUICK_REPLY);
      } catch {
        /* เงียบไว้ */
      }
    }
    await logAudit({ actor: `line:${userId}`, action: 'timesheet_method_self_obs', entityType: 'employee', entityId: employee.id, detail: { contractId, period } });
    return { outcome: 'self_obs' };
  }

  if (method === 'self_email') {
    const emailTargets = await notificationEmailTargets();
    if (replyToken) {
      try {
        const flex = buildTimesheetEmailConfirmFlex({ customerName: contract?.customer.nameTh, projectName: contract?.projectName, periodLabel, emailTargets });
        await line.replyFlex(replyToken, 'บันทึกการส่งผ่าน Email เรียบร้อย', flex, EMPLOYEE_QUICK_REPLY);
      } catch {
        /* เงียบไว้ */
      }
    }
    try {
      const notifyFlex = buildTimesheetMethodNotifyFlex({ employeeName: employee.nameTh, periodLabel, method: 'self_email' });
      await line.pushFlexToAll(notifyFlex, `แจ้งส่ง Timesheet ทางอีเมล — ${employee.nameTh}`, { targets: await lineApproverTargets() });
    } catch (error: any) {
      await logAudit({ actor: 'system', action: 'notify_timesheet_self_email_error', entityType: 'employee', entityId: employee.id, detail: { message: error.message } });
    }
    await logAudit({ actor: `line:${userId}`, action: 'timesheet_method_self_email', entityType: 'employee', entityId: employee.id, detail: { contractId, period } });
    return { outcome: 'self_email' };
  }

  // proxy_email
  if (replyToken) {
    try {
      const flex = buildTimesheetProxyConfirmFlex({ employeeName: employee.nameTh, customerName: contract?.customer.nameTh, projectName: contract?.projectName, periodLabel });
      await line.replyFlex(replyToken, 'มอบหมายผู้ดูแลระบบเรียบร้อย', flex, EMPLOYEE_QUICK_REPLY);
    } catch {
      /* เงียบไว้ */
    }
  }
  try {
    const notifyFlex = buildTimesheetMethodNotifyFlex({ employeeName: employee.nameTh, periodLabel, method: 'proxy_email' });
    await line.pushFlexToAll(notifyFlex, `ขอมอบหมายส่ง Timesheet แทน — ${employee.nameTh}`, { targets: await lineApproverTargets() });
  } catch (error: any) {
    await logAudit({ actor: 'system', action: 'notify_timesheet_proxy_error', entityType: 'employee', entityId: employee.id, detail: { message: error.message } });
  }
  await logAudit({ actor: `line:${userId}`, action: 'timesheet_method_proxy_email', entityType: 'employee', entityId: employee.id, detail: { contractId, period } });
  return { outcome: 'proxy_email' };
}

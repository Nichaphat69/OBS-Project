/**
 * ฟีดกิจกรรม (กระดิ่งแจ้งเตือน) — ported from service.js's FEED_SHAPE/activityFeed()/
 * employeeTimesheetFeed(). Backs both the bell badge (via pulse()) and the full "การแจ้งเตือน"
 * page (Phase 5.5.2).
 */
import { quotationRefLookup } from './scopeService.js';
import { prisma } from '@obs/db';
import { thaiMonth, money } from '@obs/domain';
import { STATUS_LABEL } from './dashboardService.js';

const ACTOR_LABEL: Record<string, string> = { llm: 'ระบบ', n8n: 'n8n', system: 'ระบบ' };

/* เหตุการณ์ที่ไม่ต้องแจ้ง — ตั้งค่าระบบ ไม่ใช่งานประจำวัน */
const FEED_SKIP = new Set(['seed', 'read_timesheet_file']);

const who = (sheet: any) => (sheet?.employeeName ? `${sheet.employeeName} · ` : '');
const sheetPeriod = (d: any, sheet: any) => {
  const period = sheet?.period ?? d?.period;
  return period ? ` · รอบ ${thaiMonth(period)}` : '';
};

export const SUBMISSION_METHOD_LABEL: Record<string, string> = {
  self_obs: 'พนักงานส่งเองผ่านระบบ OBS',
  auto_gmail: 'ระบบดึงจาก Gmail อัตโนมัติ',
  self_email: 'พนักงานส่งเองทางอีเมล',
  proxy_email: 'ผู้อื่นส่งแทนทางอีเมล',
};
const viaMethod = (d: any) => (d?.submissionMethod && SUBMISSION_METHOD_LABEL[d.submissionMethod] ? ` · ${SUBMISSION_METHOD_LABEL[d.submissionMethod]}` : '');

type FeedShapeFn = (detail: any, entityId: string | null, sheet?: any, refOf?: (poNo: string | null | undefined, customerName?: string | null) => string) => { level: string; title: string; detail: string; link: unknown };

const FEED_SHAPE: Record<string, FeedShapeFn> = {
  extract_timesheet: (d, id) => ({
    level: 'info',
    title: 'ระบบอ่านไฟล์ Timesheet เสร็จ',
    detail: `${d?.employeeName ?? id}${d?.period ? ` · รอบ ${thaiMonth(d.period)}` : ''}`,
    link: { view: 'detail', id },
  }),
  ingest_timesheet: (d, id, sheet) => ({
    level: 'info',
    title: 'รับ Timesheet เข้าระบบ',
    detail: `${who(sheet)}เลขที่ ${id}${sheetPeriod(d, sheet)}${viaMethod(d)}`,
    link: { view: 'detail', id },
  }),
  ingest_timesheet_replaced: (d, id, sheet) => ({
    level: 'info',
    title: 'รับ Timesheet ฉบับแก้ไข',
    detail: `${who(sheet)}เลขที่ ${id}${sheetPeriod(d, sheet)}${viaMethod(d)} ถูกส่งมาใหม่ ระบบเขียนทับและคำนวณใหม่แล้ว`,
    link: { view: 'detail', id },
  }),
  human_checked: (d, id, sheet) => ({
    level: 'ok',
    title: 'คนยืนยันผลตรวจแล้ว',
    detail: `${who(sheet)}เลขที่ ${id}${sheetPeriod(d, sheet)} · ออก INV ได้ ${d?.payableDays ?? '—'} วัน · ${money(d?.lineAmount ?? 0)} บาท`,
    link: { view: 'detail', id },
  }),
  recompute_manday: (d, id, sheet) => ({
    level: 'info',
    title: 'คำนวณ Manday ใหม่',
    detail: `${who(sheet)}เลขที่ ${id}${sheetPeriod(d, sheet)} · ออก INV ได้ ${d?.payableDays ?? '—'} วัน${d?.discount ? ` · ส่วนลด ${money(d.discount)} บาท` : ''}`,
    link: { view: 'detail', id },
  }),
  reject_timesheet: (d, id, sheet) => ({
    level: 'warn',
    title: 'ตีกลับ Timesheet ให้แก้',
    detail: `${who(sheet)}เลขที่ ${id}${sheetPeriod(d, sheet)}${d?.reason ? ` · ${d.reason}` : ''}`,
    link: { view: 'detail', id },
  }),
  approve_cycle: (d) => ({
    level: 'ok',
    title: 'สร้างร่างใบแจ้งหนี้ใน FlowAccount',
    detail: `${d?.documentNo ?? 'ยังไม่ได้เลขเอกสาร'}${d?.period ? ` · รอบ ${thaiMonth(d.period)}` : ''}${d?.paymentAmount ? ` · ${money(d.paymentAmount)} บาท` : ''}${d?.mode === 'dry-run' ? ' (dry-run)' : ''}`,
    link: d?.contractId && d?.period ? { view: 'cycle', contractId: d.contractId, period: d.period } : null,
  }),
  draft_email_llm: (d) => ({
    level: 'info',
    title: 'ระบบร่างอีเมล INV',
    detail: `รอบ ${d?.period ? thaiMonth(d.period) : '—'} · ยังไม่ส่ง รออ่านทวนก่อนคัดลอก`,
    link: null,
  }),
  invoice_email_sent: (d, id) => ({
    level: 'ok',
    title: 'ปิดงาน — ส่งเมล INV แล้ว',
    detail: `${d?.documentNo ?? id}`,
    link: null,
  }),
  ingest_failed_no_match: (d, id) => ({
    level: 'critical',
    title: 'รับ Timesheet ไม่ได้ — จับคู่ชื่อไม่ได้',
    detail: `เลขที่ ${id} · ชื่อในไฟล์ "${d?.rawName ?? '—'}" ไม่ตรงกับใครในระบบ ต้องไปเพิ่มชื่อพ้อง`,
    link: null,
  }),
  ingest_failed_no_contract: (d, id) => ({
    level: 'critical',
    title: 'รับ Timesheet ไม่ได้ — ไม่พบสัญญา',
    detail: `เลขที่ ${id} · ไม่มีสัญญาที่ครอบรอบ ${d?.period ? thaiMonth(d.period) : 'นี้'}`,
    link: null,
  }),
  flowaccount_create_failed: (d, id) => ({
    level: 'critical',
    title: 'สร้างเอกสารใน FlowAccount ไม่สำเร็จ',
    detail: `${id}${d?.message ? ` · ${d.message}` : ''}`,
    link: null,
  }),
  create_contract: (d, _id, _sheet, refOf) => ({
    level: 'ok',
    title: 'เพิ่มสัญญา/บริษัทใหม่',
    detail: `${d?.customerId ?? ''} · ${d?.projectName ?? '—'}${d?.poNo ? ` · ${refOf ? refOf(d.poNo) : `PO ${d.poNo}`}` : ''}`,
    link: { view: 'master' },
  }),
  create_employee: (d) => ({
    level: 'ok',
    title: 'เพิ่มพนักงานใหม่',
    detail: `${d?.nameTh ?? '—'}${d?.invoicePosition ? ` — ${d.invoicePosition}` : ''}`,
    link: { view: 'master' },
  }),
};

export interface FeedItem {
  id: number | string;
  at: string;
  by: string;
  level: string;
  title: string;
  detail: string;
  link: unknown;
}
export interface Feed {
  items: FeedItem[];
  latestAt: string | null;
  counts: { total: number; critical: number };
}

/** ported from service.js activityFeed() */
export async function activityFeed({ limit = 30, contractId = null, contractIds = null }: { limit?: number; contractId?: string | null; contractIds?: string[] | null } = {}): Promise<Feed> {
  // ขอบเขตหลายสัญญาจากตัวกรอง PO บนแถบบน (6 ต.ค. 69) — null/ไม่ระบุ = ทุกสัญญา · contractId เดี่ยวคงไว้ให้โค้ดเดิม
  const scopeIds = contractIds ?? (contractId ? [contractId] : null);
  const rows = await prisma.auditLog.findMany({ orderBy: { id: 'desc' }, take: limit * 3 });
  const candidates = rows
    .map((r) => ({ ...r, detail: r.detail ? JSON.parse(r.detail) : null }))
    .filter((r) => !FEED_SKIP.has(r.action) && FEED_SHAPE[r.action]);

  const timesheetIds = [...new Set(candidates.filter((r) => r.entityType === 'timesheet' && r.entityId).map((r) => r.entityId as string))];
  const sheetInfo = new Map<string, { employeeName: string | null; period: string; contractId: string }>();
  if (timesheetIds.length) {
    const sheets = await prisma.timesheet.findMany({
      where: { id: { in: timesheetIds } },
      include: { employee: true },
    });
    for (const s of sheets) sheetInfo.set(s.id, { employeeName: s.employee?.nameTh ?? null, period: s.period, contractId: s.contractId });
  }

  const contractOf = (r: (typeof candidates)[number]): string | null => {
    if (r.entityType === 'timesheet') return (r.entityId && sheetInfo.get(r.entityId)?.contractId) ?? null;
    if (r.entityType === 'invoice') return (r.detail as any)?.contractId ?? null;
    return null;
  };

  const filtered = scopeIds
    ? candidates.filter((r) => {
        const rc = contractOf(r);
        return !rc || scopeIds.includes(rc);
      })
    : candidates;
  const trimmed = filtered.slice(0, limit);

  const refOf = await quotationRefLookup();
  const items: FeedItem[] = trimmed.map((r) => {
    const sheet = r.entityId ? sheetInfo.get(r.entityId) : undefined;
    const base = FEED_SHAPE[r.action](r.detail, r.entityId, sheet, refOf);
    return { ...base, id: r.id, at: r.at, by: ACTOR_LABEL[r.actor] ?? r.actor };
  });

  return {
    items,
    latestAt: items[0]?.at ?? null,
    counts: { total: items.length, critical: items.filter((i) => i.level === 'critical').length },
  };
}

const TIMESHEET_STATUS_LEVEL: Record<string, string> = {
  verified: 'ok',
  approved: 'ok',
  billed: 'ok',
  mismatch: 'critical',
  rejected: 'warn',
  received: 'info',
  extracted: 'info',
};

/** ported from service.js employeeTimesheetFeed() — "การแจ้งเตือน"/กระดิ่งของ role 'user' มองจาก
 * "Timesheet ของตัวเอง" แทนฟีดรวมทั้งระบบ คืนโครงเดียวกับ activityFeed() ทุกอย่าง */
export async function employeeTimesheetFeed(employeeId: string, { limit = 30 }: { limit?: number } = {}): Promise<Feed> {
  const rows = await prisma.timesheet.findMany({
    where: { employeeId },
    include: { contract: { include: { customer: true } } },
    orderBy: { updatedAt: 'desc' },
    take: limit * 3,
  });

  const seen = new Set<string>();
  const deduped = rows.filter((r) => {
    const key = `${r.contractId}|${r.period}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, limit);

  const items: FeedItem[] = deduped.map((r) => ({
    id: r.id,
    at: r.updatedAt,
    by: r.contract.customer.nameTh,
    level: TIMESHEET_STATUS_LEVEL[r.status] ?? 'info',
    title: `รอบบิล ${thaiMonth(r.period)}`,
    detail: `${r.contract.projectName} · ${STATUS_LABEL[r.status] ?? r.status}`,
    link: { view: 'myProgress' },
  }));

  return {
    items,
    latestAt: items[0]?.at ?? null,
    counts: { total: items.length, critical: items.filter((i) => i.level === 'critical').length },
  };
}

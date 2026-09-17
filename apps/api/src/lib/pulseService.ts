/**
 * ป้ายเลขบนแถบเมนู + สายข้อมูลของแถบบนทั้งหมด — ported from service.js pulse(). หน้าเว็บถามทุก 60
 * วิ (+ SSE nudge ทันทีที่มีอะไรเปลี่ยน) เอาไปเติมป้ายคิว/รอบบิล/ตั๋ว/กระดิ่ง, ชิปโหมด FlowAccount,
 * และชื่อ/role ของคนที่ login อยู่
 */
import { prisma } from '@obs/db';
import { getActiveContract, getSetting, contractCycles, CYCLE_STATE } from './dashboardService.js';
import { listTimesheets } from './timesheetsService.js';
import { activityFeed, employeeTimesheetFeed, type Feed } from './activityFeedService.js';

const NEEDS_ACTION = ['received', 'extracted', 'mismatch'];

/** ported from service.js currentFlowAccountMode() */
async function currentFlowAccountMode(): Promise<string> {
  const setting = await getSetting<{ mode?: string }>('flowaccount', {});
  return setting.mode ?? process.env.FLOWACCOUNT_MODE ?? 'dry-run';
}

export interface Pulse {
  needsAction: number;
  waitingCheck: number;
  readyToApprove: number;
  feed: Feed;
  flowAccountMode: string;
  manualMode: boolean;
  openTicketCount: number;
  actor: string;
  role: string | null;
}

export async function pulse({
  actor = 'ยังไม่ได้ระบุผู้ใช้',
  role = null,
  employeeId = null,
}: { actor?: string; role?: string | null; employeeId?: string | null } = {}): Promise<Pulse> {
  /* ป้ายบนเมนูต้องนับเฉพาะของบริษัทที่กำลังดำเนินการอยู่ตอนนี้ — ให้ตรงกับที่หน้า "ตรวจ Manday"/
     "วางบิล" เองก็กรองด้วย contractId เดียวกัน ไม่งั้นป้ายจะขึ้นเลขรวมทุกบริษัท */
  const activeContract = await getActiveContract();
  const { items: sheets } = await listTimesheets();
  const scoped = activeContract ? sheets.filter((s) => s.contract.id === activeContract.id) : sheets;

  const byStatus: Record<string, number> = {};
  for (const sheet of scoped) byStatus[sheet.status] = (byStatus[sheet.status] ?? 0) + 1;

  const waitingCheck = scoped.filter((s) => s.status === 'verified' && !s.check.checked).length;

  let readyToApprove = 0;
  if (activeContract) {
    const cycles = await contractCycles(activeContract.id);
    readyToApprove = cycles.filter((c) => c.state === CYCLE_STATE.READY).length;
  }

  const billingRules = await getSetting<{ requireHumanCheck?: boolean }>('billing_rules', {});
  /* จำนวนตั๋วที่ยังไม่ปิด — role 'user' ต้องได้เฉพาะของตัวเอง ไม่ใช่ยอดรวมทั้งบริษัท
   *
   * เดิมนับทั้งบริษัทแล้วส่งให้ทุก role เหมือนกันหมด ตอนนั้นไม่มีใครเห็นเพราะเมนู "แจ้งปัญหา" เปิดให้
   * admin เท่านั้น — แต่ **"ไม่มีใครเห็น" ไม่เท่ากับ "ไม่มีใครเข้าถึงได้"** ใครที่ล็อกอินแล้วยิง
   * /api/pulse ตรงๆ ก็ได้ตัวเลขนี้อยู่ดี และพอเมนูนี้เปิดให้พนักงานเข้า (ฟีเจอร์ "บันทึกการส่ง")
   * ตัวเลขตั๋วค้างทั้งบริษัทจะไปโผล่บนเมนูของเขาทันที ซึ่งไม่ใช่ข้อมูลของเขาและชวนเข้าใจผิดว่าเป็นของตัวเอง
   *
   * ผูกขอบเขตที่ฝั่งเซิร์ฟเวอร์ ไม่ใช่ซ่อนที่หน้าจอ — แบบเดียวกับ feed ด้านล่างที่แยกตาม role อยู่แล้ว
   * (เจอ 17 ก.ย. 69 ตอนเปลี่ยนเมนูให้พนักงานเห็น) */
  const openTicketCount =
    role !== 'user'
      ? await prisma.supportTicket.count({ where: { status: 'open' } })
      : employeeId
        ? await prisma.supportTicket.count({ where: { status: 'open', employeeId } })
        // บัญชี role 'user' ที่ยังไม่ได้ผูกกับพนักงานคนไหน = ไม่มีตั๋วของตัวเองได้เลย ตอบ 0 ไม่ต้องถาม DB
        // (ถ้าปล่อยผ่านไปนับโดยไม่กรอง จะกลายเป็นยอดทั้งบริษัท ซึ่งเป็นสิ่งที่กำลังปิดอยู่พอดี)
        : 0;

  const feed =
    role === 'user'
      ? employeeId
        ? await employeeTimesheetFeed(employeeId, { limit: 25 })
        : { items: [], latestAt: null, counts: { total: 0, critical: 0 } }
      : await activityFeed({ limit: 25, contractId: role === 'executive' ? null : activeContract?.id ?? null });

  return {
    needsAction: NEEDS_ACTION.reduce((sum, k) => sum + (byStatus[k] ?? 0), 0) + waitingCheck,
    waitingCheck,
    readyToApprove,
    feed,
    flowAccountMode: await currentFlowAccountMode(),
    manualMode: billingRules.requireHumanCheck !== false,
    openTicketCount,
    actor,
    role,
  };
}

'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Card, EmptyState, ErrorState, Loading, PageHeader, Tag } from '../../../components/ui';
import { Icon } from '../../../components/Icon';
import { useLang } from '../../../lib/language';

interface EmployeeProgressPeriod {
  period: string;
  periodLabel: string;
  timesheetId: string | null;
  timesheetStatus: string;
  timesheetStatusLabel: string;
  receivedAt: string | null;
  submissionMethod: string | null;
  checkedBy: string | null;
  checkedAt: string | null;
  billed: boolean;
  invoiceStatus: string | null;
  invoiceNo: string | null;
  invoiceCreatedAt: string | null;
  documentDate: string | null;
  dueDate: string | null;
  emailSentAt: string | null;
  paymentAmount: number | null;
  billedBy: string | null;
  billedAt: string | null;
}
interface EmployeeProgressContract {
  contractId: string;
  poNo: string;
  creditDays: number;
  projectName: string;
  customerName: string;
  periods: EmployeeProgressPeriod[];
}
interface EmployeeProgress {
  employee: { id: string; nameTh: string; nameEn: string | null; position: string; lineLinked: boolean };
  currentPeriod: string;
  currentPeriodLabel: string;
  contracts: EmployeeProgressContract[];
}
interface Settings {
  env: { hasLine: boolean };
}

/** ported from public/app.js's dt() — วันที่/เวลาแบบไทยสั้นๆ */
function dt(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  return d.toLocaleString('th-TH', { day: 'numeric', month: 'short', year: '2-digit', hour: '2-digit', minute: '2-digit' });
}

/**
 * รอบหนึ่งอยู่กลุ่มไหนในสายตาพนักงาน — หน้านี้มีคนดูคนเดียวคือเจ้าของ Timesheet ที่ทำอะไรได้อยู่
 * อย่างเดียวคือ "ส่งไฟล์" คำถามเดียวที่เขาต้องการคำตอบจึงเป็น **"รอบไหนที่ฉันต้องลงมือ"**
 *
 * - `future`  = ยังไม่ถึงรอบ (เดือนยังไม่จบ/ยังมาไม่ถึง) — ส่งไม่ได้ ไม่ควรขึ้นว่า "ยังไม่ได้ส่ง" ปนกับ
 *               รอบที่ค้างจริง เพราะอ่านแล้วเหมือนตัวเองค้างงานทั้งที่ยังไม่ถึงกำหนด
 * - `action`  = ถึงกำหนดแล้วแต่ยังไม่ส่ง หรือถูกตีกลับให้แก้ — **กลุ่มเดียวที่พนักงานทำอะไรได้**
 * - `waiting` = ส่งแล้ว รอฝ่ายบัญชีตรวจ/วางบิล — ไม่มีอะไรต้องทำ แค่ติดตาม
 * - `done`    = วางบิลแล้ว จบรอบ
 */
type Bucket = 'action' | 'waiting' | 'done' | 'future';

function bucketOf(p: EmployeeProgressPeriod, currentPeriod: string): Bucket {
  if (p.period > currentPeriod) return 'future';
  if (p.billed) return 'done';
  if (p.timesheetStatus === 'not_submitted' || p.timesheetStatus === 'rejected') return 'action';
  return 'waiting';
}

/**
 * ลำดับที่เจ้าของระบบขอให้ "เรียงใหม่" — รอบที่ต้องลงมือขึ้นก่อนเสมอ ที่เหลือเรียงใหม่→เก่าตามเดิม
 * ส่วนรอบที่ยังไม่ถึงกำหนดถูกยกไปไว้ท้ายสุดแบบพับเก็บ (ดู FutureList) ไม่ปนกับรอบที่ค้างจริง
 *
 * ⚠️ ข้อนี้ตีความจากคำสั่งสั้นๆ ("เรียงลำดับเดือนใหม่") — เดิมเรียงใหม่→เก่าอยู่แล้ว จึงเดาว่าที่ติดคือ
 * รอบที่ต้องส่งไม่ได้อยู่บนสุด ถ้าเจ้าของระบบหมายถึงอย่างอื่น แก้ที่ฟังก์ชันนี้จุดเดียวจบ
 */
const BUCKET_ORDER: Record<Bucket, number> = { action: 0, waiting: 1, done: 2, future: 3 };

function sortPeriods(periods: EmployeeProgressPeriod[], currentPeriod: string): EmployeeProgressPeriod[] {
  return [...periods].sort((a, b) => {
    const ba = BUCKET_ORDER[bucketOf(a, currentPeriod)];
    const bb = BUCKET_ORDER[bucketOf(b, currentPeriod)];
    if (ba !== bb) return ba - bb;
    return b.period.localeCompare(a.period);
  });
}

type StepState = 'dn' | 'cu' | 'wn' | '';

/** สามขั้นของรอบบิลตามลำดับจริง (ส่ง → ตรวจ → วางบิล) — เดิมวาดเป็นสามแถวเท่ากันหมดเหมือนตาราง
 * ทั้งที่มันเป็นลำดับขั้น อ่านแล้วไม่รู้ว่าตอนนี้ค้างอยู่ตรงไหน */
function stepsOf(p: EmployeeProgressPeriod): Array<{ key: string; label: string; icon: string; state: StepState; at: string | null }> {
  const submitted = Boolean(p.timesheetId);
  const rejected = p.timesheetStatus === 'rejected';
  const mismatch = p.timesheetStatus === 'mismatch';
  const checked = Boolean(p.checkedAt) || p.billed;

  return [
    {
      key: 'submit',
      label: 'ส่ง Timesheet',
      icon: 'up',
      state: rejected ? 'wn' : submitted ? 'dn' : 'cu',
      at: p.receivedAt,
    },
    {
      key: 'check',
      label: 'ตรวจ Manday',
      icon: 'list-chk',
      state: mismatch ? 'wn' : checked ? 'dn' : submitted ? 'cu' : '',
      at: p.checkedAt,
    },
    {
      key: 'bill',
      label: 'อนุมัติวางบิล',
      icon: 'invoice',
      state: p.billed ? 'dn' : checked ? 'cu' : '',
      at: p.billedAt,
    },
  ];
}

function PeriodRow({ p, bucket }: { p: EmployeeProgressPeriod; bucket: Bucket }) {
  const { tx } = useLang();
  const steps = stepsOf(p);
  // ขั้นที่ค้างอยู่ตอนนี้ = ตัวแรกที่ยังไม่เสร็จ — เอามาเขียนเป็นประโยคเดียวใต้ชื่อเดือน แทนที่จะให้คนไล่
  // อ่านสามแถวแล้วสรุปเอง
  const current = steps.find((s) => s.state === 'cu' || s.state === 'wn') ?? null;
  const lastDone = [...steps].reverse().find((s) => s.state === 'dn' && s.at) ?? null;

  return (
    <div className={`mypg-row ${bucket}`}>
      <div className="mypg-when">
        <span className="mypg-month">{p.periodLabel}</span>
        <span className="mypg-sub">
          {bucket === 'future'
            ? tx('ยังไม่ถึงกำหนดส่ง')
            : p.invoiceNo
              ? `${tx('เลขที่เอกสาร')} ${p.invoiceNo}`
              : lastDone
                ? `${tx(lastDone.label)} · ${dt(lastDone.at)}`
                : tx(p.timesheetStatusLabel)}
        </span>
      </div>

      {/* ไทม์ไลน์ย่อ — จุดสีบอกว่าถึงขั้นไหนแล้ว hover ดูวันเวลาได้ ไม่กินพื้นที่เท่าสามแถวแบบเดิม */}
      <div className="mypg-steps" aria-hidden={bucket === 'future'}>
        {steps.map((s, i) => (
          <span key={s.key} className="mypg-stepwrap">
            {i > 0 && <span className={`mypg-bar ${steps[i - 1].state === 'dn' ? 'dn' : ''}`} />}
            <span
              className={`mypg-step ${bucket === 'future' ? 'off' : s.state}`}
              title={`${tx(s.label)}${s.at ? ` · ${dt(s.at)}` : ''}`}
            >
              <Icon name={s.state === 'dn' ? 'chk' : s.icon} />
            </span>
          </span>
        ))}
      </div>

      <div className="mypg-act">
        {bucket === 'action' ? (
          <Link href="/upload" className="btn sm pri">
            <Icon name="up" className="sm" /> {tx(p.timesheetStatus === 'rejected' ? 'ส่งใหม่อีกครั้ง' : 'ส่งไฟล์ Timesheet')}
          </Link>
        ) : (
          <Tag tone={bucket === 'done' ? 'ok' : bucket === 'waiting' ? 'wn' : 'mu'}>
            {bucket === 'done' ? tx('วางบิลแล้ว') : bucket === 'waiting' ? tx(current ? current.label : p.timesheetStatusLabel) : tx('ยังไม่ถึงรอบ')}
          </Tag>
        )}
      </div>
    </div>
  );
}

/** รอบที่ยังมาไม่ถึง — พับเก็บไว้ท้ายสุด เห็นได้ถ้าอยากดูล่วงหน้า แต่ไม่มาปนกับรอบที่ต้องลงมือจริง */
function FutureList({ periods }: { periods: EmployeeProgressPeriod[] }) {
  const { tx } = useLang();
  const [open, setOpen] = useState(false);
  if (periods.length === 0) return null;
  return (
    <div className="mypg-future">
      <button type="button" className="mypg-futuretoggle" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        <Icon name="chev" className={open ? 'mypg-chev on' : 'mypg-chev'} />
        {tx('รอบที่ยังไม่ถึงกำหนด')} ({periods.length})
      </button>
      {open && periods.map((p) => <PeriodRow key={p.period} p={p} bucket="future" />)}
    </div>
  );
}

/** ported from public/app.js's renderMyProgress() — หน้าเริ่มต้นของ role 'user' (พนักงาน)
 * ดูได้แค่ progress รอบบิลของสัญญาที่ตัวเองมีอัตราจ้างอยู่ ไม่เห็นยอดเงิน/ของคนอื่น
 *
 * ปรับ UX ใหม่ 18 ก.ย. 69 ตามที่เจ้าของระบบสั่ง ("ให้มันใช้งานง่าย เรียงลำดับเดือนใหม่") — ของเดิมเป็น
 * การ์ดสูงๆ หน้าตาเหมือนกันทุกใบและเป็น "—" ทั้งหมด เห็นได้ทีละ 1-2 รอบต่อจอ และไม่มีทางรู้ว่าต้องทำ
 * อะไรต่อ ตอนนี้: หนึ่งรอบ = หนึ่งแถวเตี้ยๆ มีไทม์ไลน์ย่อบอกว่าค้างขั้นไหน รอบที่ต้องลงมือถูกดันขึ้นบนสุด
 * พร้อมปุ่มพาไปส่งไฟล์ (สิ่งเดียวที่พนักงานทำได้จากหน้านี้) ส่วนรอบที่ยังมาไม่ถึงถูกพับเก็บไว้ท้ายสุด */
export default function MyProgressClient() {
  const { tx } = useLang();
  const [progress, setProgress] = useState<EmployeeProgress | null | undefined>(undefined);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [error, setError] = useState<string | null>(null);

  function load() {
    setError(null);
    Promise.all([
      fetch('/api/my-progress', { cache: 'no-store' }),
      fetch('/api/settings', { cache: 'no-store' }),
    ])
      .then(async ([progressRes, settingsRes]) => {
        if (!progressRes.ok || !settingsRes.ok) {
          const data = await (!progressRes.ok ? progressRes : settingsRes).json().catch(() => ({}));
          setError(data?.error ?? tx('โหลดข้อมูลไม่สำเร็จ'));
          return;
        }
        setProgress(await progressRes.json());
        setSettings(await settingsRes.json());
      })
      .catch(() => setError(tx('เชื่อมต่อเซิร์ฟเวอร์ไม่ได้')));
  }

  useEffect(load, []);

  if (error) {
    return (
      <>
        <PageHeader eyebrow={tx('พนักงาน')} title={tx('ความคืบหน้าของฉัน')} />
        <ErrorState message={error} onRetry={load} />
      </>
    );
  }

  if (progress === undefined || !settings) {
    return (
      <>
        <PageHeader eyebrow={tx('พนักงาน')} title={tx('ความคืบหน้าของฉัน')} />
        <Loading variant="cards" rows={3} />
        <Card>
          <Loading rows={4} />
        </Card>
      </>
    );
  }

  if (!progress) {
    return (
      <>
        <PageHeader eyebrow={tx('พนักงาน')} title={tx('ความคืบหน้าของฉัน')} />
        <Card>
          <EmptyState label={tx('บัญชีนี้ยังไม่ได้ผูกกับพนักงานคนไหน — แจ้ง admin ให้ผูกบัญชีกับชื่อพนักงานก่อน')} />
        </Card>
      </>
    );
  }

  // นับรอบที่ต้องลงมือข้ามทุกสัญญา — เอาไว้ขึ้นแถบสรุปบนสุด ให้รู้ตั้งแต่ยังไม่ทันเลื่อนจอว่ามีอะไรค้าง
  const actionCount = progress.contracts.reduce(
    (n, c) => n + c.periods.filter((p) => bucketOf(p, progress.currentPeriod) === 'action').length,
    0,
  );

  return (
    <>
      <PageHeader
        eyebrow={tx('พนักงาน')}
        title={tx('ความคืบหน้าของฉัน')}
        subtitle={`${progress.employee.nameTh}${progress.employee.position ? ` — ${progress.employee.position}` : ''}`}
        actions={
          settings.env.hasLine ? (
            progress.employee.lineLinked ? (
              <Tag tone="ok">
                <Icon name="chk" /> {tx('เชื่อมต่อไลน์แล้ว')}
              </Tag>
            ) : (
              <Link href="/my-line-link" className="btn sm pri">
                {tx('เชื่อมต่อไลน์')}
              </Link>
            )
          ) : undefined
        }
      />

      {progress.contracts.length > 0 && (
        <div className={actionCount > 0 ? 'mypg-banner act' : 'mypg-banner'}>
          <Icon name={actionCount > 0 ? 'alt' : 'chk'} />
          <span>
            {actionCount > 0 ? (
              <>
                <b>{tx('ต้องส่ง Timesheet')} {actionCount} {tx('รอบ')}</b> — {tx('กดปุ่มในแถวที่ไฮไลต์ไว้เพื่อส่งไฟล์')}
              </>
            ) : (
              <b>{tx('ส่งครบทุกรอบที่ถึงกำหนดแล้ว')}</b>
            )}
          </span>
          {actionCount > 0 && (
            <Link href="/upload" className="btn sm pri">
              <Icon name="up" className="sm" /> {tx('ส่งไฟล์ Timesheet')}
            </Link>
          )}
        </div>
      )}

      {progress.contracts.length > 0 ? (
        progress.contracts.map((c) => {
          const sorted = sortPeriods(c.periods, progress.currentPeriod);
          const due = sorted.filter((p) => bucketOf(p, progress.currentPeriod) !== 'future');
          const future = sorted.filter((p) => bucketOf(p, progress.currentPeriod) === 'future');
          return (
            <Card key={c.contractId} title={c.customerName} right={<span className="sub">{c.projectName}</span>} flush>
              <div className="mypg-list">
                {due.length === 0 && future.length === 0 && (
                  <div className="mypg-empty">{tx('ยังไม่มีรอบบิลในสัญญานี้')}</div>
                )}
                {due.map((p) => (
                  <PeriodRow key={p.period} p={p} bucket={bucketOf(p, progress.currentPeriod)} />
                ))}
                <FutureList periods={future} />
              </div>
            </Card>
          );
        })
      ) : (
        <Card>
          <EmptyState label={tx('ยังไม่มีสัญญาที่ผูกกับตัวเอง')} />
        </Card>
      )}
    </>
  );
}

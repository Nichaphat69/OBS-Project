'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Card, EmptyState, ErrorState, PageHeader, Tag } from '../../../components/ui';
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

const STATUS_TONE: Record<string, 'ok' | 'wn' | 'cr' | 'pr' | 'mu'> = {
  verified: 'ok',
  mismatch: 'cr',
  billed: 'ok',
  rejected: 'mu',
  received: 'pr',
  extracted: 'pr',
  approved: 'ok',
};

/** ported from public/app.js's dt() — วันที่/เวลาแบบไทยสั้นๆ */
function dt(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  return d.toLocaleString('th-TH', { day: 'numeric', month: 'short', year: '2-digit', hour: '2-digit', minute: '2-digit' });
}

/** ไอคอน/สี .tic หัวการ์ดแต่ละรอบ — ยืมชุดเดียวกับการ์ดแจ้งเตือน (LEVEL_TONE) ให้เข้าธีมเดียวกัน */
function periodIcon(status: string): { tone: 'cr' | 'wn' | 'ok' | 'mu' | 'info'; ic: string } {
  if (status === 'mismatch') return { tone: 'cr', ic: 'alt' };
  if (status === 'rejected') return { tone: 'wn', ic: 'alt' };
  if (status === 'verified' || status === 'approved' || status === 'billed') return { tone: 'ok', ic: 'chk' };
  if (status === 'not_submitted') return { tone: 'mu', ic: 'clock' };
  return { tone: 'info', ic: 'info' };
}

function PeriodCard({ p }: { p: EmployeeProgressPeriod }) {
  const { tone, ic } = periodIcon(p.timesheetStatus);
  const { tx } = useLang();
  return (
    <div className="rec">
      <div className="rec-hd">
        <span className={`tic ${tone}`}>
          <Icon name={ic} />
        </span>
        <span>
          <span className="nm2">{p.periodLabel}</span>
          <span className="mt2">{p.invoiceNo ? `${tx('เลขที่เอกสาร')} ${p.invoiceNo}` : tx('ยังไม่มีเลขที่เอกสาร')}</span>
        </span>
        <span className="rt2">
          <Tag tone={STATUS_TONE[p.timesheetStatus] ?? 'mu'}>{tx(p.timesheetStatusLabel)}</Tag>
        </span>
      </div>
      <div className="minitab">
        <div className="mr">
          <span className="lb2">{tx('ส่ง Timesheet')}</span>
          <span className="q" />
          <span className="p">{p.receivedAt ? dt(p.receivedAt) : '—'}</span>
        </div>
        <div className="mr">
          <span className="lb2">
            {tx('ตรวจ Manday')}
            <small>{p.checkedBy ?? tx('ยังไม่มีคนตรวจ')}</small>
          </span>
          <span className="q" />
          <span className="p">{p.checkedAt ? dt(p.checkedAt) : '—'}</span>
        </div>
        <div className="mr">
          <span className="lb2">
            {tx('อนุมัติวางบิล')}
            <small>{p.billedBy ?? tx('ยังไม่วางบิล')}</small>
          </span>
          <span className="q" />
          <span className="p">{p.billedAt ? dt(p.billedAt) : '—'}</span>
        </div>
      </div>
    </div>
  );
}

/** ported from public/app.js's renderMyProgress() — หน้าเริ่มต้นของ role 'user' (พนักงาน)
 * ดูได้แค่ progress รอบบิลของสัญญาที่ตัวเองมีอัตราจ้างอยู่ ไม่เห็นยอดเงิน/ของคนอื่น ไม่มีปุ่มทำรายการ
 * ใดๆทั้งสิ้น — ต่างจากต้นฉบับตรงที่ตัวเชื่อมต่อ/เลิกเชื่อมต่อ LINE ย้ายไปมีหน้าแยกของตัวเองแล้ว
 * (/my-line-link, พอร์ตไว้ก่อนหน้านี้) หน้านี้จึงโชว์แค่สถานะ + ลิงก์ไปหน้านั้นแทนที่จะฟอร์มซ้ำ */
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

  if (progress === undefined || !settings) return null;

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

      {progress.contracts.length > 0 ? (
        progress.contracts.map((c) => (
          <Card key={c.contractId} title={c.customerName} right={<span className="sub">{c.projectName}</span>}>
            <div className="cardgrid" style={{ gridTemplateColumns: '1fr' }}>
              {c.periods.map((p) => (
                <PeriodCard key={p.period} p={p} />
              ))}
            </div>
          </Card>
        ))
      ) : (
        <Card>
          <EmptyState label={tx('ยังไม่มีสัญญาที่ผูกกับตัวเอง')} />
        </Card>
      )}
    </>
  );
}

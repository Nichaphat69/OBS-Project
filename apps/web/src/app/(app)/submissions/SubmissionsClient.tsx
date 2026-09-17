'use client';

import { useEffect, useMemo, useState } from 'react';
import { Card, ErrorState, Kpi, PageHeader, StatusPill, Tag } from '../../../components/ui';
import { Icon } from '../../../components/Icon';
import { useConfirm, useToast } from '../../../components/Overlays';
import SupportTicketsPanel from './SupportTicketsPanel';
import { useLang } from '../../../lib/language';

/**
 * หน้ารวม "บันทึกการส่ง Timesheet ตามรอบบิล"
 *
 * คำถามที่หน้านี้ต้องตอบได้ในหน้าจอเดียว: รอบนี้ใครส่งแล้วหรือยัง · ส่งผ่านช่องทางไหน · เมื่อไหร่ ·
 * ตอนนี้อยู่ขั้นไหน · มีใครแจ้งปัญหาไหม
 *
 * ⚠️ คำที่ใช้เรียก "ช่องทางการส่ง" มีได้แค่สามคำตามที่เจ้าของระบบกำหนด และ **ห้ามมีคำว่า LINE อยู่ใน
 * คอลัมน์นั้น** — LINE คือช่องแจ้งเตือนที่ยิงไปให้พนักงานเลือกวิธี ไม่ใช่วิธีส่ง ด้วยเหตุผลเดียวกัน
 * "กดเลื่อนไว้ก่อน" ก็ไม่ใช่ช่องทาง แต่เป็นการตอบกลับ — คนกดเลื่อนยังไม่ได้เลือกช่องทางเลย จึงแสดง
 * ช่องทางเป็น "—" แล้วติดป้ายแยกว่าขอเลื่อนเมื่อไหร่ ไม่ปนกับตัวเลข "ยังไม่ส่ง" ในการ์ดสรุป
 *
 * แถวมาจากฝั่งเซิร์ฟเวอร์ครบทุกคนในรอบ (หนึ่งคน-หนึ่งรอบ = หนึ่งแถวเสมอ) รวมคนที่ยังไม่กดอะไรเลยด้วย —
 * หน้านี้ห้าม filter คนที่ไม่มีข้อมูลออกไปเอง เพราะคนที่ยังเงียบคือคนที่ต้องตามมากที่สุด
 */

type Status = 'not_submitted' | 'submitted' | 'pending_review' | 'confirmed' | 'problem';
type Method = 'self_obs' | 'self_email' | 'proxy_email';

const METHOD_LABEL: Record<Method, string> = {
  self_obs: 'ส่งผ่านระบบ OBS',
  self_email: 'ส่งผ่าน Email',
  proxy_email: 'ให้ผู้ดูแลเป็นคนส่ง',
};

const STATUS_LABEL: Record<Status, string> = {
  not_submitted: 'ยังไม่ส่ง',
  submitted: 'ส่งแล้ว',
  pending_review: 'รอตรวจสอบ',
  confirmed: 'ยืนยันแล้ว',
  problem: 'มีปัญหา',
};

const STATUS_TONE: Record<Status, 'ok' | 'wn' | 'cr' | 'mu'> = {
  not_submitted: 'mu',
  submitted: 'wn',
  pending_review: 'wn',
  confirmed: 'ok',
  problem: 'cr',
};

interface SubmissionRow {
  employeeId: string;
  employeeName: string;
  contractId: string;
  customerName: string;
  projectName: string;
  period: string;
  periodLabel: string;
  dueDate: string;
  status: Status;
  method: Method | null;
  methodChosenAt: string | null;
  deferredAt: string | null;
  actedBy: string | null;
  replyOk: boolean | null;
  replyFailureReason: string | null;
  reviewedBy: string | null;
  reviewedAt: string | null;
  note: string | null;
  timesheetId: string | null;
  canReceiveLineUpdates: boolean;
}

interface ListResult {
  scope: { restrictedToEmployeeId: string | null; mine: boolean };
  rows: SubmissionRow[];
  summary: Record<Status, number>;
  unknownDueToNoLineLink: number;
}

const TABS = [
  { key: 'overview', label: 'ภาพรวม' },
  { key: 'list', label: 'รายการส่ง' },
  { key: 'review', label: 'รอตรวจสอบ' },
  { key: 'tickets', label: 'แจ้งปัญหา' },
] as const;

type TabKey = (typeof TABS)[number]['key'];

function dt(s: string | null) {
  return s ? s.replace('T', ' ').slice(0, 16) : '—';
}

export default function SubmissionsClient({ role }: { role: string }) {
  const { tx } = useLang();
  const toast = useToast();
  const confirm = useConfirm();
  const isStaff = role === 'admin' || role === 'accounting';

  const [tab, setTab] = useState<TabKey>('overview');
  const [period, setPeriod] = useState('');
  const [status, setStatus] = useState('');
  const [method, setMethod] = useState('');
  const [data, setData] = useState<ListResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reviewing, setReviewing] = useState<string | null>(null);

  // แท็บแจ้งปัญหายังเป็นของ admin เท่านั้นเหมือนเดิม — หน้านี้เปิดกว้างขึ้น แต่ไม่ได้แปลว่าฟังก์ชันเดิม
  // ต้องเปิดตามไปด้วย ตัวกันจริงอยู่ที่ /api/support-tickets ซึ่ง requireAdmin อยู่แล้ว
  const visibleTabs = TABS.filter((t) => (t.key === 'tickets' ? role === 'admin' : true));

  // พนักงานยิงเส้น /mine เสมอ — ไม่ใช่ /?employeeId=... เพราะการกันคนอื่นเห็นของตัวเองต้องอยู่ที่ว่า
  // ยิงเส้นไหน ไม่ใช่ที่พารามิเตอร์ ถ้าให้พนักงานยิงเส้นเดียวกับ admin แล้วหวังว่า query จะจำกัดถูก
  // มันจะกลายเป็นช่องโหว่ทันทีที่มีใครลืมเช็ค role ในโค้ดสักจุด
  function load() {
    setError(null);
    const qs = new URLSearchParams();
    if (period) qs.set('period', period);
    if (status) qs.set('status', status);
    if (method) qs.set('method', method);
    const path = isStaff ? '/api/timesheet-submissions' : '/api/timesheet-submissions/mine';
    fetch(`${path}${qs.toString() ? `?${qs}` : ''}`, { cache: 'no-store' })
      .then(async (r) => {
        if (!r.ok) {
          const body = await r.json().catch(() => ({}));
          setError(body?.error ?? tx('โหลดข้อมูลไม่สำเร็จ'));
          return;
        }
        setData(await r.json());
      })
      .catch(() => setError(tx('เชื่อมต่อเซิร์ฟเวอร์ไม่ได้')));
  }

  useEffect(load, [period, status, method, isStaff]);

  async function review(row: SubmissionRow, next: 'confirmed' | 'problem') {
    if (next === 'problem') {
      const ok = await confirm({
        danger: true,
        title: tx('ทำเครื่องหมายว่ามีปัญหา?'),
        message: `${row.employeeName} · ${row.periodLabel}`,
        confirmLabel: tx('ทำเครื่องหมาย'),
      });
      if (!ok) return;
    }
    const key = `${row.employeeId}|${row.period}`;
    setReviewing(key);
    try {
      const res = await fetch(`/api/timesheet-submissions/${encodeURIComponent(row.employeeId)}/${encodeURIComponent(row.period)}/review`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ status: next }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast(body?.error ?? tx('บันทึกไม่สำเร็จ'), true);
        return;
      }
      toast(next === 'confirmed' ? tx('ยืนยันแล้ว') : tx('ทำเครื่องหมายว่ามีปัญหาแล้ว'));
      load();
    } catch {
      toast(tx('เชื่อมต่อเซิร์ฟเวอร์ไม่ได้'), true);
    } finally {
      setReviewing(null);
    }
  }

  const rows = data?.rows ?? [];
  const reviewRows = useMemo(() => rows.filter((r) => r.status === 'pending_review'), [rows]);
  const listRows = tab === 'review' ? reviewRows : rows;

  return (
    <>
      <PageHeader
        eyebrow={tx('อ้างอิง')}
        title={tx('บันทึกการส่ง')}
        subtitle={tx('ติดตามและบันทึกสถานะการส่ง Timesheet ตามรอบบิล')}
      />

      {data?.scope.mine && (
        <div className="scopebar">
          <Icon name="info" />
          <span>{tx('หน้านี้แสดงเฉพาะรายการส่งของคุณเอง')}</span>
        </div>
      )}

      {data && data.unknownDueToNoLineLink > 0 && (
        <div className="scopebar all">
          <Icon name="info" />
          <span>
            {data.unknownDueToNoLineLink} {tx('รายการยังไม่ทราบสถานะจริง เพราะพนักงานยังไม่ได้ผูกบัญชี LINE — ไม่ใช่ยืนยันแล้วว่าไม่ส่ง')}
          </span>
        </div>
      )}

      <div className="kpis k5">
        <Kpi icon="list-chk" label={tx('ทั้งหมด')} value={data ? rows.length : '—'} />
        <Kpi icon="chk" label={tx('ส่งแล้ว')} value={data ? data.summary.submitted + data.summary.confirmed : '—'} tone="g" />
        <Kpi icon="clock" label={tx('ยังไม่ส่ง')} value={data ? data.summary.not_submitted : '—'} tone="c" />
        <Kpi icon="eye" label={tx('รอตรวจสอบ')} value={data ? data.summary.pending_review : '—'} tone="w" />
        <Kpi icon="alt" label={tx('มีปัญหา')} value={data ? data.summary.problem : '—'} tone="c" />
      </div>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 18 }}>
        {visibleTabs.map((t) => (
          <button key={t.key} onClick={() => setTab(t.key)} className={`btn sm${tab === t.key ? ' pri' : ''}`}>
            {tx(t.label)}
            {t.key === 'review' && data && ` (${reviewRows.length})`}
          </button>
        ))}
      </div>

      {tab === 'tickets' ? (
        // ฟังก์ชันแจ้งปัญหาเดิมยกมาทั้งก้อน ไม่แตะตรรกะเลย — เจ้าของระบบสั่งว่าอย่าทิ้งของเดิม
        <SupportTicketsPanel />
      ) : (
        <Card
          title={tx(TABS.find((t) => t.key === tab)?.label ?? '')}
          right={
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <input
                type="month"
                value={period}
                onChange={(e) => setPeriod(e.target.value)}
                style={{ font: 'inherit', fontSize: 12.5, height: 'var(--h-ctl-sm)', padding: '0 8px', border: '1px solid var(--rule)', borderRadius: 'var(--r-ctl)' }}
              />
              {tab !== 'review' && (
                <select
                  value={status}
                  onChange={(e) => setStatus(e.target.value)}
                  style={{ font: 'inherit', fontSize: 12.5, height: 'var(--h-ctl-sm)', padding: '0 8px', border: '1px solid var(--rule)', borderRadius: 'var(--r-ctl)' }}
                >
                  <option value="">{tx('ทุกสถานะ')}</option>
                  {(Object.keys(STATUS_LABEL) as Status[]).map((s) => (
                    <option key={s} value={s}>{tx(STATUS_LABEL[s])}</option>
                  ))}
                </select>
              )}
              <select
                value={method}
                onChange={(e) => setMethod(e.target.value)}
                style={{ font: 'inherit', fontSize: 12.5, height: 'var(--h-ctl-sm)', padding: '0 8px', border: '1px solid var(--rule)', borderRadius: 'var(--r-ctl)' }}
              >
                <option value="">{tx('ทุกช่องทาง')}</option>
                {(Object.keys(METHOD_LABEL) as Method[]).map((m) => (
                  <option key={m} value={m}>{tx(METHOD_LABEL[m])}</option>
                ))}
              </select>
            </div>
          }
        >
          {error ? (
            <ErrorState message={error} onRetry={load} />
          ) : !data ? (
            <div className="sub">{tx('กำลังโหลด…')}</div>
          ) : (
            <div className="tw">
              <table>
                <thead>
                  <tr>
                    <th>{tx('ลำดับ')}</th>
                    <th>{tx('พนักงาน')}</th>
                    <th>{tx('รอบบิล')}</th>
                    <th>{tx('สถานะการส่ง')}</th>
                    <th>{tx('ช่องทางการส่ง')}</th>
                    <th>{tx('วันที่/เวลาที่ส่ง')}</th>
                    <th>{tx('สถานะการตรวจสอบ')}</th>
                    <th>{tx('ผู้ดำเนินการ')}</th>
                    {isStaff && <th />}
                  </tr>
                </thead>
                <tbody>
                  {listRows.map((r, i) => (
                    <tr key={`${r.employeeId}|${r.period}`}>
                      <td className="sub">{i + 1}</td>
                      <td>
                        {r.employeeName}
                        <div className="sub">{r.customerName} · {r.projectName}</div>
                      </td>
                      <td>{r.periodLabel}</td>
                      <td>
                        <StatusPill tone={STATUS_TONE[r.status]}>{tx(STATUS_LABEL[r.status])}</StatusPill>
                        {r.deferredAt && (
                          <div className="sub">{tx('ขอเลื่อน')} · {dt(r.deferredAt)}</div>
                        )}
                        {!r.canReceiveLineUpdates && r.status === 'not_submitted' && (
                          <div className="sub">{tx('ยังไม่ผูก LINE — ระบบไม่มีทางรู้สถานะจริง')}</div>
                        )}
                      </td>
                      <td>
                        {r.method ? <Tag tone="mu">{tx(METHOD_LABEL[r.method])}</Tag> : '—'}
                        {r.replyOk === false && (
                          <div className="sub" style={{ color: 'var(--wn)' }}>{tx('พนักงานอาจไม่เห็นข้อความตอบกลับ')}</div>
                        )}
                      </td>
                      <td className="sub">{dt(r.methodChosenAt)}</td>
                      <td>
                        {r.reviewedBy ? (
                          <>
                            {tx(r.status === 'problem' ? STATUS_LABEL.problem : STATUS_LABEL.confirmed)}
                            <div className="sub">{r.reviewedBy} · {dt(r.reviewedAt)}</div>
                          </>
                        ) : (
                          <span className="sub">{tx('ยังไม่มีคนตรวจ')}</span>
                        )}
                      </td>
                      <td className="sub">{r.actedBy ?? '—'}</td>
                      {isStaff && (
                        <td>
                          {r.status === 'pending_review' && (
                            <div style={{ display: 'flex', gap: 6 }}>
                              <button
                                className="btn sm"
                                disabled={reviewing === `${r.employeeId}|${r.period}`}
                                onClick={() => review(r, 'confirmed')}
                              >
                                {tx('ยืนยัน')}
                              </button>
                              <button
                                className="btn sm"
                                disabled={reviewing === `${r.employeeId}|${r.period}`}
                                onClick={() => review(r, 'problem')}
                              >
                                {tx('มีปัญหา')}
                              </button>
                            </div>
                          )}
                        </td>
                      )}
                    </tr>
                  ))}
                  {listRows.length === 0 && (
                    <tr>
                      <td colSpan={isStaff ? 9 : 8} style={{ textAlign: 'center', color: 'var(--mut)' }}>
                        {tx('ไม่มีรายการในหมวดนี้')}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}
    </>
  );
}

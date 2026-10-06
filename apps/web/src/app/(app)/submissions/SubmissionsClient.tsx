'use client';

import { useEffect, useRef, useState } from 'react';
import { Card, ErrorState, Loading, PageHeader, StatusPill, Tag, TabStrip } from '../../../components/ui';
import { Icon } from '../../../components/Icon';
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
 *
 * ⚠️ หน้านี้เป็นหน้า "ดู" ล้วนๆ ไม่ใช่หน้าอนุมัติ/รีวิว (เจ้าของระบบยืนยันตรงๆ 18 ก.ย. 69) — admin/
 * accounting เปิดมาเพื่อรู้ว่าใครจะส่งทางไหน ไม่ได้มากดยืนยัน/ตีกลับจากหน้านี้ จึงไม่มีปุ่ม action
 * ใดๆ ในตาราง แม้แต่ในแท็บ "รอตรวจสอบ" — เส้น PATCH .../review ฝั่ง API ยังอยู่เผื่อมีที่ใช้ทีหลัง
 * แค่หน้านี้ไม่เรียกมันแล้ว
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
  customerId: string;
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

/* เหลือสองแท็บตามที่เจ้าของระบบสั่ง 18 ก.ย. 69 — "ภาพรวม" กับ "รายการส่ง" วาดตารางชุดเดียวกันเป๊ะ
   จึงเป็นแท็บซ้ำที่ไม่ได้ให้อะไรเพิ่ม ส่วน "รอตรวจสอบ" เป็นซากของตอนที่หน้านี้ยังมีปุ่มยืนยัน/ตีกลับ
   ซึ่งถูกถอดออกไปแล้ว (ดูหมายเหตุหัวไฟล์: หน้านี้เป็นหน้า "ดู" ล้วนๆ) — สถานะรอตรวจสอบยังกรองได้จาก
   ตัวกรอง "ทุกสถานะ" อยู่แล้ว ไม่ต้องมีแท็บของตัวเอง */
const TABS = [
  { key: 'list', label: 'รายการส่ง' },
  { key: 'tickets', label: 'แจ้งปัญหา' },
] as const;

type TabKey = (typeof TABS)[number]['key'];

const STATUS_DOT: Record<Status, string> = {
  not_submitted: '#d5dce6',
  submitted: '#f6d27c',
  pending_review: '#f5b878',
  confirmed: '#7ccfa4',
  problem: '#f28b8b',
};

const STATUS_ORDER: Status[] = ['not_submitted', 'submitted', 'pending_review', 'confirmed', 'problem'];


function pct(n: number, total: number): string {
  if (total === 0) return '0%';
  return `${Math.round((n / total) * 100)}%`;
}

/**
 * ตัวกรองทั้งหมดรวมอยู่ในปุ่มเดียว กดแล้วกางแผงให้เลือกทีละหัวข้อ (เจ้าของระบบสั่ง 27 ก.ย. 69
 * "รวมทั้ง 4 ปุ่มให้อยู่ในปุ่มเดียวกันเลย พอคลิกเข้าไปแล้วก็ให้เลือก 4 หัวข้อย่อยอีกที")
 *
 * เดิมวางชิปเลือก 3 อันเรียงกันบนหัวการ์ด พอเพิ่มตัวกรองบริษัทเข้าไปเป็น 4 อันก็ยาวจนเบียดชื่อการ์ด
 * ปุ่มเดียวยังบอกจำนวนตัวกรองที่เปิดอยู่ด้วย จะได้รู้ว่ากำลังดูข้อมูลที่ถูกกรองอยู่ ไม่ใช่ทั้งหมด
 */
function FilterMenu({
  open, onToggle, onClose, activeCount, onClear, groups,
}: {
  open: boolean;
  onToggle: () => void;
  onClose: () => void;
  activeCount: number;
  onClear: () => void;
  groups: Array<{
    label: string;
    value: string;
    onChange: (v: string) => void;
    allLabel: string;
    /** ตัวเลือกน้อย (≤6) แสดงเป็นชิปกดเลือกได้ทันที · เยอะกว่านั้นใช้ช่องเลือกแบบเลื่อนลง */
    options: Array<{ value: string; label: string; count?: number; dot?: string }>;
  }>;
}) {
  const { tx } = useLang();
  const box = useRef<HTMLDivElement>(null);

  // ปิดเมื่อคลิกนอกแผง — แผงลอยทับเนื้อหาอยู่ ถ้าไม่ปิดเองจะบังตารางที่เพิ่งกรองเสร็จ
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) onClose();
    };
    const onEsc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onEsc);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onEsc);
    };
  }, [open, onClose]);

  return (
    <div className="fmenu" ref={box}>
      <button type="button" className={`btn sm${activeCount ? ' pri' : ''}`} onClick={onToggle} aria-expanded={open}>
        <Icon name="cog" className="sm" /> {tx('ตัวกรอง')}
        {activeCount > 0 && <span className="fmenu-n">{activeCount}</span>}
      </button>
      {open && (
        <div className="fmenu-panel sl-fpanel">
          <div className="sl-fhead">
            <b>{tx('ตัวกรอง')}</b>
            <button type="button" className="sl-clear" onClick={onClear} disabled={activeCount === 0}>
              {tx('ล้างตัวกรอง')}
            </button>
          </div>
          {groups.map((g) => (
            <div key={g.label} className="sl-fgroup">
              <span className="fmenu-lbl">{tx(g.label)}</span>
              {g.options.length <= 6 ? (
                <div className="sl-fchips">
                  <button type="button" className={`sl-fchip${g.value === '' ? ' on' : ''}`} onClick={() => g.onChange('')}>
                    {tx(g.allLabel)}
                  </button>
                  {g.options.map((o) => (
                    <button
                      key={o.value}
                      type="button"
                      className={`sl-fchip${g.value === o.value ? ' on' : ''}`}
                      style={o.dot ? ({ '--dot': o.dot } as React.CSSProperties) : undefined}
                      onClick={() => g.onChange(g.value === o.value ? '' : o.value)}
                    >
                      {o.dot && <i />}
                      {o.label}
                      {typeof o.count === 'number' && <b>{o.count}</b>}
                    </button>
                  ))}
                </div>
              ) : (
                <span className="selectchip grow">
                  <select value={g.value} onChange={(e) => g.onChange(e.target.value)}>
                    <option value="">{tx(g.allLabel)}</option>
                    {g.options.map((o) => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </select>
                  <Icon name="chev" />
                </span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function SubmissionsClient({ role }: { role: string }) {
  const { tx, formatDateTime: dt, formatPeriodLabel } = useLang();
  const isStaff = role === 'admin' || role === 'accounting';

  const [tab, setTab] = useState<TabKey>('list');
  const [period, setPeriod] = useState('');
  /* สถานะกับคำค้นกรองฝั่งหน้าเว็บ (ไม่ส่งไป API) — ไม่งั้นพอกดกรองสถานะ ตัวเลขสรุปของสถานะอื่นจะกลายเป็น 0
     หมด ทั้งที่ตัวเลขพวกนั้นคือปุ่มกรองที่ต้องกดสลับไปมาได้ */
  const [status, setStatus] = useState<Status | ''>('');
  const [q, setQ] = useState('');
  const [method, setMethod] = useState('');
  const [customerId, setCustomerId] = useState('');
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [data, setData] = useState<ListResult | null>(null);
  /* รอบบิลที่มีอยู่จริง เก็บไว้ตอนที่ยังไม่ได้กรองรอบ — พอกรองรอบแล้วผลลัพธ์จะเหลือรอบเดียว ถ้าสร้าง
     ตัวเลือกจากผลลัพธ์ที่กรองแล้วจะเหลือให้เลือกแค่รอบที่เลือกอยู่ กลับไปรอบอื่นไม่ได้อีกเลย */
  const [periodOptions, setPeriodOptions] = useState<Array<{ value: string; label: string }>>([]);
  /* บริษัทที่มีอยู่จริง — เก็บตอนยังไม่ได้กรองบริษัท ด้วยเหตุผลเดียวกับ periodOptions ข้างบน */
  const [companyOptions, setCompanyOptions] = useState<Array<{ value: string; label: string }>>([]);
  const [error, setError] = useState<string | null>(null);

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
    if (method) qs.set('method', method);
    if (customerId) qs.set('customerId', customerId);
    const path = isStaff ? '/api/timesheet-submissions' : '/api/timesheet-submissions/mine';
    fetch(`${path}${qs.toString() ? `?${qs}` : ''}`, { cache: 'no-store' })
      .then(async (r) => {
        if (!r.ok) {
          const body = await r.json().catch(() => ({}));
          setError(body?.error ?? tx('โหลดข้อมูลไม่สำเร็จ'));
          return;
        }
        const body: ListResult = await r.json();
        setData(body);
        if (!period) {
          const seen = new Map<string, string>();
          for (const row of body.rows) seen.set(row.period, formatPeriodLabel(row.periodLabel));
          setPeriodOptions(
            [...seen]
              .sort((a, b) => b[0].localeCompare(a[0]))
              .map(([value, label]) => ({ value, label })),
          );
        }
        if (!customerId) {
          const seen = new Map<string, string>();
          for (const row of body.rows) seen.set(row.customerId, row.customerName);
          setCompanyOptions(
            [...seen]
              .filter(([value]) => value)
              .sort((a, b) => a[1].localeCompare(b[1], 'th'))
              .map(([value, label]) => ({ value, label })),
          );
        }
      })
      .catch(() => setError(tx('เชื่อมต่อเซิร์ฟเวอร์ไม่ได้')));
  }

  useEffect(load, [period, method, customerId, isStaff]);

  const allRows = data?.rows ?? [];
  const summary = (() => {
    const c: Record<Status, number> = { not_submitted: 0, submitted: 0, pending_review: 0, confirmed: 0, problem: 0 };
    for (const r of allRows) c[r.status] += 1;
    return c;
  })();
  const needle = q.trim().toLowerCase();
  const rows = allRows.filter(
    (r) =>
      (!status || r.status === status) &&
      (!needle || `${r.employeeName} ${r.customerName} ${r.projectName}`.toLowerCase().includes(needle)),
  );
  const submitted = summary.submitted + summary.confirmed;
  // ส่วนของโดนัท (เรียงตามความคืบหน้า: ยืนยันแล้ว → ส่งแล้ว → รอตรวจ → มีปัญหา → ยังไม่ส่ง)
  const SUM_ORDER: Status[] = ['confirmed', 'submitted', 'pending_review', 'problem', 'not_submitted'];
  const sumSegs = (() => {
    const total = allRows.length || 1;
    const live = SUM_ORDER.filter((k) => summary[k] > 0).length;
    const gap = live > 1 ? 0.8 : 0;
    let acc = 0;
    return SUM_ORDER.map((key) => {
      const share = (summary[key] / total) * 100;
      const seg = { key, count: summary[key], len: Math.max(share - gap, 0.1), offset: 25 - acc };
      acc += share;
      return seg;
    });
  })();
  const byPeriod = (() => {
    const m = new Map<string, { period: string; label: string; total: number; c: Record<Status, number> }>();
    for (const r of allRows) {
      let e = m.get(r.period);
      if (!e) {
        e = { period: r.period, label: formatPeriodLabel(r.periodLabel), total: 0, c: { not_submitted: 0, submitted: 0, pending_review: 0, confirmed: 0, problem: 0 } };
        m.set(r.period, e);
      }
      e.total += 1;
      e.c[r.status] += 1;
    }
    return [...m.values()].sort((x, y) => y.period.localeCompare(x.period)).slice(0, 4);
  })();
  const methodCounts = (() => {
    const c = { self_obs: 0, self_email: 0, proxy_email: 0, none: 0 };
    for (const r of allRows) c[r.method ?? 'none'] += 1;
    return c;
  })();
  const selStatus: Status | null = status || null;
  const selRows = selStatus ? allRows.filter((r) => r.status === selStatus) : [];
  const selByPeriod = (() => {
    const m = new Map<string, number>();
    for (const r of selRows) {
      const k = formatPeriodLabel(r.periodLabel);
      m.set(k, (m.get(k) ?? 0) + 1);
    }
    return [...m].map(([label, n]) => ({ label, n })).sort((x, y) => y.n - x.n).slice(0, 4);
  })();
  const selNames = [...new Set(selRows.map((r) => r.employeeName))];
  const selPeople = selNames.slice(0, 6);
  const selPeopleMore = Math.max(selNames.length - selPeople.length, 0);
  const advancedActive = [status, method, customerId].filter(Boolean).length;
  const anyFilter = Boolean(status || q || period || method || customerId);
  function clearAll() {
    setStatus(''); setQ(''); setPeriod(''); setMethod(''); setCustomerId('');
  }

  return (
    <>
      <PageHeader eyebrow={tx('อ้างอิง')} title={tx('บันทึกการส่ง')} />

      {data?.scope.mine && (
        <div className="scopebar">
          <Icon name="info" />
          <span>{tx('หน้านี้แสดงเฉพาะรายการส่งของคุณเอง')}</span>
        </div>
      )}

      {/* สรุป + ตัวกรองสถานะในที่เดียว (6 ต.ค. 69 จัด layout ใหม่) — ซ้าย: คำตอบของคำถามเดียวที่หน้านี้มี
          "รอบนี้ครบหรือยัง" เป็นเลขใหญ่ + แถบความคืบหน้า · ขวา: ตัวเลขแต่ละสถานะเป็นปุ่ม กดแล้วตารางกรองตามสถานะนั้น
          กดซ้ำเพื่อยกเลิก (เดิมเป็นชิปที่กดไม่ได้ ต้องไปเปิดเมนูตัวกรองอีกที)
          หน่วยนับ: มุมพนักงานนับเป็น "รอบ" (ทุกแถวเป็นของตัวเอง) · มุม admin/บัญชีนับเป็น "รายการ" (พนักงานคนเดียว
          โผล่ได้หลายรอบ จึงไม่ใช่จำนวนคน — เจ้าของระบบทัก 18 ก.ย. 69) */}
      {data && (
        <section className="sl-sum sl-donut">
          <div className="sl-dchart">
            <div className="dn-chart" role="group" aria-label={tx('สถานะการส่ง')}>
              <svg viewBox="0 0 42 42">
                <circle className="dn-track" cx="21" cy="21" r="15.9155" />
                {sumSegs.filter((g) => g.count > 0).map((g) => (
                  <circle
                    key={g.key}
                    className={`dn-seg ss-${g.key}${status === g.key ? ' sel' : ''}${status && status !== g.key ? ' dim' : ''}`}
                    cx="21"
                    cy="21"
                    r="15.9155"
                    strokeDasharray={`${g.len} ${100 - g.len}`}
                    strokeDashoffset={g.offset}
                    onClick={() => setStatus(status === g.key ? '' : g.key)}
                    role="button"
                    aria-label={tx(STATUS_LABEL[g.key])}
                  />
                ))}
              </svg>
              <div className="dn-center">
                <b>{pct(submitted, allRows.length)}</b>
                <span>{data.scope.mine ? tx('รอบที่ส่ง Timesheet แล้ว') : tx('ส่ง Timesheet แล้ว')}</span>
              </div>
            </div>
            <div className="sl-dtotal">
              <b>{submitted}</b>
              <span>/ {allRows.length} {data.scope.mine ? tx('รอบ') : tx('รายการ')}</span>
            </div>
          </div>

          <ul className="dn-legend sl-dlegend">
            {sumSegs.map((g) => (
              <li key={g.key}>
                <button
                  type="button"
                  className={`dn-lg ss-${g.key}${status === g.key ? ' on' : ''}`}
                  onClick={() => setStatus(status === g.key ? '' : g.key)}
                >
                  <i />
                  <span className="t">{tx(STATUS_LABEL[g.key])}</span>
                  <b>{g.count}</b>
                  <em>{pct(g.count, allRows.length)}</em>
                </button>
              </li>
            ))}
          </ul>

          {/* รายละเอียดของสถานะที่เลือก (คลิกกราฟหรือรายการ) — จำนวน · แยกตามรอบบิล · รายชื่อ · ตารางด้านล่างกรองตามสถานะนั้นด้วย */}
          {selStatus ? (
            <div className={`sl-ddetail ss-${selStatus}`}>
              <div className="pg-dh">
                <span className="pg-dt"><i />{tx(STATUS_LABEL[selStatus])}</span>
                <button type="button" className="pg-x" onClick={() => setStatus('')} aria-label={tx('ปิด')}>×</button>
              </div>
              <div className="pg-nums">
                <div><b>{summary[selStatus]}</b><span>{data.scope.mine ? tx('รอบ') : tx('รายการ')} · {pct(summary[selStatus], allRows.length)}</span></div>
              </div>
              {selByPeriod.length > 0 && (
                <ul className="pg-per">
                  {selByPeriod.map((r) => (
                    <li key={r.label}>
                      <div className="pg-pt"><b>{r.label}</b><em>{r.n}</em></div>
                      <div className="pg-bar"><span style={{ width: `${(r.n / Math.max(summary[selStatus], 1)) * 100}%` }} /></div>
                    </li>
                  ))}
                </ul>
              )}
              {!data.scope.mine && selPeople.length > 0 && (
                <div className="sl-people">
                  {selPeople.map((n) => (<span key={n}>{n}</span>))}
                  {selPeopleMore > 0 && <span className="more">+{selPeopleMore}</span>}
                </div>
              )}
            </div>
          ) : (
            /* ยังไม่ได้เลือกสถานะ: โชว์ภาพรวมแทนที่ว่าง — สถานะแยกตามรอบบิล (แท่งซ้อนสี) + ช่องทางที่ใช้ส่ง */
            <div className="sl-dover">
              <div className="sl-ovblock">
                <h4>{tx('สถานะแยกตามรอบบิล')}</h4>
                {/* โดนัทเล็กต่อรอบบิล (6 ต.ค. 69 แทนแท่งยาว) — กดส่วนไหนแล้วตารางกรองตามรอบ+สถานะนั้น และกล่องรายละเอียดขึ้นมาแทน */}
                <div className="sl-minis">
                  {byPeriod.map((r) => {
                    let acc = 0;
                    const live = SUM_ORDER.filter((k) => r.c[k] > 0).length;
                    const gap = live > 1 ? 1.2 : 0;
                    return (
                      <div key={r.period} className="sl-mini">
                        <div className="sl-mini-chart">
                          <svg viewBox="0 0 42 42">
                            <circle className="dn-track" cx="21" cy="21" r="15.9155" />
                            {SUM_ORDER.filter((k) => r.c[k] > 0).map((k) => {
                              const share = (r.c[k] / r.total) * 100;
                              const off = 25 - acc;
                              acc += share;
                              return (
                                <circle
                                  key={k}
                                  className={`dn-seg ss-${k}`}
                                  cx="21"
                                  cy="21"
                                  r="15.9155"
                                  strokeDasharray={`${Math.max(share - gap, 0.1)} ${100 - Math.max(share - gap, 0.1)}`}
                                  strokeDashoffset={off}
                                  role="button"
                                  aria-label={`${r.label} · ${tx(STATUS_LABEL[k])} ${r.c[k]}`}
                                  onClick={() => { setPeriod(r.period); setStatus(k); }}
                                >
                                  <title>{`${tx(STATUS_LABEL[k])} ${r.c[k]}`}</title>
                                </circle>
                              );
                            })}
                          </svg>
                          <b>{r.total}</b>
                        </div>
                        <span className="sl-mini-l">{r.label}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
              <div className="sl-ovblock">
                <h4>{tx('ช่องทางที่ใช้ส่ง')}</h4>
                <div className="sl-mchips">
                  {(Object.keys(METHOD_LABEL) as Method[]).map((m) => (
                    <span key={m} className="sl-mchip"><b>{methodCounts[m]}</b>{tx(METHOD_LABEL[m])}</span>
                  ))}
                  <span className="sl-mchip mu"><b>{methodCounts.none}</b>{tx('ยังไม่เลือก')}</span>
                </div>
              </div>
            </div>
          )}
        </section>
      )}

      <TabStrip tabs={visibleTabs} active={tab} onChange={setTab} />

      {tab === 'tickets' ? (
        // ฟังก์ชันแจ้งปัญหาเดิมยกมาทั้งก้อน ไม่แตะตรรกะเลย — เจ้าของระบบสั่งว่าอย่าทิ้งของเดิม
        <SupportTicketsPanel />
      ) : (
        <div className="sl-wrap">
        <Card
          title={tx(TABS.find((t) => t.key === tab)?.label ?? '')}
          right={<span className="sl-count">{rows.length}{rows.length !== allRows.length ? ` / ${allRows.length}` : ''} {tx('รายการ')}</span>}
          flush
        >
          {/* แถบเครื่องมือ: ค้นหา + รอบบิล (ใช้บ่อยสุด จึงอยู่หน้าตรงๆ) + ตัวกรองอื่น (บริษัท/ช่องทาง) ในเมนูเดียวตามที่สั่งไว้ 27 ก.ย. 69
              แล้วสรุปตัวกรองที่เปิดอยู่เป็นชิปกดลบได้ทีละอัน */}
          <div className="sl-tools">
            <label className="sl-search">
              <Icon name="search" className="sm" />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder={tx('ค้นหาพนักงาน / บริษัท / โครงการ')}
                aria-label={tx('ค้นหา')}
              />
              {q && (
                <button type="button" className="sl-x" onClick={() => setQ('')} aria-label={tx('ล้าง')}>×</button>
              )}
            </label>
            <span className="selectchip sl-period">
              <select value={period} onChange={(e) => setPeriod(e.target.value)} aria-label={tx('รอบบิล')}>
                <option value="">{tx('ทุกรอบบิล')}</option>
                {periodOptions.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
              <Icon name="chev" />
            </span>
            <FilterMenu
              open={filtersOpen}
              onToggle={() => setFiltersOpen((v) => !v)}
              onClose={() => setFiltersOpen(false)}
              activeCount={advancedActive}
              onClear={() => { setStatus(''); setMethod(''); setCustomerId(''); }}
              groups={[
                { label: 'สถานะ', value: status, onChange: (v) => setStatus(v as Status | ''), allLabel: 'ทุกสถานะ',
                  options: STATUS_ORDER.map((v) => ({ value: v, label: tx(STATUS_LABEL[v]), count: summary[v], dot: STATUS_DOT[v] })) },
                { label: 'บริษัท', value: customerId, onChange: setCustomerId, allLabel: 'ทุกบริษัท',
                  options: companyOptions },
                { label: 'ช่องทาง', value: method, onChange: setMethod, allLabel: 'ทุกช่องทาง',
                  options: (Object.keys(METHOD_LABEL) as Method[]).map((v) => ({ value: v, label: tx(METHOD_LABEL[v]) })) },
              ]}
            />
          </div>
          {anyFilter && (
            <div className="sl-chips">
              {status && (
                <button type="button" className="sl-chip" onClick={() => setStatus('')}>
                  {tx('สถานะ')}: {tx(STATUS_LABEL[status])} <span>×</span>
                </button>
              )}
              {period && (
                <button type="button" className="sl-chip" onClick={() => setPeriod('')}>
                  {tx('รอบบิล')}: {periodOptions.find((o) => o.value === period)?.label ?? period} <span>×</span>
                </button>
              )}
              {customerId && (
                <button type="button" className="sl-chip" onClick={() => setCustomerId('')}>
                  {tx('บริษัท')}: {companyOptions.find((o) => o.value === customerId)?.label ?? customerId} <span>×</span>
                </button>
              )}
              {method && (
                <button type="button" className="sl-chip" onClick={() => setMethod('')}>
                  {tx('ช่องทาง')}: {tx(METHOD_LABEL[method as Method])} <span>×</span>
                </button>
              )}
              <button type="button" className="sl-clear" onClick={clearAll}>{tx('ล้างทั้งหมด')}</button>
            </div>
          )}

          {error ? (
            <ErrorState message={error} onRetry={load} />
          ) : !data ? (
            <Loading rows={6} />
          ) : (
            <div className="tw sl-table">
              <table>
                <thead>
                  <tr>
                    <th>{tx('พนักงาน')}</th>
                    <th>{tx('รอบบิล')}</th>
                    <th>{tx('สถานะการส่ง')}</th>
                    <th>{tx('ช่องทางการส่ง')}</th>
                    {/* คอลัมน์ "สถานะการตรวจสอบ" กับ "ผู้ดำเนินการ" ถูกเอาออก 18 ก.ย. 69 — เป็นซากจาก
                        ตอนที่หน้านี้ยังมีปุ่มยืนยัน/ตีกลับ พอถอดปุ่มออกแล้วสองคอลัมน์นี้ขึ้น "ยังไม่มีคนตรวจ"
                        กับ "—" ทุกแถวตลอดไป กินที่โดยไม่บอกอะไรเลย · คอลัมน์ "ลำดับ" เอาออก 6 ต.ค. 69
                        (เลขแถวไม่ได้บอกอะไร ตัวนับรวมอยู่หัวการ์ดแล้ว) */}
                    <th>{tx('วันและเวลาที่ส่ง')}</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={`${r.employeeId}|${r.period}`}>
                      <td>
                        <div className="sl-emp">
                          <span className="sl-av" aria-hidden>{(r.employeeName.trim()[0] ?? '?').toUpperCase()}</span>
                          <span className="sl-emp-t">
                            <b>{r.employeeName}</b>
                            <span className="sub">{r.customerName} · {r.projectName}</span>
                          </span>
                        </div>
                      </td>
                      <td className="sl-period">{formatPeriodLabel(r.periodLabel)}</td>
                      <td>
                        <div className="status-cell">
                          <StatusPill tone={STATUS_TONE[r.status]}>{tx(STATUS_LABEL[r.status])}</StatusPill>
                          {r.deferredAt && (
                            <div className="sub">{tx('ขอเลื่อน')} · {dt(r.deferredAt)}</div>
                          )}
                          {/* ป้ายสั้น ไม่ใช่ประโยคอธิบาย — แต่ยังแยกจาก "ยังไม่ส่ง" เดิมอยู่ เพราะเป็นคนละความจริง:
                              อันนี้คือระบบไม่มีทางรู้ ไม่ใช่ยืนยันแล้วว่าเงียบจริง เอาป้ายออกจะทำให้สองเคสนี้
                              กลืนกันจนดูเหมือนยืนยันแล้วว่าไม่ส่งทั้งคู่ — เป็นบรรทัดหมายเหตุใต้ pill ไม่ใช่ pill
                              ที่สอง (pill เทาสองอันวางคู่กันอ่านเหมือนสถานะสองอัน, 24 ก.ย. 69) */}
                          {!r.canReceiveLineUpdates && r.status === 'not_submitted' && (
                            <span className="status-note">{tx('ยังไม่ผูก LINE OA')}</span>
                          )}
                        </div>
                      </td>
                      <td>
                        {r.method ? <Tag tone="mu">{tx(METHOD_LABEL[r.method])}</Tag> : <span className="sub">—</span>}
                        {r.replyOk === false && (
                          <div className="sub" style={{ color: 'var(--wn)' }}>{tx('พนักงานอาจไม่เห็นข้อความตอบกลับ')}</div>
                        )}
                      </td>
                      <td className="sub sl-when">{r.methodChosenAt ? dt(r.methodChosenAt) : '—'}</td>
                    </tr>
                  ))}
                  {rows.length === 0 && (
                    <tr>
                      <td colSpan={5} className="sl-empty">
                        {tx('ไม่มีรายการในหมวดนี้')}
                        {anyFilter && (
                          <div><button type="button" className="btn sm" onClick={clearAll}>{tx('ล้างทั้งหมด')}</button></div>
                        )}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </Card>
        </div>
      )}
    </>
  );
}

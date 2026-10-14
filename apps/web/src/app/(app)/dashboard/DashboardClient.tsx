'use client';

import { Fragment, useState } from 'react';
import Link from 'next/link';
import { Card, EmptyState, Kpi, Loading, PageHeader, PoTag, StatusPill, Tag, TaskList, type TaskLink } from '../../../components/ui';
import { Icon } from '../../../components/Icon';
import { useLang, formatDateTime } from '../../../lib/language';
import { useScope } from '../../../lib/scope';
import { contractRange } from '../../../components/ScopeFilterBar';

interface PeriodEmployee {
  employeeId: string;
  nameTh: string;
  position: string;
  status: string;
  statusLabel: string;
}

/** เหมือน billing/BillingClient.tsx ทุกอย่าง — ตาราง "รอบบิล" ในแดชบอร์ดคลิกดูรายชื่อพนักงาน+สถานะ
 * Timesheet รายคนได้เหมือนกัน (24 ก.ย. 69 ตามที่ขอ "อยากให้มีการแสดงพนักงานและสถานะแบบนี้ด้วย") */
function employeeStatusTone(status: string): 'mu' | 'ok' | 'wn' {
  if (status === 'not_submitted') return 'mu';
  if (status === 'billed') return 'ok';
  return 'wn';
}
/** สีของพนักงานรายคนให้อยู่ในชุดสีเดียวกับสถานะรอบบิล: ยังไม่ส่ง=เทา · วางบิลแล้ว=เขียว · รอวางบิล(ตรวจผ่าน)=ฟ้า · อื่นๆ=ส้ม */
function employeeStateClass(status: string): string {
  if (status === 'not_submitted') return 's-awaiting';
  if (status === 'billed') return 's-billed';
  if (status === 'verified') return 's-ready';
  return 's-checking';
}
function employeeStatusLabel(e: { status: string; statusLabel: string }): string {
  return e.status === 'verified' ? 'รอวางบิล' : e.statusLabel;
}

interface DashboardData {
  today: string;
  counts: {
    total: number;
    waitingCheck: number;
    readyToBill: number;
    mismatch: number;
    billed: number;
    rejected: number;
  };
  waitingCheckValue: number;
  readyValue: number;
  leaveDeduction: number;
  invoiceCount: number;
  billedAmount: number;
  contracts: Array<{
    id: string;
    poNo: string;
    customerName: string;
    projectName: string;
    headcount: number;
    monthlyTotal: number;
    monthsTotal: number;
    monthsBilled: number;
    contractValue: number;
    billedValue: number;
    remainingValue: number;
    progress: number;
  }>;
  tasks: Array<{ level: string; title: string; detail: string; link?: TaskLink | null }>;
  cycles: Array<{
    contractId: string;
    customerName: string;
    period: string;
    periodLabel: string;
    stateLabel: string;
    state: string;
  }>;
  recentSubmissions: Array<{
    id: string;
    at: string;
    employeeName: string;
    customerName: string;
    period: string;
    periodLabel: string;
    method: string | null;
    methodLabel: string | null;
  }>;
}

function money(n: number) {
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default function DashboardClient({ data, nameTh }: { data: DashboardData; nameTh: string }) {
  const { tx, lang, formatPeriod, formatDate } = useLang();
  const { contracts: scopeContracts } = useScope();
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  const [cycleFilter, setCycleFilter] = useState('');
  const [showAllTasks, setShowAllTasks] = useState(false);
  const [selSeg, setSelSeg] = useState<'' | 'billed' | 'doing' | 'left'>('');
  const [employeesByKey, setEmployeesByKey] = useState<Record<string, PeriodEmployee[] | 'loading' | 'error'>>({});

  function toggleExpand(contractId: string, period: string) {
    const key = `${contractId}:${period}`;
    if (expandedKey === key) {
      setExpandedKey(null);
      return;
    }
    setExpandedKey(key);
    if (!employeesByKey[key]) {
      setEmployeesByKey((m) => ({ ...m, [key]: 'loading' }));
      fetch(`/api/cycles/${encodeURIComponent(contractId)}/${encodeURIComponent(period)}/employees`, { cache: 'no-store' })
        .then((r) => (r.ok ? r.json() : Promise.reject()))
        .then((rows: PeriodEmployee[]) => setEmployeesByKey((m) => ({ ...m, [key]: rows })))
        .catch(() => setEmployeesByKey((m) => ({ ...m, [key]: 'error' })));
    }
  }

  // ชิปสถานะของการ์ดรอบบิล — นับจากรอบที่ได้มาทั้งหมด (ไม่ใช่เฉพาะที่กรองอยู่) ตัวเลขจะได้ไม่หายตอนกรอง
  const cycleStates = (() => {
    const m = new Map<string, { state: string; label: string; count: number }>();
    for (const c of data.cycles) {
      const cur = m.get(c.state);
      if (cur) cur.count += 1;
      else m.set(c.state, { state: c.state, label: c.stateLabel, count: 1 });
    }
    return [...m.values()];
  })();
  // ความคืบหน้าสัญญา: นับเป็น "เดือน" ของสัญญา — วางบิลแล้ว (monthsBilled) · อยู่ระหว่างดำเนินการ (รอบที่ส่ง/ตรวจแล้วแต่ยังไม่วางบิล)
  // · ยังไม่ถึงรอบ (ที่เหลือ) · มูลค่าของสองส่วนหลังเป็นค่าประมาณจากยอดต่อเดือน
  const progPer = data.contracts.map((c) => {
    const started = data.cycles.filter((x) => x.contractId === c.id && x.state !== 'billed' && x.state !== 'awaiting').length;
    const billed = Math.min(c.monthsBilled, c.monthsTotal);
    const doing = Math.min(started, Math.max(c.monthsTotal - billed, 0));
    const left = Math.max(c.monthsTotal - billed - doing, 0);
    return { c, billed, doing, left, doingValue: c.monthlyTotal * doing, leftValue: Math.max(c.remainingValue - c.monthlyTotal * doing, 0) };
  });
  const progTotal = progPer.reduce((n, r) => n + r.c.monthsTotal, 0);
  const progSegsRaw = [
    { key: 'billed' as const, label: 'วางบิลแล้ว', count: progPer.reduce((n, r) => n + r.billed, 0), value: progPer.reduce((n, r) => n + r.c.billedValue, 0) },
    { key: 'doing' as const, label: 'อยู่ระหว่างดำเนินการ', count: progPer.reduce((n, r) => n + r.doing, 0), value: progPer.reduce((n, r) => n + r.doingValue, 0) },
    { key: 'left' as const, label: 'ยังไม่ถึงรอบ', count: progPer.reduce((n, r) => n + r.left, 0), value: progPer.reduce((n, r) => n + r.leftValue, 0) },
  ];
  const progSegs = (() => {
    const gap = progSegsRaw.filter((g) => g.count > 0).length > 1 ? 0.8 : 0;
    let acc = 0;
    return progSegsRaw.map((g) => {
      const share = (g.count / (progTotal || 1)) * 100;
      const seg = { ...g, len: Math.max(share - gap, 0.1), offset: 25 - acc };
      acc += share;
      return seg;
    });
  })();
  const progPct = progTotal ? Math.round((progSegsRaw[0].count / progTotal) * 100) : 0;
  const selDetail = progSegs.find((g) => g.key === selSeg) ?? null;
  // งานที่มีลิงก์ (ต้องลงมือ) ก่อน แล้วค่อยงานที่แค่รอ — sort คงลำดับเดิมในกลุ่มเดียวกัน
  const taskList = [...data.tasks].sort((x, y) => Number(Boolean(y.link)) - Number(Boolean(x.link)));
  const cycleShown = cycleFilter ? data.cycles.filter((c) => c.state === cycleFilter) : data.cycles;

  return (
    <>
      <PageHeader
        eyebrow={tx('ยินดีต้อนรับ')}
        title={tx('แดชบอร์ด OBS')}
        subtitle={nameTh}
        actions={
          <span className="datelabel">
            <Icon name="cal" className="sm" />
            <span className="dl-k">{tx('ข้อมูล ณ')}</span>
            <b>{formatDate(data.today)}</b>
          </span>
        }
      />

      <Card title={tx('สัญญา')}>
        {data.contracts.length === 0 ? (
          <EmptyState label={tx('ไม่มีสัญญา')} />
        ) : (
          <div className="constrips">
            {data.contracts.map((c) => {
              const opt = scopeContracts.find((x) => x.id === c.id);
              return (
              <div key={c.id} className="constrip">
                <div className="cf">
                  <span className="lbl">{tx('เลขที่ PO')}</span>
                  <PoTag>{c.poNo}</PoTag>
                </div>
                <div className="cf">
                  <span className="lbl">{tx('บริษัท')}</span>
                  <Tag tone="mu">{c.customerName}</Tag>
                </div>
                <div className="cf grow">
                  <span className="lbl">{tx('โครงการ')}</span>
                  <b>{c.projectName}</b>
                </div>
                <div className="cf">
                  <span className="lbl">{tx('พนักงาน')}</span>
                  <span className="hc" title={opt ? opt.employees.map((e) => e.nameTh).join(', ') : undefined}>
                    <Icon name="users" className="sm" />
                    {opt && opt.employees.length > 0
                      ? opt.employees.length <= 2
                        ? opt.employees.map((e) => e.nameTh).join(', ')
                        : `${opt.employees[0].nameTh} +${opt.employees.length - 1}`
                      : `${c.headcount} ${tx('คน')}`}
                  </span>
                </div>
                {opt && (
                  <div className="cf">
                    <span className="lbl">{tx('ช่วงสัญญา')}</span>
                    <span>{contractRange(opt, lang)}</span>
                  </div>
                )}
                <div className="cf end">
                  <span className="lbl">{tx('มูลค่าคงเหลือ')}</span>
                  <b className="n cv">{money(c.remainingValue)}</b>
                </div>
              </div>
              );
            })}
          </div>
        )}
      </Card>

      <div className="kpis">
        <Kpi
          icon="list-chk"
          label={tx('รอตรวจสอบ')}
          value={data.counts.waitingCheck}
          caption={`${tx('มูลค่า')} ${money(data.waitingCheckValue)} ${tx('บาท')}`}
          tone="w"
        />
        <Kpi
          icon="doc"
          label={tx('พร้อมวางบิล')}
          value={data.counts.readyToBill}
          caption={`${tx('มูลค่า')} ${money(data.readyValue)} ${tx('บาท')}`}
          tone="g"
        />
        <Kpi
          icon="money"
          label={tx('ยอดวางบิลแล้ว')}
          value={money(data.billedAmount)}
          caption={`${data.invoiceCount} ${tx('ใบ')}`}
          tone="a"
        />
      </div>

      {/* งานที่ต้องทำ (กว้าง) + โดนัทภาพรวมรอบบิล (แคบ) — 6 ต.ค. 69 เอาการ์ด "สรุปสถานะ Timesheet" ออก เพราะซ้ำกับการ์ดรอบบิล
          ด้านล่างทุกตัวเลข แล้วใช้โดนัทแทน · งานที่มีปุ่ม "เปิด" (ต้องลงมือ) ขึ้นก่อน ส่วน "รอ Timesheet" ที่เป็นแค่รอเฉยๆ ตามหลัง
          และโชว์แค่ 5 อันดับแรก ที่เหลือกดดูทั้งหมดได้ — เดิมยาวเป็นสิบกว่าแถวจนดันการ์ดอื่นหลุดจอ */}
      <div className="mosaic c2">
        <Card
          title={tx('งานที่ต้องทำ')}
          right={taskList.length > 0 ? <span className="bc-count">{taskList.length}</span> : undefined}
        >
          <TaskList tasks={showAllTasks ? taskList : taskList.slice(0, 5)} />
          {taskList.length > 5 && (
            <button type="button" className="dn-more" onClick={() => setShowAllTasks((v) => !v)}>
              {showAllTasks ? tx('แสดงน้อยลง') : `${tx('ดูทั้งหมด')} (${taskList.length})`}
            </button>
          )}
        </Card>

        {/* ความคืบหน้าสัญญา (6 ต.ค. 69 เปลี่ยนจากโดนัทสถานะรอบบิล): แบ่งเดือนทั้งหมดของสัญญาเป็น วางบิลแล้ว / อยู่ระหว่างดำเนินการ /
            ยังไม่ถึงรอบ — กดส่วนไหนของกราฟ (หรือรายการข้างล่าง) แล้วแสดงรายละเอียดของส่วนนั้นใต้กราฟ แยกตามสัญญา
            สีทึบโทนฟ้า #288adb ไล่ความเข้มตามความคืบหน้า */}
        <Card title={tx('ความคืบหน้าสัญญา')}>
          {data.contracts.length === 0 || progTotal === 0 ? (
            <EmptyState label={tx('ไม่มีสัญญา')} />
          ) : (
            <div className="pg">
              <div className="dn">
                <div className="dn-chart" role="group" aria-label={tx('ความคืบหน้าสัญญา')}>
                  <svg viewBox="0 0 42 42">
                    <circle className="dn-track" cx="21" cy="21" r={DONUT_R} />
                    {progSegs.filter((g) => g.count > 0).map((g) => (
                      <circle
                        key={g.key}
                        className={`dn-seg pg-${g.key}${selSeg === g.key ? ' sel' : ''}${selSeg && selSeg !== g.key ? ' dim' : ''}`}
                        cx="21"
                        cy="21"
                        r={DONUT_R}
                        strokeDasharray={`${g.len} ${100 - g.len}`}
                        strokeDashoffset={g.offset}
                        onClick={() => setSelSeg(selSeg === g.key ? '' : g.key)}
                        role="button"
                        aria-label={tx(g.label)}
                      />
                    ))}
                  </svg>
                  <div className="dn-center">
                    <b>{progPct}%</b>
                    <span>{tx('วางบิลแล้ว')}</span>
                  </div>
                </div>
                <ul className="dn-legend">
                  {progSegs.map((g) => (
                    <li key={g.key}>
                      <button
                        type="button"
                        className={`dn-lg pg-${g.key}${selSeg === g.key ? ' on' : ''}`}
                        onClick={() => setSelSeg(selSeg === g.key ? '' : g.key)}
                      >
                        <i />
                        <span className="t">{tx(g.label)}</span>
                        <b>{g.count}</b>
                        <em>{Math.round((g.count / progTotal) * 100)}%</em>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>

              {selDetail ? (
                <div className={`pg-detail pg-${selDetail.key}`}>
                  <div className="pg-dh">
                    <span className="pg-dt"><i />{tx(selDetail.label)}</span>
                    <button type="button" className="pg-x" onClick={() => setSelSeg('')} aria-label={tx('ปิด')}>×</button>
                  </div>
                  <div className="pg-nums">
                    <div><b>{selDetail.count}</b><span>{tx('เดือน')} · {Math.round((selDetail.count / progTotal) * 100)}%</span></div>
                    <div><b>{money(selDetail.value)}</b><span>{tx('บาท')}{selDetail.key === 'billed' ? '' : ` (${tx('ประมาณ')})`}</span></div>
                  </div>
                  <ul className="pg-per">
                    {progPer
                      .filter((r) => r[selDetail.key] > 0)
                      .map((r) => (
                        <li key={r.c.id}>
                          <div className="pg-pt">
                            <b>{r.c.poNo}</b>
                            <span className="sub">{r.c.customerName}</span>
                            <em>{r[selDetail.key]} / {r.c.monthsTotal} {tx('เดือน')}</em>
                          </div>
                          <div className="pg-bar"><span style={{ width: `${(r[selDetail.key] / Math.max(r.c.monthsTotal, 1)) * 100}%` }} /></div>
                        </li>
                      ))}
                  </ul>
                </div>
              ) : (
                <div className="pg-hint">{tx('คลิกที่ส่วนของกราฟเพื่อดูรายละเอียด')}</div>
              )}
            </div>
          )}
        </Card>
      </div>

      <div className="mosaic c2">
        {/* รอบบิล (6 ต.ค. 69 จัดใหม่): แถบสีซ้ายของแต่ละแถว + ป้ายสถานะสีเดียวกัน แบ่งสีตามสถานะทั้งหน้า
            ชิปด้านบนนับจำนวนต่อสถานะและกดกรองได้ · กดแถวเพื่อกางรายชื่อพนักงานและสถานะ Timesheet รายคน เหมือนเดิม */}
        <Card title={tx('รอบบิล')} right={<span className="bc-count">{cycleShown.length} / {data.cycles.length}</span>} flush>
          <div className="bc-filter" role="group" aria-label={tx('สถานะ')}>
            <button type="button" className={`bc-chip${cycleFilter === '' ? ' on' : ''}`} onClick={() => setCycleFilter('')}>
              {tx('ทั้งหมด')} <b>{data.cycles.length}</b>
            </button>
            {cycleStates.map((st) => (
              <button
                key={st.state}
                type="button"
                className={`bc-chip s-${st.state}${cycleFilter === st.state ? ' on' : ''}`}
                onClick={() => setCycleFilter(cycleFilter === st.state ? '' : st.state)}
              >
                <i />{tx(st.label)} <b>{st.count}</b>
              </button>
            ))}
          </div>
          <ul className="bc-list">
            {cycleShown.slice(0, 20).map((c, i) => {
              const key = `${c.contractId}:${c.period}`;
              const expanded = expandedKey === key;
              const emps = employeesByKey[key];
              return (
                <li key={`${c.contractId}-${c.period}-${i}`} className={`bc-item s-${c.state}${expanded ? ' open' : ''}`}>
                  <button
                    type="button"
                    className="bc-row"
                    aria-expanded={expanded}
                    onClick={() => toggleExpand(c.contractId, c.period)}
                    title={tx('คลิกเพื่อดูรายชื่อพนักงานและสถานะ Timesheet แต่ละคน')}
                  >
                    <span className="bc-av" aria-hidden>{(c.customerName.trim()[0] ?? '?').toUpperCase()}</span>
                    <span className="bc-main">
                      <b>{c.customerName}</b>
                      <span className="sub">{formatPeriod(c.period)}</span>
                    </span>
                    <span className={`bc-pill s-${c.state}`}><i />{tx(c.stateLabel)}</span>
                    <Icon name="cd" className="sm bc-chev" />
                  </button>
                  {expanded && (
                    <div className="bc-emps">
                      {emps === 'loading' || emps === undefined ? (
                        <div style={{ padding: '4px 16px' }}><Loading variant="lines" rows={2} /></div>
                      ) : emps === 'error' ? (
                        <div className="bc-note err">{tx('โหลดรายชื่อพนักงานไม่สำเร็จ')}</div>
                      ) : emps.length === 0 ? (
                        <div className="bc-note">{tx('ยังไม่มีพนักงานผูกกับสัญญานี้')}</div>
                      ) : (
                        emps.map((e) => (
                          <div key={e.employeeId} className="bc-emp">
                            <span className="bc-av sm" aria-hidden>{(e.nameTh.trim()[0] ?? '?').toUpperCase()}</span>
                            <span className="bc-main">
                              <b>{e.nameTh}</b>
                              <span className="sub">{e.position}</span>
                            </span>
                            <span className={`bc-pill sm ${employeeStateClass(e.status)}`}><i />{tx(employeeStatusLabel(e))}</span>
                          </div>
                        ))
                      )}
                    </div>
                  )}
                </li>
              );
            })}
            {cycleShown.length === 0 && (
              <li className="bc-empty">{tx('ไม่มีรอบบิล')}</li>
            )}
          </ul>
        </Card>

        <Card title={tx('กิจกรรมล่าสุด')}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {data.recentSubmissions.map((a) => (
              <Link key={a.id} href={`/manday/${a.id}`} style={{ fontSize: 13, color: 'inherit', textDecoration: 'none' }}>
                <div>
                  <b>{a.employeeName}</b> {tx('ส่ง Timesheet รอบ')} {formatPeriod(a.period)}
                  {data.contracts.length > 1 ? ` · ${a.customerName}` : ''}
                </div>
                <div style={{ color: 'var(--mut)', fontSize: 12, marginTop: 2 }}>
                  {formatDateTime(a.at, lang === 'en' ? 'en' : 'th')}
                  {a.methodLabel ? ` · ${tx(a.methodLabel)}` : ''}
                </div>
              </Link>
            ))}
            {data.recentSubmissions.length === 0 && <div style={{ color: 'var(--mut)', fontSize: 13 }}>{tx('ไม่มีกิจกรรม')}</div>}
          </div>
        </Card>
      </div>
    </>
  );
}

/** ใช้ tone เดียวกับ CYCLE_STATE_TONE ใน CompanyDetailClient.tsx (ไม่ได้ใช้ enum เดียวกันเป๊ะ — ที่นี่แค่ไล่สี
 * ตามความหมาย: ฟ้า=รวม, เหลือง=ต้องแก้, เขียว=เสร็จแล้ว, แดง=มีปัญหา) เพื่อให้จุดสีตรงกับ StatusPill ด้านล่าง */
const DONUT_R = 15.9155; // เส้นรอบวง = 100 พอดี ให้ stroke-dasharray อ่านเป็นเปอร์เซ็นต์ตรงๆ

const CYCLE_STATE_TONE: Record<string, 'ok' | 'wn' | 'cr' | 'mu' | 'pr'> = {
  awaiting: 'mu',
  partial: 'wn',
  mismatch: 'cr',
  checking: 'wn',
  ready: 'ok',
  billed: 'ok',
};


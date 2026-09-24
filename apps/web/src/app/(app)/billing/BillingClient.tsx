'use client';

import Link from 'next/link';
import { Fragment, useEffect, useState } from 'react';
import { Card, PageHeader, StatusPill, Tag } from '../../../components/ui';
import { Icon } from '../../../components/Icon';
import { useLang } from '../../../lib/language';

interface CyclePeriod {
  contractId: string;
  poNo: string;
  customerName: string;
  period: string;
  periodLabel: string;
  state: string;
  stateLabel: string;
  expected: number;
  received: number;
  invoiceNo: string | null;
  value: number | null;
}

interface PeriodEmployee {
  employeeId: string;
  nameTh: string;
  position: string;
  status: string;
  statusLabel: string;
}

/** ป้ายสถานะ Timesheet รายคน — ใช้ tone เดียวกับหน้ารายละเอียดรอบบิล (billing/[contractId]/[period]) */
function employeeStatusTone(status: string): 'mu' | 'ok' | 'wn' {
  if (status === 'not_submitted') return 'mu';
  if (status === 'billed') return 'ok';
  return 'wn';
}

/** "ตรวจผ่าน" (statusLabel ดิบ) ไม่สื่อความในหน้านี้ — มาถึงตรงนี้แปลว่าผ่านตรวจแล้วเสมอ สิ่งที่ยังไม่รู้
 * คือ "วางบิลหรือยัง" — เขียนทับเฉพาะ 'verified' เหมือนที่หน้ารายละเอียดรอบบิลทำไว้แล้ว (18 ก.ย. 69) */
function employeeStatusLabel(e: { status: string; statusLabel: string }): string {
  return e.status === 'verified' ? 'รอวางบิล' : e.statusLabel;
}

interface ContractCycles {
  id: string;
  poNo: string;
  customerName: string;
  projectName: string;
  headcount: number;
  contractValue: number;
  billedValue: number;
  remainingValue: number;
  monthsTotal: number;
  monthsBilled: number;
  progress: number;
  periods: CyclePeriod[];
}

interface CyclesResult {
  contracts: ContractCycles[];
}

function money(n: number | null) {
  if (n === null || n === undefined) return '—';
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

const STATE_TONE: Record<string, 'ok' | 'wn' | 'cr' | 'mu' | 'pr'> = {
  billed: 'ok',
  ready: 'pr',
  checking: 'wn',
  mismatch: 'cr',
  partial: 'wn',
  awaiting: 'mu',
};

export default function BillingClient() {
  const { tx } = useLang();
  const [data, setData] = useState<CyclesResult | null>(null);
  // แถวรอบบิลไหนกำลังกางดูรายชื่อพนักงานอยู่ — คีย์ "contractId:period" (24 ก.ย. 69 ตามที่ขอ: "รอบบิล
  // ที่มีพนักงานหลายคน ต้องคลิกแล้วมี dropdown แสดงชื่อ+สถานะ Timesheet แต่ละคนได้") ใช้ endpoint
  // /api/cycles/:contractId/:period/employees ที่มีอยู่แล้ว (หน้ารายละเอียดรอบบิลใช้ตัวเดียวกัน)
  // แค่ไม่เคยถูกเอามาโชว์ในหน้ารายการนี้เลย
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
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

  useEffect(() => {
    fetch('/api/contracts/active', { cache: 'no-store' })
      .then((r) => r.json())
      .then((c: { id: string } | null) => {
        const qs = c ? `?contractId=${encodeURIComponent(c.id)}` : '';
        return fetch(`/api/cycles${qs}`, { cache: 'no-store' });
      })
      .then((r) => r.json())
      .then(setData);
  }, []);

  if (!data) {
    return (
      <>
        <PageHeader eyebrow={tx('ขั้นตอน 3 · วางบิล & ร่างอีเมล')} title={tx('วางบิล & ร่างอีเมล')} />
        <div style={{ color: 'var(--mut)' }}>{tx('กำลังโหลด…')}</div>
      </>
    );
  }

  return (
    <>
      <PageHeader
        eyebrow={tx('ขั้นตอน 3 · วางบิล & ร่างอีเมล')}
        title={tx('วางบิล & ร่างอีเมล')}
        subtitle={tx('ดูสถานะแต่ละรอบบิล เปิดพรีวิวใบแจ้งหนี้และร่างอีเมลก่อนอนุมัติ')}
      />

      {data.contracts.map((contract) => (
        <Card
          key={contract.id}
          title={`${contract.poNo} — ${contract.customerName}`}
          right={<span>{contract.projectName}</span>}
          flush
        >
          <div style={{ display: 'flex', gap: 32, padding: '18px 24px', borderBottom: '1px solid var(--hair)', flexWrap: 'wrap' }}>
            <Stat label={tx('มูลค่าสัญญา')} value={`${money(contract.contractValue)} ${tx('บาท')}`} />
            <Stat label={tx('วางบิลแล้ว')} value={`${money(contract.billedValue)} ${tx('บาท')}`} />
            <Stat label={tx('คงเหลือ')} value={`${money(contract.remainingValue)} ${tx('บาท')}`} />
            <Stat label={tx('รอบบิล')} value={`${contract.monthsBilled} / ${contract.monthsTotal}`} />
            <Stat label={tx('พนักงาน')} value={`${contract.headcount} ${tx('คน')}`} />
          </div>
          <div className="tw">
            <table>
              <thead>
                <tr>
                  <th>{tx('รอบบิล')}</th>
                  <th>Timesheet</th>
                  <th>{tx('สถานะ')}</th>
                  <th className="r">{tx('มูลค่า')}</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {contract.periods.map((p) => {
                  const key = `${contract.id}:${p.period}`;
                  const expanded = expandedKey === key;
                  const emps = employeesByKey[key];
                  return (
                    <Fragment key={p.period}>
                      <tr className="rw" onClick={() => toggleExpand(contract.id, p.period)} title={tx('คลิกเพื่อดูรายชื่อพนักงานและสถานะ Timesheet แต่ละคน')}>
                        <td className="nm">
                          <Icon
                            name="cd"
                            className="sm"
                            style={{ marginRight: 6, transition: 'transform 0.15s var(--ease)', transform: expanded ? 'rotate(180deg)' : undefined }}
                          />
                          {p.periodLabel}
                        </td>
                        <td>
                          {p.received} / {p.expected}
                        </td>
                        <td>
                          <StatusPill tone={STATE_TONE[p.state] ?? 'mu'}>{tx(p.stateLabel)}</StatusPill>
                        </td>
                        <td className="r n">{money(p.value)}</td>
                        <td className="r">
                          <Link href={`/billing/${contract.id}/${p.period}`} className="btn sm" onClick={(e) => e.stopPropagation()}>
                            {tx('เปิดดู')}
                          </Link>
                        </td>
                      </tr>
                      {expanded && (
                        <tr>
                          <td colSpan={5} style={{ padding: 0, background: 'var(--sunk)' }}>
                            {emps === 'loading' || emps === undefined ? (
                              <div className="sub" style={{ padding: '12px 24px' }}>{tx('กำลังโหลด…')}</div>
                            ) : emps === 'error' ? (
                              <div style={{ padding: '12px 24px', color: 'var(--cr)' }}>{tx('โหลดรายชื่อพนักงานไม่สำเร็จ')}</div>
                            ) : emps.length === 0 ? (
                              <div className="sub" style={{ padding: '12px 24px' }}>{tx('ยังไม่มีพนักงานผูกกับสัญญานี้')}</div>
                            ) : (
                              <table style={{ width: '100%' }}>
                                <tbody>
                                  {emps.map((e) => (
                                    <tr key={e.employeeId}>
                                      <td style={{ paddingLeft: 40 }} className="nm">{e.nameTh}</td>
                                      <td className="sub">{e.position}</td>
                                      <td className="r" style={{ paddingRight: 24 }}>
                                        <Tag tone={employeeStatusTone(e.status)}>{tx(employeeStatusLabel(e))}</Tag>
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            )}
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      ))}

      {data.contracts.length === 0 && (
        <div className="card">
          <div className="empty">{tx('ยังไม่มีสัญญาในระบบ')}</div>
        </div>
      )}
    </>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="ey">{label}</div>
      <div style={{ fontWeight: 600, marginTop: 4 }} className="n">
        {value}
      </div>
    </div>
  );
}

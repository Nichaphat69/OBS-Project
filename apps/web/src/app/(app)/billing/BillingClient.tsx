'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Card, PageHeader, StatusPill } from '../../../components/ui';
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
                {contract.periods.map((p) => (
                  <tr key={p.period}>
                    <td className="nm">{p.periodLabel}</td>
                    <td>
                      {p.received} / {p.expected}
                    </td>
                    <td>
                      <StatusPill tone={STATE_TONE[p.state] ?? 'mu'}>{tx(p.stateLabel)}</StatusPill>
                    </td>
                    <td className="r n">{money(p.value)}</td>
                    <td className="r">
                      <Link href={`/billing/${contract.id}/${p.period}`} className="btn sm">
                        {tx('เปิดดู')}
                      </Link>
                    </td>
                  </tr>
                ))}
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

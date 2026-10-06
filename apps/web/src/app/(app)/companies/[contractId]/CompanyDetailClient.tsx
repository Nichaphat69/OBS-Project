'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Card, EmptyState, ErrorState, Kpi, Loading, PageHeader, PoTag, StatusPill } from '../../../../components/ui';
import { useLang } from '../../../../lib/language';

interface CyclePeriod {
  period: string;
  periodLabel: string;
  state: string;
  stateLabel: string;
  expected: number;
  received: number;
  value: number | null;
}
interface ContractCycles {
  id: string;
  poNo: string;
  customerName: string;
  projectName: string;
  periods: CyclePeriod[];
}
interface PeriodEmployee {
  employeeId: string;
  nameTh: string;
  position: string;
  status: string;
  statusLabel: string;
}

function money(n: number) {
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

const CYCLE_STATE_TONE: Record<string, 'ok' | 'wn' | 'cr' | 'mu' | 'pr'> = {
  awaiting: 'mu',
  partial: 'wn',
  mismatch: 'cr',
  checking: 'wn',
  ready: 'ok',
  billed: 'ok',
};
const STATUS_TONE: Record<string, 'ok' | 'wn' | 'cr' | 'mu' | 'pr'> = {
  verified: 'ok',
  mismatch: 'cr',
  billed: 'ok',
  rejected: 'mu',
  received: 'pr',
  extracted: 'pr',
  approved: 'ok',
};

/** ported from public/app.js's openExecCompany() — รายละเอียดบริษัทเดียว อ่านอย่างเดียวล้วนๆ
 * ไม่มีปุ่มทำรายการใดๆ เลย เลือกดูรอบเดือนไหนก็ได้ของบริษัทนั้น ไม่ใช่แค่เดือนปัจจุบัน */
export default function CompanyDetailClient({ contractId }: { contractId: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const periodParam = searchParams.get('period');
  const { tx, formatPeriodLabel } = useLang();

  const [contract, setContract] = useState<ContractCycles | null | undefined>(undefined);
  const [employees, setEmployees] = useState<PeriodEmployee[] | null>(null);
  const [chosenPeriod, setChosenPeriod] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function loadContract() {
    setError(null);
    fetch(`/api/cycles?contractId=${encodeURIComponent(contractId)}`, { cache: 'no-store' })
      .then(async (r) => {
        if (!r.ok) {
          const data = await r.json().catch(() => ({}));
          setError(data?.error ?? tx('โหลดข้อมูลไม่สำเร็จ'));
          return;
        }
        const data: { contracts: ContractCycles[] } = await r.json();
        const c = data.contracts[0] ?? null;
        setContract(c);
        if (!c) return;
        // ไม่ระบุรอบมา (เพิ่งกดเข้ามาจากตาราง) — เดาเป็นเดือนปัจจุบัน ไม่มีก็เอารอบล่าสุดที่มีของสัญญานี้
        const thisMonth = new Date().toISOString().slice(0, 7);
        const fallback = c.periods.find((p) => p.period === thisMonth)?.period ?? c.periods.at(-1)?.period ?? null;
        setChosenPeriod(periodParam && c.periods.some((p) => p.period === periodParam) ? periodParam : fallback);
      })
      .catch(() => setError(tx('เชื่อมต่อเซิร์ฟเวอร์ไม่ได้')));
  }

  useEffect(loadContract, [contractId]);

  // sync กับ ?period= ใน URL ทุกครั้งที่มันเปลี่ยน (รวมถึงตอนกด back/forward ของ browser) — ไม่ใช่แค่
  // ตอนโหลดครั้งแรก ไม่งั้นกด back แล้ว URL เปลี่ยนแต่การ์ด/ตารางยังค้างอยู่ที่รอบเดิม
  useEffect(() => {
    if (!contract) return;
    if (periodParam && contract.periods.some((p) => p.period === periodParam) && periodParam !== chosenPeriod) {
      setChosenPeriod(periodParam);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [periodParam, contract]);

  useEffect(() => {
    if (!chosenPeriod) {
      setEmployees([]);
      return;
    }
    fetch(`/api/cycles/${encodeURIComponent(contractId)}/${encodeURIComponent(chosenPeriod)}/employees`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : []))
      .then(setEmployees)
      .catch(() => setEmployees([]));
  }, [contractId, chosenPeriod]);

  if (error) {
    return (
      <>
        <PageHeader eyebrow={tx('ผู้บริหาร')} title={tx('เกิดข้อผิดพลาด')} actions={<Link href="/companies" className="btn ghost">← {tx('กลับภาพรวมทุกบริษัท')}</Link>} />
        <ErrorState message={error} onRetry={loadContract} />
      </>
    );
  }

  if (contract === undefined) {
    return (
      <>
        <PageHeader eyebrow={tx('ผู้บริหาร')} title={tx('กำลังโหลด…')} />
        <Loading variant="cards" rows={3} />
        <div style={{ marginTop: 22 }}>
          <Card>
            <Loading rows={5} />
          </Card>
        </div>
      </>
    );
  }

  if (contract === null) {
    return (
      <>
        <PageHeader eyebrow={tx('ผู้บริหาร')} title={tx('ไม่พบบริษัทนี้')} actions={<Link href="/companies" className="btn ghost">← {tx('กลับภาพรวมทุกบริษัท')}</Link>} />
      </>
    );
  }

  function selectPeriod(period: string) {
    setChosenPeriod(period);
    router.replace(`/companies/${encodeURIComponent(contractId)}?period=${encodeURIComponent(period)}`, { scroll: false });
  }

  const cyclePeriod = contract.periods.find((p) => p.period === chosenPeriod) ?? null;

  return (
    <>
      <PageHeader
        eyebrow={tx('ผู้บริหาร')}
        title={contract.customerName}
        subtitle={
          <>
            {tx('โครงการ')} {contract.projectName}
            {contract.poNo && (
              <>
                {' '}
                · <PoTag>{contract.poNo}</PoTag>
              </>
            )}
          </>
        }
        actions={
          <Link href="/companies" className="btn ghost">
            ← {tx('กลับภาพรวมทุกบริษัท')}
          </Link>
        }
      />

      {contract.periods.length > 0 && (
        <div style={{ display: 'flex', gap: 8, marginBottom: 22, flexWrap: 'wrap' }}>
          {contract.periods.map((p) => (
            <button
              key={p.period}
              className={`btn sm${p.period === chosenPeriod ? ' pri' : ''}`}
              onClick={() => selectPeriod(p.period)}
            >
              {formatPeriodLabel(p.periodLabel)}
            </button>
          ))}
        </div>
      )}

      {cyclePeriod ? (
        <div className="kpis">
          <Kpi icon="list-chk" label={tx('Timesheet ที่ได้รับ')} value={`${cyclePeriod.received} / ${cyclePeriod.expected}`} />
          <Kpi icon="money" label={tx('มูลค่ารอบนี้')} value={money(cyclePeriod.value ?? 0)} />
          <Kpi
            icon="invoice"
            label={tx('สถานะรอบบิล')}
            value={<StatusPill tone={CYCLE_STATE_TONE[cyclePeriod.state] ?? 'mu'}>{tx(cyclePeriod.stateLabel)}</StatusPill>}
            tone="a"
          />
        </div>
      ) : (
        <Card>
          <EmptyState label={tx('ยังไม่มีรอบบิลของสัญญานี้')} />
        </Card>
      )}

      {chosenPeriod && (
        <Card title={tx('พนักงานในรอบนี้')} right={employees ? <span className="sub">{employees.length} {tx('คน')}</span> : undefined}>
          <div className="tw">
            <table>
              <thead>
                <tr>
                  <th>{tx('พนักงาน')}</th>
                  <th>{tx('ตำแหน่ง')}</th>
                  <th>{tx('สถานะ Timesheet')}</th>
                </tr>
              </thead>
              <tbody>
                {employees?.map((e) => (
                  <tr key={e.employeeId}>
                    <td>{e.nameTh}</td>
                    <td>{e.position ?? '—'}</td>
                    <td>
                      <StatusPill tone={STATUS_TONE[e.status] ?? 'mu'}>{tx(e.statusLabel)}</StatusPill>
                    </td>
                  </tr>
                ))}
                {employees === null && (
                  <tr>
                    <td colSpan={3}>
                      <Loading rows={4} />
                    </td>
                  </tr>
                )}
                {employees && employees.length === 0 && (
                  <tr>
                    <td colSpan={3} style={{ textAlign: 'center', color: 'var(--mut)' }}>
                      {tx('ยังไม่มีพนักงานผูกกับสัญญานี้')}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </>
  );
}

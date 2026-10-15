'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Card, ErrorState, Kpi, Loading, PageHeader, ProgressCell } from '../../../components/ui';
import { useLang } from '../../../lib/language';
import { useContractRef } from '../../../lib/scope';
import { isEmptyScope, useScope } from '../../../lib/scope';
import { ScopeSummary, contractRange } from '../../../components/ScopeFilterBar';

interface ContractCycles {
  id: string;
  poNo: string;
  startDate?: string;
  endDate?: string;
  employees?: Array<{ id: string; nameTh: string }>;
  customerName: string;
  projectName: string;
  headcount: number;
  contractValue: number;
  billedValue: number;
  progress: number;
}
interface EmployeeRow {
  id: string;
}

function money(n: number) {
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** ported from public/app.js's renderExecOverview() — หน้าเริ่มต้นของ role 'executive', ดูได้ล้วนๆ
 * ทุกบริษัทพร้อมกันในหน้าเดียว ใช้ /api/cycles ตัวเดิมไม่ใส่ contractId (คืนทุกสัญญามาให้พร้อม
 * ความคืบหน้าอยู่แล้ว ไม่ต้องมี endpoint ใหม่) */
export default function ExecOverviewClient() {
  const router = useRouter();
  const { tx, lang } = useLang();
  const refOf = useContractRef();
  const { filters } = useScope();
  const [contracts, setContracts] = useState<ContractCycles[] | null>(null);
  const [employees, setEmployees] = useState<EmployeeRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  function load() {
    setError(null);
    Promise.all([fetch('/api/cycles', { cache: 'no-store' }), fetch('/api/employees', { cache: 'no-store' })])
      .then(async ([cyclesRes, empsRes]) => {
        if (!cyclesRes.ok || !empsRes.ok) {
          const data = await (!cyclesRes.ok ? cyclesRes : empsRes).json().catch(() => ({}));
          setError(data?.error ?? tx('โหลดข้อมูลไม่สำเร็จ'));
          return;
        }
        const cycles = await cyclesRes.json();
        setContracts(cycles.contracts);
        setEmployees(await empsRes.json());
      })
      .catch(() => setError(tx('เชื่อมต่อเซิร์ฟเวอร์ไม่ได้')));
  }

  useEffect(load, []);

  if (error) {
    return (
      <>
        <PageHeader eyebrow={tx('ผู้บริหาร')} title={tx('ภาพรวมทุกบริษัท')} />
        <ErrorState message={error} onRetry={load} />
      </>
    );
  }
  if (!contracts || !employees) {
    return (
      <>
        <PageHeader eyebrow={tx('ผู้บริหาร')} title={tx('ภาพรวมทุกบริษัท')} />
        <Loading variant="cards" rows={3} />
        <div style={{ marginTop: 22 }}>
          <Card>
            <Loading rows={6} />
          </Card>
        </div>
      </>
    );
  }

  const totalValue = contracts.reduce((sum, c) => sum + (c.contractValue ?? 0), 0);
  // ไม่เลือกตัวกรองเลย = พนักงานทั้งระบบ (รวมคนที่ยังไม่ผูกสัญญา) · เลือกแล้ว = นับเฉพาะพนักงานในสัญญาที่กรองไว้
  const employeeCount = isEmptyScope(filters) ? employees.length : contracts.reduce((sum, c) => sum + c.headcount, 0);
  const totalBilled = contracts.reduce((sum, c) => sum + (c.billedValue ?? 0), 0);

  return (
    <>
      <PageHeader eyebrow={tx('ผู้บริหาร')} title={tx('ภาพรวมทุกบริษัท')} subtitle={tx('ข้อมูลรวมทุกบริษัทพร้อมกัน อัปเดตแบบเรียลไทม์')} />

      <ScopeSummary />

      <div className="kpis">
        <Kpi icon="building" label={tx('บริษัททั้งหมด')} value={contracts.length} />
        <Kpi icon="users" label={tx('พนักงานทั้งหมด')} value={employeeCount} />
        <Kpi icon="money" label={tx('มูลค่าสัญญารวม')} value={money(totalValue)} caption={`${tx('วางบิลแล้ว')} ${money(totalBilled)} ${tx('บาท')}`} tone="a" />
      </div>

      <Card flush>
        <div className="tw">
          <table>
            <thead>
              <tr>
                <th>{tx('บริษัท')}</th>
                <th>{tx('เลขที่ QT / PO')}</th>
                <th>{tx('โครงการ')}</th>
                <th>{tx('พนักงาน')}</th>
                <th className="r">{tx('มูลค่าสัญญา')}</th>
                <th className="r">{tx('วางบิลแล้ว')}</th>
                <th>{tx('ความคืบหน้า')}</th>
              </tr>
            </thead>
            <tbody>
              {contracts.map((c) => (
                <tr key={c.id} className="rw" onClick={() => router.push(`/companies/${encodeURIComponent(c.id)}`)}>
                  <td>{c.customerName}</td>
                  <td className="n">{refOf(c).value}</td>
                  <td>
                    {c.projectName}
                    {c.startDate && c.endDate && <div className="sub">{contractRange({ startDate: c.startDate, endDate: c.endDate }, lang)}</div>}
                  </td>
                  <td>{c.employees && c.employees.length > 0 ? c.employees.map((e) => e.nameTh).join(', ') : c.headcount}</td>
                  <td className="r n">{money(c.contractValue)}</td>
                  <td className="r n">{money(c.billedValue)}</td>
                  <td>
                    <ProgressCell percent={c.progress} fraction={`${c.progress}%`} />
                  </td>
                </tr>
              ))}
              {contracts.length === 0 && (
                <tr>
                  <td colSpan={7} style={{ textAlign: 'center', color: 'var(--mut)' }}>
                    {tx('ยังไม่มีสัญญาในระบบ')}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  );
}

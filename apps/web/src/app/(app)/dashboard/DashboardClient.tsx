'use client';

import { Card, Kpi, PageHeader, PoTag, ProgressCell, TaskList, type TaskLink } from '../../../components/ui';
import { Icon } from '../../../components/Icon';
import { useLang } from '../../../lib/language';

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
  recentAudit: Array<{ at: string; actor: string; action: string; entityType: string | null; entityId: string | null }>;
}

function money(n: number) {
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default function DashboardClient({ data, nameTh }: { data: DashboardData; nameTh: string }) {
  const { tx } = useLang();

  return (
    <>
      <PageHeader
        eyebrow={tx('สวัสดีต้อนรับ')}
        title={tx('แดชบอร์ด OBS')}
        subtitle={nameTh}
        actions={
          <span className="datelabel">
            <Icon name="cal" className="sm" />
            {tx('ข้อมูล ณ')} {data.today}
          </span>
        }
      />

      <Card title={tx('สัญญา')} flush>
        <div className="tw">
          <table>
            <thead>
              <tr>
                <th>PO</th>
                <th>{tx('ลูกค้า')}</th>
                <th>{tx('โครงการ')}</th>
                <th>{tx('คน')}</th>
                <th>{tx('ความคืบหน้า')}</th>
                <th className="r">{tx('มูลค่าคงเหลือ')}</th>
              </tr>
            </thead>
            <tbody>
              {data.contracts.map((c) => (
                <tr key={c.id}>
                  <td>
                    <PoTag>{c.poNo}</PoTag>
                  </td>
                  <td className="nm">{c.customerName}</td>
                  <td>{c.projectName}</td>
                  <td>{c.headcount}</td>
                  <td>
                    <ProgressCell percent={c.progress} fraction={`${c.monthsBilled}/${c.monthsTotal} (${c.progress}%)`} />
                  </td>
                  <td className="r n">{money(c.remainingValue)}</td>
                </tr>
              ))}
              {data.contracts.length === 0 && (
                <tr>
                  <td colSpan={6} style={{ textAlign: 'center', color: 'var(--mut)' }}>
                    {tx('ไม่มีสัญญา')}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
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
          icon="invoice"
          label={tx('พร้อมวางบิล')}
          value={data.counts.readyToBill}
          caption={`${tx('มูลค่า')} ${money(data.readyValue)} ${tx('บาท')}`}
          tone="g"
        />
        <Kpi
          icon="envelope-plus"
          label={tx('ยอดวางบิลแล้ว')}
          value={money(data.billedAmount)}
          caption={`${data.invoiceCount} ${tx('ใบ')}`}
          tone="a"
        />
      </div>

      <Card title={tx('งานที่ต้องทำ')}>
        <TaskList tasks={data.tasks} />
      </Card>

      <Card title={tx('สรุปสถานะ Timesheet')}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <StatRow label={tx('ทั้งหมด')} value={data.counts.total} />
          <StatRow label={tx('ข้อมูลไม่ตรง')} value={data.counts.mismatch} />
          <StatRow label={tx('วางบิลแล้ว')} value={data.counts.billed} />
          <StatRow label={tx('ตีกลับ')} value={data.counts.rejected} />
        </div>
      </Card>

      <div className="mosaic c2">
        <Card title={tx('รอบบิล')} flush>
          <div className="tw">
            <table>
              <thead>
                <tr>
                  <th>{tx('ลูกค้า')}</th>
                  <th>{tx('รอบ')}</th>
                  <th>{tx('สถานะ')}</th>
                </tr>
              </thead>
              <tbody>
                {data.cycles.slice(0, 20).map((c, i) => (
                  <tr key={`${c.contractId}-${c.period}-${i}`}>
                    <td>{c.customerName}</td>
                    <td>{c.periodLabel}</td>
                    <td>{tx(c.stateLabel)}</td>
                  </tr>
                ))}
                {data.cycles.length === 0 && (
                  <tr>
                    <td colSpan={3} style={{ textAlign: 'center', color: 'var(--mut)' }}>
                      {tx('ไม่มีรอบบิล')}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Card>

        <Card title={tx('กิจกรรมล่าสุด')}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {data.recentAudit.map((a, i) => (
              <div key={i} style={{ fontSize: 13 }}>
                <span style={{ color: 'var(--mut)' }}>{a.at}</span> · {a.actor} · {a.action}
                {a.entityType ? ` · ${a.entityType}${a.entityId ? ` ${a.entityId}` : ''}` : ''}
              </div>
            ))}
            {data.recentAudit.length === 0 && <div style={{ color: 'var(--mut)', fontSize: 13 }}>{tx('ไม่มีกิจกรรม')}</div>}
          </div>
        </Card>
      </div>
    </>
  );
}

function StatRow({ label, value }: { label: string; value: number }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13.5 }}>
      <span style={{ color: 'var(--mut)' }}>{label}</span>
      <span style={{ fontWeight: 600 }} className="n">
        {value}
      </span>
    </div>
  );
}

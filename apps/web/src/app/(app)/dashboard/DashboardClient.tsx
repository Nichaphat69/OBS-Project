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

      <div className="mosaic c2" style={{ marginBottom: 26 }}>
        <ContractProgressCard contracts={data.contracts} />
        <Card title={tx('งานที่ต้องทำ')}>
          <TaskList tasks={data.tasks} />
        </Card>
      </div>

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

      <div className="kpis" style={{ marginTop: 26 }}>
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

/** การ์ดสรุปความคืบหน้าสัญญา — อยู่บนสุดของแดชบอร์ด กรอบสีฟ้าเด่น + วงกลมไล่สีแสดง % รวม (weighted by
 * จำนวนเดือนของแต่ละสัญญา) เผื่อกรณีมีหลายสัญญาพร้อมกันในมุมมองนี้ */
function ContractProgressCard({
  contracts,
}: {
  contracts: DashboardData['contracts'];
}) {
  const { tx } = useLang();
  const monthsTotal = contracts.reduce((s, c) => s + c.monthsTotal, 0);
  const monthsBilled = contracts.reduce((s, c) => s + c.monthsBilled, 0);
  const percent = monthsTotal ? Math.round((monthsBilled / monthsTotal) * 100) : 0;
  const single = contracts.length === 1 ? contracts[0] : null;
  // ปกติหน้านี้กรองตามบริษัทที่เลือกอยู่แล้ว (ดู dashboard/page.tsx) เหลือสัญญาบริษัทเดียวเสมอ — แต่ถ้า
  // ไม่มีบริษัทไหน active เลย (เช่นเพิ่งปิดบริษัทเดิมไปแต่ยังไม่ได้เลือกใหม่) contracts จะเป็นของ
  // "ทุกบริษัท" รวมกัน ต้องไม่เอาชื่อบริษัทแรกในลิสต์มาตั้งเป็นหัวข้อ ไม่งั้น % ที่โชว์ (ซึ่งรวมทุกบริษัท)
  // จะดูเหมือนเป็นของบริษัทเดียวนั้นทั้งที่ไม่ใช่
  const title = single ? `${single.customerName} — ${single.projectName}` : contracts.length > 1 ? tx('ทุกบริษัท') : tx('ไม่มีสัญญา');

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 20,
        background: 'var(--tint)',
        border: '1px solid var(--bline)',
        borderRadius: 'var(--r-card)',
        padding: '22px 26px',
      }}
    >
      <div>
        <div className="ey">{tx('ความคืบหน้าสัญญา')}</div>
        <h3 style={{ margin: '6px 0 0', fontSize: 20, fontWeight: 700, color: 'var(--ink)' }}>{title}</h3>
        {contracts.length > 0 && (
          <div className="sub" style={{ marginTop: 6 }}>
            {monthsBilled}/{monthsTotal} {tx('เดือน')}
            {contracts.length > 1 ? ` · ${contracts.length} ${tx('สัญญา')}` : ''}
          </div>
        )}
      </div>
      {contracts.length > 0 && <DonutChart percent={percent} />}
    </div>
  );
}

function DonutChart({ percent, size = 96 }: { percent: number; size?: number }) {
  const stroke = 10;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const offset = c * (1 - Math.min(100, Math.max(0, percent)) / 100);
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ flex: 'none' }}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--tint2)" strokeWidth={stroke} />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke="url(#dashDonutGrad)"
        strokeWidth={stroke}
        strokeLinecap="round"
        strokeDasharray={c}
        strokeDashoffset={offset}
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
      />
      <defs>
        <linearGradient id="dashDonutGrad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="var(--brand-l)" />
          <stop offset="100%" stopColor="var(--brand-h)" />
        </linearGradient>
      </defs>
      <text x="50%" y="50%" textAnchor="middle" dominantBaseline="central" fontSize={size * 0.22} fontWeight={700} fill="var(--brand-d)">
        {percent}%
      </text>
    </svg>
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

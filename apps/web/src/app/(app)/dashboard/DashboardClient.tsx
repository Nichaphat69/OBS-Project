'use client';

import { Card, EmptyState, Kpi, PageHeader, PoTag, ProgressCell, StatusPill, Tag, TaskList, type TaskLink } from '../../../components/ui';
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
  const { tx, formatPeriod } = useLang();

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

      <Card title={tx('สัญญา')}>
        {data.contracts.length === 0 ? (
          <EmptyState label={tx('ไม่มีสัญญา')} />
        ) : (
          <div className="constrips">
            {data.contracts.map((c) => (
              <div key={c.id} className="constrip">
                <div className="cf">
                  <span className="lbl">{tx('เลขที่ PO')}</span>
                  <PoTag>{c.poNo}</PoTag>
                </div>
                <div className="cf">
                  <span className="lbl">{tx('ลูกค้า')}</span>
                  <Tag tone="mu">{c.customerName}</Tag>
                </div>
                <div className="cf grow">
                  <span className="lbl">{tx('โครงการ')}</span>
                  <b>{c.projectName}</b>
                </div>
                <div className="cf">
                  <span className="lbl">&nbsp;</span>
                  <span className="hc">
                    <Icon name="users" className="sm" />
                    {c.headcount} {tx('คน')}
                  </span>
                </div>
                <div className="cf">
                  <span className="lbl">{tx('ความคืบหน้า')}</span>
                  <ProgressCell percent={c.progress} fraction={`${c.monthsBilled}/${c.monthsTotal} (${c.progress}%)`} />
                </div>
                <div className="cf end">
                  <span className="lbl">{tx('มูลค่าคงเหลือ')}</span>
                  <b className="n cv">{money(c.remainingValue)}</b>
                </div>
              </div>
            ))}
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
          icon="send"
          label={tx('ยอดวางบิลแล้ว')}
          value={money(data.billedAmount)}
          caption={`${data.invoiceCount} ${tx('ใบ')}`}
          tone="a"
        />
      </div>

      {/* .mosaic.c2 คือ 1.6fr 1fr — ให้ "งานที่ต้องทำ" อยู่คอลัมน์กว้าง เพราะรายการยาวได้ไม่จำกัดและ
          บรรทัดรายละเอียดยาว ส่วนสรุปสถานะเป็นสี่บรรทัดสั้นคงที่ จึงอยู่คอลัมน์แคบได้สบาย */}
      <div className="mosaic c2">
        <Card title={tx('งานที่ต้องทำ')}>
          <TaskList tasks={data.tasks} />
        </Card>

        <Card title={tx('สรุปสถานะ Timesheet')}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <StatRow dot="a" label={tx('ทั้งหมด')} value={data.counts.total} />
            <StatRow dot="wn" label={tx('ข้อมูลไม่ตรง')} value={data.counts.mismatch} />
            <StatRow dot="ok" label={tx('วางบิลแล้ว')} value={data.counts.billed} />
            <StatRow dot="cr" label={tx('ตีกลับ')} value={data.counts.rejected} />
          </div>
        </Card>
      </div>

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
                    <td>{formatPeriod(c.period)}</td>
                    <td>
                      <StatusPill tone={CYCLE_STATE_TONE[c.state] ?? 'mu'}>{tx(c.stateLabel)}</StatusPill>
                    </td>
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

/** ใช้ tone เดียวกับ CYCLE_STATE_TONE ใน CompanyDetailClient.tsx (ไม่ได้ใช้ enum เดียวกันเป๊ะ — ที่นี่แค่ไล่สี
 * ตามความหมาย: ฟ้า=รวม, เหลือง=ต้องแก้, เขียว=เสร็จแล้ว, แดง=มีปัญหา) เพื่อให้จุดสีตรงกับ StatusPill ด้านล่าง */
const CYCLE_STATE_TONE: Record<string, 'ok' | 'wn' | 'cr' | 'mu' | 'pr'> = {
  awaiting: 'mu',
  partial: 'wn',
  mismatch: 'cr',
  checking: 'wn',
  ready: 'ok',
  billed: 'ok',
};

const DOT_COLOR: Record<string, string> = {
  a: 'var(--brand)',
  wn: 'var(--wn)',
  ok: 'var(--ok)',
  cr: 'var(--cr)',
};

function StatRow({ label, value, dot }: { label: string; value: number; dot: 'a' | 'wn' | 'ok' | 'cr' }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 13.5 }}>
      <span style={{ display: 'flex', alignItems: 'center', gap: 9, color: 'var(--mut)' }}>
        <span
          style={{
            width: 8,
            height: 8,
            borderRadius: '50%',
            background: DOT_COLOR[dot],
            flex: 'none',
          }}
        />
        {label}
      </span>
      <span style={{ fontWeight: 600 }} className="n">
        {value}
      </span>
    </div>
  );
}

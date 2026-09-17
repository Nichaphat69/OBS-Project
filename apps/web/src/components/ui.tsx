import Link from 'next/link';
import { Icon } from './Icon';
import { useLang } from '../lib/language';

export function PageHeader({
  eyebrow,
  title,
  subtitle,
  actions,
}: {
  eyebrow: string;
  title: string;
  subtitle?: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <div className="phd">
      <div>
        <span className="ey">{eyebrow}</span>
        <h1>{title}</h1>
        {subtitle && <p>{subtitle}</p>}
      </div>
      {actions && <div className="acts">{actions}</div>}
    </div>
  );
}

export function Card({
  title,
  right,
  flush,
  footer,
  children,
}: {
  title?: string;
  right?: React.ReactNode;
  flush?: boolean;
  footer?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="card">
      {title && (
        <div className="hd">
          <h3>{title}</h3>
          {right && <div className="rt">{right}</div>}
        </div>
      )}
      <div className={`bd${flush ? ' flush' : ''}`}>{children}</div>
      {footer && <div className="ft">{footer}</div>}
    </div>
  );
}

type KpiTone = 'w' | 'g' | 'c' | 'a' | undefined;

export function Kpi({
  icon,
  label,
  value,
  caption,
  tone,
}: {
  icon: string;
  label: string;
  value: React.ReactNode;
  caption?: string;
  tone?: KpiTone;
}) {
  return (
    <div className={`kpi${tone ? ` ${tone}` : ''}`}>
      <div className="kh">
        <span className="ic">
          <Icon name={icon} />
        </span>
        <span className="kl">{label}</span>
      </div>
      <span className="kv">{value}</span>
      {caption && <span className="kf">{caption}</span>}
    </div>
  );
}

type PillTone = 'ok' | 'wn' | 'cr' | 'pr' | 'mu';

export function StatusPill({ tone, children }: { tone: PillTone; children: React.ReactNode }) {
  return <span className={`st ${tone}`}>{children}</span>;
}

export function Tag({ tone, children }: { tone: PillTone; children: React.ReactNode }) {
  return <span className={`tg ${tone}`}>{children}</span>;
}

/** เลข PO/ใบว่าจ้าง — ป้ายไล่สีให้เด่นกว่า plain text ธรรมดา ใช้ตรงหัวข้อหน้าที่โชว์เลขใบว่าจ้างของสัญญา
 * (หนึ่งบริษัทมีได้หลายสัญญา/หลาย PO อยู่แล้วที่ระดับข้อมูล — คอมโพเนนต์นี้แค่ให้แต่ละ PO เด่นขึ้น) */
export function PoTag({ children }: { children: React.ReactNode }) {
  return (
    <span className="po-badge">
      <span className="lbl">PO</span> {children}
    </span>
  );
}

/** แถบความคืบหน้า + สัดส่วนตัวเลข (เช่น 3/12 เดือน) — เดิมแต่ละหน้าประกอบ .bar+span เองแยกกัน
 * รวมเป็นคอมโพเนนต์เดียวให้เรียงตัวสม่ำเสมอ ไม่ว่าจะมีกี่แถว */
export function ProgressCell({ percent, fraction }: { percent: number; fraction: string }) {
  return (
    <div className="progress-cell">
      <div className="bar">
        <span style={{ width: `${percent}%` }} />
      </div>
      <span className="sub frac">{fraction}</span>
    </div>
  );
}

export interface TaskLink {
  view: string;
  id?: string;
  contractId?: string;
  period?: string;
}

/** สร้าง URL จาก task.link ที่ backend ส่งมา (ดู dashboardService.ts's tasks) — 'detail' คือ Timesheet
 * ที่ต้องแก้/ยืนยัน (หน้าตรวจ Manday), 'cycle' คือรอบบิลที่พร้อมอนุมัติ (หน้าวางบิล & ร่างอีเมล) */
function taskHref(link?: TaskLink | null): string | null {
  if (!link) return null;
  if (link.view === 'detail' && link.id) return `/manday/${link.id}`;
  if (link.view === 'cycle' && link.contractId && link.period) return `/billing/${link.contractId}/${link.period}`;
  return null;
}

export function TaskList({
  tasks,
}: {
  tasks: Array<{ level: string; title: string; detail: string; link?: TaskLink | null }>;
}) {
  const { tx } = useLang();
  if (tasks.length === 0) {
    return <EmptyState label={tx('ไม่มีงานค้าง')} />;
  }
  return (
    <div className="tasklist">
      {tasks.map((t, i) => {
        const href = taskHref(t.link);
        return (
          <div key={i} className={`taskrow ${t.level}`}>
            <div className="tt">
              <b>{t.title}</b>
              <span>{t.detail}</span>
            </div>
            {href && (
              <Link href={href} className="btn ghost sm">
                {tx('เปิด')}
              </Link>
            )}
          </div>
        );
      })}
    </div>
  );
}

export function EmptyState({ label }: { label: string }) {
  return (
    <div className="empty">
      <div className="ic">
        <Icon name="clock" className="lg" />
      </div>
      {label}
    </div>
  );
}

/** แสดงตอนโหลดข้อมูลรายการไม่สำเร็จ (backend ล่ม/session หมดอายุ/เน็ตหลุด) — เดิมหลายหน้าไม่มี error
 * state เลย โหลดพังแล้วค้างว่างเปล่าถาวรหรือ crash ทั้งหน้า อันนี้ให้ retry ได้เองไม่ต้อง reload */
export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  const { tx } = useLang();
  return (
    <div className="empty">
      <div className="ic" style={{ background: 'var(--crb)', color: 'var(--cr)' }}>
        <Icon name="alt" className="lg" />
      </div>
      <div style={{ color: 'var(--cr)' }}>{message}</div>
      {onRetry && (
        <button className="btn sm" style={{ marginTop: 12 }} onClick={onRetry}>
          {tx('ลองใหม่')}
        </button>
      )}
    </div>
  );
}

export function ComingSoon({ title, eyebrow }: { title: string; eyebrow: string }) {
  const { tx } = useLang();
  return (
    <>
      <PageHeader eyebrow={eyebrow} title={title} subtitle={tx('ส่วนนี้อยู่ระหว่างพอร์ตต่อจาก MIGRATION_PLAN.md')} />
      <Card>
        <EmptyState label={tx('กำลังพัฒนาในเฟสถัดไป — เชื่อมข้อมูลจริงเร็ว ๆ นี้')} />
      </Card>
    </>
  );
}

/** ป้ายบอกว่า Timesheet ใบนี้อ่านมาด้วยอะไร — ค่าที่เก็บไว้ใน `extraction.model` มีรูปแบบ
 * `<engine>[:<skill/template>][ · คนยืนยัน]` เช่น "abbyy", "abbyy:Timesheet · คนยืนยัน",
 * "local:google/gemma-4-e4b (ชั้นข้อความ)", "manual"
 *
 * โชว์ชื่อเครื่องอ่านเป็นตัวหลัก ส่วน skill/template id ยาวๆ ซ่อนไว้ใน tooltip — คนที่ดูใบวางบิล
 * อยากรู้ว่า "เจ้าไหนอ่าน" ส่วน id เอาไว้ตอนไล่ปัญหา ไม่ใช่ข้อมูลที่ต้องอ่านทุกครั้ง */
const READ_ENGINE_LABEL: Record<string, string> = {
  abbyy: 'ABBYY',
  'clear-read': 'Clear Read',
  local: 'โมเดลในเครื่อง',
  'local-llm': 'โมเดลในเครื่อง',
  manual: 'ป้อนด้วยมือ',
};

export function parseReadModel(model?: string | null) {
  if (!model) return null;
  const humanConfirmed = model.includes(' · คนยืนยัน');
  const base = model.replace(' · คนยืนยัน', '').trim();
  const sep = base.indexOf(':');
  const engine = sep >= 0 ? base.slice(0, sep) : base;
  const detail = sep >= 0 ? base.slice(sep + 1).trim() : null;
  return { engine, detail, humanConfirmed, label: READ_ENGINE_LABEL[engine] ?? engine };
}

export function ReadModelTag({ model }: { model?: string | null }) {
  const parsed = parseReadModel(model);
  if (!parsed) return null;
  return (
    <span className="readmodel" title={parsed.detail ? `${parsed.label} · ${parsed.detail}` : parsed.label}>
      <span className={`rm-dot ${parsed.engine}`} />
      {parsed.label}
      {parsed.detail && <span className="rm-id">{parsed.detail}</span>}
    </span>
  );
}

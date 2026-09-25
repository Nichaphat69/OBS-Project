import Link from 'next/link';
import { Icon } from './Icon';
import { useLang } from '../lib/language';
import { BackButton } from './BackButton';

/** แถบสลับแท็บทรงเส้นใต้ (ไม่ใช่ปุ่ม) — ใช้แทน `.btn.sm`/`.btn.pri` ที่แต่ละหน้า (ตรวจ Manday/บันทึกการส่ง/
 * ข้อมูลหลัก/จัดการระบบ/อัปโหลด Timesheet) เคยประกอบเองซ้ำๆ กันมาก่อน (เจ้าของระบบสั่ง 21 ก.ย. 69 "อยากได้
 * แบบนี้" — ตัวหนังสือแท็บที่เลือกอยู่เป็นสีฟ้าหนา มีแถบไล่สีฟ้าบางๆ ใต้ตัวหนังสือ ไม่ใช่ปุ่มพื้นสีเต็ม)
 * ทำเป็นคอมโพเนนต์กลางแทนแก้ 5 จุดแยกกัน จะได้แก้ที่เดียวถ้ามีรอบต่อไป */
export function TabStrip<K extends string>({
  tabs,
  active,
  onChange,
}: {
  tabs: ReadonlyArray<{ key: K; label: string; count?: number }>;
  active: K;
  onChange: (key: K) => void;
}) {
  const { tx } = useLang();
  return (
    <div className="tabstrip">
      {tabs.map((t) => (
        <button
          key={t.key}
          type="button"
          onClick={() => onChange(t.key)}
          className={`tsi${active === t.key ? ' on' : ''}`}
        >
          {tx(t.label)}
          {typeof t.count === 'number' && <span className="n"> {t.count}</span>}
        </button>
      ))}
    </div>
  );
}

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
      {/* ปุ่มย้อนกลับอยู่มุมขวาบนของทุกหน้าเสมอ (เจ้าของระบบสั่ง 24 ก.ย. 69) — อยู่หน้าปุ่ม action
          อื่นๆ ของแต่ละหน้า (ถ้ามี) ไม่ใช่แทนที่ */}
      <div className="acts">
        <BackButton />
        {actions}
      </div>
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
  eyebrow,
  label,
  value,
  caption,
  tone,
}: {
  icon: string;
  /** ป้ายอังกฤษตัวพิมพ์ใหญ่เหนือ label (เช่น "PENDING") — แค่ของตกแต่ง ไม่ใช่ข้อมูลใหม่ ผู้เรียกกำหนดเอง
   * ต่อการ์ดไป ไม่ผูกกับ tone อัตโนมัติ เพราะ tone เดียวกันความหมายไม่เหมือนกันทุกหน้าที่ใช้ Kpi ร่วมกัน */
  eyebrow?: string;
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
        <div className="kt">
          {eyebrow && <span className="ke">{eyebrow}</span>}
          <span className="kl">{label}</span>
        </div>
      </div>
      <span className="kv">{value}</span>
      {caption && <span className="kf">{caption}</span>}
    </div>
  );
}

type PillTone = 'ok' | 'wn' | 'cr' | 'pr' | 'mu';

export function StatusPill({ tone, children, title }: { tone: PillTone; children: React.ReactNode; title?: string }) {
  return (
    <span className={`st ${tone}`} title={title}>
      {children}
    </span>
  );
}

export function Tag({ tone, children, title }: { tone: PillTone; children: React.ReactNode; title?: string }) {
  return (
    <span className={`tg ${tone}`} title={title}>
      {children}
    </span>
  );
}

/** เลข PO/ใบว่าจ้าง — ป้ายไล่สีให้เด่นกว่า plain text ธรรมดา ใช้ตรงหัวข้อหน้าที่โชว์เลขใบว่าจ้างของสัญญา
 * (หนึ่งบริษัทมีได้หลายสัญญา/หลาย PO อยู่แล้วที่ระดับข้อมูล — คอมโพเนนต์นี้แค่ให้แต่ละ PO เด่นขึ้น) */
export function PoTag({ children }: { children: React.ReactNode }) {
  return (
    <span className="po-badge">
      <span className="lbl">PO</span>
      <b className="num">{children}</b>
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
  // ไฟล์ที่พนักงานส่งเองรอเปิดอ่าน — หน้าอัปโหลดเปิดแท็บ "รอจากพนักงาน" เป็นค่าเริ่มต้นอยู่แล้ว
  if (link.view === 'employeeQueue') return '/upload';
  return null;
}

/** ไอคอนต่อระดับความด่วน (level มาจาก backend เดิม ไม่ได้เพิ่ม field ใหม่) — ใช้แค่เลือกหน้าตา
 * ไม่เกี่ยวกับข้อมูล: วิกฤต=สามเหลี่ยมเตือน, รอดำเนินการ=นาฬิกา, ข้อมูลทั่วไป=ส่ง */
const TASK_ICON: Record<string, string> = { critical: 'alt', warn: 'clock', info: 'send' };

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
            <div className="ic">
              <Icon name={TASK_ICON[t.level] ?? 'info'} />
            </div>
            <div className="tt">
              <b>{tx(t.title)}</b>
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

/** โครงกระดูก (skeleton) ตอนกำลังโหลด — เดิมแต่ละหน้าโชว์แค่ข้อความ "กำลังโหลด…" หรือว่างเปล่าเลย (เช่นแท็บ
 * ดึงจาก Gmail) ดูเหมือนหน้าพัง (เจ้าของระบบสั่ง 24 ก.ย. 69 "ทำ lazy loading ทุกหน้า") — แท่งเทาวิ่งแสงเป็นรูปทรง
 * คร่าวๆ ของเนื้อหาที่กำลังจะมา ใช้ที่เดียวทุกหน้า
 * - `table` = แถวตาราง (ค่าเริ่มต้น) · `cards` = การ์ด KPI เรียงแนวนอน · `lines` = บรรทัดข้อความสั้นๆ (ในแถวที่กางออก/panel เล็ก) */
export function Loading({ variant = 'table', rows = 5, label }: { variant?: 'table' | 'cards' | 'lines'; rows?: number; label?: string }) {
  const { tx } = useLang();
  return (
    <div className={`skel skel-${variant}`} role="status" aria-busy="true" aria-live="polite">
      <span className="sr-only">{label ?? tx('กำลังโหลด…')}</span>
      {variant === 'cards'
        ? Array.from({ length: rows }, (_, i) => (
            <div key={i} className="skel-card">
              <div className="skel-bar" style={{ width: '45%' }} />
              <div className="skel-bar lg" style={{ width: '65%' }} />
            </div>
          ))
        : Array.from({ length: rows }, (_, i) => (
            <div key={i} className="skel-row">
              {variant === 'table' && <div className="skel-bar" style={{ width: 28, flex: 'none' }} />}
              <div className="skel-bar" style={{ width: `${[62, 48, 70, 55, 40][i % 5]}%` }} />
              {variant === 'table' && <div className="skel-bar" style={{ width: '18%', marginLeft: 'auto' }} />}
            </div>
          ))}
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

/** ชื่อ Skill/แม่แบบต่อ engine เอาไว้ map รหัสดิบ (`parsed.detail`) → ชื่อที่คนอ่านออก — คีย์คือ
 * `parsed.engine` ("abbyy" | "clear-read") ค่าคือ `{[skillId หรือ templateId]: name}` ของ engine นั้น
 * ต้องดึงมาเองจากหน้าเรียก (GET /api/abbyy-skills, GET /api/settings/clear-read/templates) เพราะ
 * ui.tsx เป็น component ล้วนๆ ไม่ยิง fetch เอง — ไม่ส่งมาก็ยัง fallback ไปโชว์รหัสดิบเหมือนเดิมทุกจุด */
export type ReadModelNameMap = Record<string, Record<string, string>>;

/**
 * ป้ายนี้เปลี่ยนความหมายจาก "อ่านด้วยเครื่องมืออะไร" เป็น "ได้ไฟล์มาทางไหน" ตามที่เจ้าของระบบสั่ง
 * 18 ก.ย. 69 — สามกรณีเรียงตามลำดับความสำคัญ (channel ชนะชื่อ engine):
 *
 * 1. มี `sourceEmailId` (ดึงมาจาก Gmail) → "ดึงจาก Gmail" ไม่ว่า AI เจ้าไหนจะเป็นคนอ่านก็ตาม
 * 2. engine เป็น `manual` (พิมพ์เองจากแท็บ "กรอกเอง" — ไม่มีไฟล์เก็บเลยจริงๆ) → "อัปโหลด Timesheet"
 *    ("อัปโหลด Timesheet" คือชื่อหน้าที่ทั้งอัปโหลดไฟล์และกรอกเองอยู่ด้วยกัน ไม่ได้แปลว่ามีไฟล์จริง
 *    แต่บอกว่าเข้าระบบทางหน้านี้ ไม่ใช่ทาง Gmail)
 * 3. นอกนั้น (อัปโหลดไฟล์จริงแล้วให้ ABBYY/Clear Read/โมเดลในเครื่องอ่าน) → คงชื่อ engine ไว้เหมือนเดิม
 *
 * จุดสี (`rm-dot`) ยังคงผูกกับ engine จริงเหมือนเดิมโดยตั้งใจ ไม่ผูกกับ channel — ใบที่ Gmail ดึงมาแล้ว
 * ABBYY อ่าน จุดยังเป็นสีแดงของ ABBYY เพราะยังมีประโยชน์ตอนไล่ปัญหาว่าใครอ่านจริง แค่ตัวหนังสือเปลี่ยน
 */
export function ReadModelTag({ model, sourceEmailId, nameMap }: { model?: string | null; sourceEmailId?: string | null; nameMap?: ReadModelNameMap }) {
  const { tx } = useLang();
  const parsed = parseReadModel(model);
  if (!parsed) return null;
  const label = sourceEmailId ? tx('ดึงจาก Gmail') : parsed.engine === 'manual' ? tx('อัปโหลด Timesheet') : tx(parsed.label);
  // หา UUID ไม่เจอในสารบัญ (Skill ถูกลบไปแล้ว/ยังไม่ได้ซิงก์) — fallback เป็นรหัสดิบเดิม ไม่ใช่ซ่อนไปเฉยๆ
  // เพราะรหัสดิบยังมีประโยชน์ตอนไล่ปัญหาว่าเอกสารนี้อ่านด้วย Skill ไหนกันแน่ — ยังโชว์ต่อแม้ label
  // ข้างหน้าจะเปลี่ยนเป็น channel แล้ว เพราะเป็นคนละคำถามกัน (มาทางไหน vs ใครอ่าน)
  // 25 ก.ย. 69 — โค้ดเคยโชว์ resolvedDetail (ชื่อ Skill/แม่แบบเต็มๆ) เป็น <span> แยกไว้บนหน้าตรงๆ
  // ทั้งที่ comment ด้านบนของฟังก์ชันนี้ (และของสารบัญด้านล่าง) เขียนไว้ตั้งแต่แรกว่าจะ "ซ่อนไว้ใน
  // tooltip" — ขัดกับที่โค้ดทำจริง (เจ้าของระบบสั่งซ้ำอีกรอบว่าต้องซ่อน metadata เชิงเทคนิคจากมุมมอง
  // user) เอา <span> ออก เหลือแค่ label หลัก (ชื่อเครื่องอ่าน/ช่องทาง) บนหน้า ส่วนรายละเอียด Skill/
  // แม่แบบยังอยู่ใน title (hover ดูได้) เหมือนที่ตั้งใจไว้แต่แรกทุกประการ
  const resolvedDetail = (parsed.detail && nameMap?.[parsed.engine]?.[parsed.detail]) || parsed.detail;
  return (
    <span className="readmodel" title={resolvedDetail ? `${label} · ${resolvedDetail}` : label}>
      <span className={`rm-dot ${parsed.engine}`} />
      {label}
    </span>
  );
}

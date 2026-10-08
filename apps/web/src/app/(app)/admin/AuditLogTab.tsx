'use client';

import { useEffect, useMemo, useState } from 'react';
import { Card, ErrorState, Loading } from '../../../components/ui';
import { Icon } from '../../../components/Icon';
import { useLang } from '../../../lib/language';
import '../../../components/admin-log.css';

interface AuditLogRow {
  id: number;
  at: string;
  actor: string;
  action: string;
  entityType: string | null;
  entityId: string | null;
  detail: unknown;
}

const PAGE_SIZE = 50;

type Tone = 'ok' | 'info' | 'warn' | 'err' | 'sys' | 'mut';

/** แบ่งสีตามชนิดของการกระทำ (ไล่จากเฉพาะเจาะจงไปทั่วไป): ผิดพลาด/ลบ = แดง · ควรระวัง = เหลืองอำพัน · สร้าง/สำเร็จ = เขียว
 * · แก้ไข/อ่าน = ฟ้า · แจ้งเตือน/อีเมล/LINE = ม่วง · อื่นๆ = เทา — ใช้ชื่อ action ตรงๆ ไม่ต้องรอ backend ส่งหมวดมา */
function toneOf(action: string): Tone {
  if (/(failed|error|denied|blocked)/.test(action) || /^delete_/.test(action)) return 'err';
  if (/^(reset_|dismiss_|undismiss_|discard_|deactivate_)/.test(action)) return 'warn';
  if (/^(create_|add_|receive_|link_|approve|enqueue_|human_checked|reactivate_|claim_|gmail_draft_created|email_sent_detected|employee_submitted|flowaccount_contact_linked|ingest_ok)/.test(action)) return 'ok';
  if (/^(update_|recompute_|read_|extract_|set_|change_|save_|edit_)/.test(action)) return 'info';
  if (/^(notify_|line_|email_|gmail_|draft_)/.test(action)) return 'sys';
  return 'mut';
}

const TONE_LABEL: Record<Tone, string> = {
  ok: 'สร้าง / สำเร็จ',
  info: 'แก้ไข / อ่าน',
  warn: 'ควรระวัง',
  err: 'ผิดพลาด / ลบ',
  sys: 'แจ้งเตือน / ระบบ',
  mut: 'อื่นๆ',
};
const TONE_ICON: Record<Tone, string> = { ok: 'chk', info: 'file', warn: 'alt', err: 'x', sys: 'bell', mut: 'file' };

/** ชื่อไทยของ action ที่เจอบ่อย — ที่ไม่อยู่ในนี้แสดงชื่อ action ตรงๆ (เปลี่ยน _ เป็นช่องว่าง) */
const ACTION_TH: Record<string, string> = {
  create_user: 'สร้างผู้ใช้',
  delete_user: 'ลบผู้ใช้',
  update_user_names: 'แก้ชื่อผู้ใช้',
  update_user_role: 'เปลี่ยน Role ผู้ใช้',
  update_user_employee: 'ผูกผู้ใช้กับพนักงาน',
  reset_password: 'รีเซ็ตรหัสผ่าน',
  set_user_active: 'เปิด/ปิดใช้งานผู้ใช้',
  create_contract: 'สร้างสัญญา',
  delete_contract: 'ลบสัญญา',
  deactivate_contract: 'ปิดสัญญา',
  create_customer: 'สร้างลูกค้า',
  delete_customer: 'ลบลูกค้า',
  create_employee: 'เพิ่มพนักงาน',
  receive_inbound_email: 'รับไฟล์จากอีเมล',
  read_inbound_email: 'อ่านไฟล์จากอีเมล',
  read_timesheet_file: 'อ่านไฟล์ Timesheet',
  extract_timesheet: 'อ่านข้อมูล Timesheet',
  enqueue_read_batch: 'ส่งเข้าคิวอ่าน',
  enqueue_read_from_inbox: 'ส่งเข้าคิวอ่านจากกล่องเมล',
  recompute_manday: 'คำนวณ Manday ใหม่',
  human_checked: 'ตรวจ Manday แล้ว',
  approve_cycle: 'อนุมัติรอบบิล',
  approve_line: 'อนุมัติผ่าน LINE',
  delete_invoice: 'ลบใบแจ้งหนี้',
  gmail_draft_created: 'สร้างร่างอีเมลวางบิล',
  dismiss_gmail_message: 'ซ่อนอีเมลจากรายการ',
  discard_ai_read: 'ทิ้งผลการอ่าน',
  create_support_ticket: 'แจ้งปัญหา',
  create_abbyy_skill: 'เพิ่ม ABBYY Skill',
  delete_abbyy_skill: 'ลบ ABBYY Skill',
  link_google: 'ผูกบัญชี Google',
  link_staff_line: 'ผูก LINE (ทีมงาน)',
  link_employee_line: 'ผูก LINE (พนักงาน)',
  employee_submitted_timesheet_file: 'พนักงานส่งไฟล์ Timesheet',
  notify_overdue_timesheet: 'เตือน Timesheet เกินกำหนด',
};

function labelOf(action: string): string {
  return ACTION_TH[action] ?? action.replace(/_/g, ' ');
}

function isPlain(v: unknown): v is string | number | boolean | null {
  return v === null || ['string', 'number', 'boolean'].includes(typeof v);
}

/** แสดง detail เป็นการ์ดคีย์-ค่าที่อ่านง่าย — ค่าซ้อนกันหลายชั้น (object/array) แสดงเป็น JSON ในกล่องโค้ดแทน */
function DetailView({ detail }: { detail: unknown }) {
  const { tx } = useLang();
  if (detail === null || detail === undefined || detail === '') {
    return <span className="al-none">{tx('ไม่มีรายละเอียดเพิ่มเติม')}</span>;
  }
  if (isPlain(detail) || Array.isArray(detail) || typeof detail !== 'object') {
    return <pre className="al-pre">{typeof detail === 'string' ? detail : JSON.stringify(detail, null, 2)}</pre>;
  }
  const entries = Object.entries(detail as Record<string, unknown>);
  if (entries.length === 0) return <span className="al-none">{tx('ไม่มีรายละเอียดเพิ่มเติม')}</span>;
  return (
    <div className="al-kv">
      {entries.map(([k, v]) => (
        <div key={k} className={isPlain(v) ? '' : 'wide'}>
          <span>{k}</span>
          {isPlain(v) ? <b>{v === null || v === '' ? '—' : String(v)}</b> : <pre className="al-pre" style={{ marginTop: 6 }}>{JSON.stringify(v, null, 2)}</pre>}
        </div>
      ))}
    </div>
  );
}

const GRID = '38px minmax(200px, 1.5fr) minmax(170px, 1.2fr) minmax(150px, 1fr) 150px 22px';

/** เดิมดึงทีเดียว 200 แถวสุดท้ายแล้วจบ ดูแถวเก่ากว่านั้นไม่ได้เลย (เจ้าของระบบสั่ง 24 ก.ย. 69 "ตาราง
 * activity ต้องทำ lazy loading เพื่อ performance") เปลี่ยนเป็นแบ่งหน้าจริงแบบเดียวกับแท็บ "API Activity
 * Log" ข้างๆ กัน — ปุ่มหน้าถัดไป/ก่อนหน้า ไม่ต้องดึงข้อมูลทั้งหมดมาไว้ในเบราว์เซอร์ทีเดียว
 *
 * ดีไซน์ใหม่ 8 ต.ค. 69: แถวเป็นการ์ดแบนมีแถบสีซ้ายตามชนิดการกระทำ · กรองตามชนิดได้ (เฉพาะแถวในหน้าที่โหลดอยู่) ·
 * กดแถวเพื่อดูรายละเอียดเป็นการ์ดคีย์-ค่า */
export default function AuditLogTab() {
  const { tx, formatDateTime } = useLang();
  const [rows, setRows] = useState<AuditLogRow[] | null>(null);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tone, setTone] = useState<Tone | 'all'>('all');
  const [q, setQ] = useState('');
  const [open, setOpen] = useState<number | null>(null);

  function load() {
    setLoading(true);
    setError(null);
    // ล้างแถวเดิมก่อนโหลดหน้าใหม่ — เดิมแถวของหน้าก่อนค้างอยู่จนกว่าข้อมูลหน้าใหม่จะมา ช่วงนั้นดูเหมือน "กดหน้าถัดไปแล้ว
    // ยังเป็นแถวแรกของหน้า 1" (QA ADMIN-011, 1 ต.ค. 69 — เซิร์ฟเวอร์/พร็อกซีแบ่งหน้าถูกอยู่แล้ว ตรวจกับ 125 แถวแล้ว)
    setRows(null);
    setOpen(null);
    fetch(`/api/audit-log?page=${page}&pageSize=${PAGE_SIZE}`, { cache: 'no-store' })
      .then(async (r) => {
        if (!r.ok) {
          const data = await r.json().catch(() => ({}));
          setError(data.error ?? tx('โหลดข้อมูลไม่สำเร็จ'));
          return;
        }
        const data = await r.json();
        setRows(data.rows);
        setTotal(data.total);
      })
      .catch(() => setError(tx('เชื่อมต่อเซิร์ฟเวอร์ไม่ได้')))
      .finally(() => setLoading(false));
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(load, [page]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const rangeFrom = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const rangeTo = Math.min(page * PAGE_SIZE, total);

  const counts = useMemo(() => {
    const c: Record<Tone, number> = { ok: 0, info: 0, warn: 0, err: 0, sys: 0, mut: 0 };
    for (const r of rows ?? []) c[toneOf(r.action)]++;
    return c;
  }, [rows]);

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (rows ?? []).filter((r) => {
      if (tone !== 'all' && toneOf(r.action) !== tone) return false;
      if (!needle) return true;
      return [r.actor, r.action, labelOf(r.action), r.entityType, r.entityId].some((s) => (s ?? '').toLowerCase().includes(needle));
    });
  }, [rows, tone, q]);

  const TONES: Tone[] = ['err', 'warn', 'ok', 'info', 'sys', 'mut'];

  return (
    <Card title={tx('บันทึกระบบ (Audit log)')} right={<span className="sub">{loading ? tx('กำลังโหลด…') : `${rangeFrom.toLocaleString()} ${tx('ถึง')} ${rangeTo.toLocaleString()} ${tx('จาก')} ${total.toLocaleString()} ${tx('รายการ')}`}</span>}>
      <div className="al">
        {error ? (
          <ErrorState message={error} onRetry={load} />
        ) : (
          <>
            <div className="al-bar">
              <div className="al-search grow">
                <Icon name="search" />
                <input
                  type="text"
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder={tx('ค้นหาผู้ทำ / การกระทำ / เป้าหมาย (ในหน้านี้)')}
                  aria-label={tx('ค้นหาบันทึกระบบ')}
                />
              </div>
              <div className="al-seg" role="group" aria-label={tx('กรองตามชนิด')}>
                <button type="button" className={tone === 'all' ? 'on' : ''} onClick={() => setTone('all')}>
                  {tx('ทั้งหมด')} <span className="al-mut">{rows?.length ?? 0}</span>
                </button>
                {TONES.filter((t) => counts[t] > 0 || tone === t).map((t) => (
                  <button key={t} type="button" className={`t-${t}${tone === t ? ' on' : ''}`} onClick={() => setTone(tone === t ? 'all' : t)}>
                    <i />
                    {tx(TONE_LABEL[t])} <span className="al-mut">{counts[t]}</span>
                  </button>
                ))}
              </div>
            </div>

            <div className="al-list">
              <div className="al-cols" style={{ gridTemplateColumns: GRID }}>
                <span />
                <span>{tx('การกระทำ')}</span>
                <span>{tx('เป้าหมาย')}</span>
                <span>{tx('ผู้ทำ')}</span>
                <span>{tx('เวลา')}</span>
                <span />
              </div>

              {!rows && <Loading rows={4} />}

              {shown.map((r) => {
                const t = toneOf(r.action);
                const isOpen = open === r.id;
                const isSystem = r.actor === 'cli' || r.actor === 'system' || r.actor === 'ระบบ';
                return (
                  <div key={r.id} className={`al-item t-${t}${isOpen ? ' open' : ''}`}>
                    <button type="button" className="al-row-h" style={{ gridTemplateColumns: GRID }} aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : r.id)}>
                      <span className="al-ic">
                        <Icon name={TONE_ICON[t]} className="sm" />
                      </span>
                      <span className="al-two al-ell">
                        <b className="al-ell">{tx(labelOf(r.action))}</b>
                        <span className="al-ell">{r.action}</span>
                      </span>
                      <span className="al-tgt">
                        {r.entityType ? (
                          <>
                            <em>{r.entityType}</em>
                            <span title={r.entityId ?? ''}>{r.entityId ?? '—'}</span>
                          </>
                        ) : (
                          <span className="al-mut">—</span>
                        )}
                      </span>
                      <span className="al-actor">
                        <span className={`al-av${isSystem ? ' sys' : ''}`}>{(r.actor || '?').trim().charAt(0).toUpperCase()}</span>
                        <span className="al-ell al-strong">{r.actor}</span>
                      </span>
                      <span className="al-mut" style={{ whiteSpace: 'nowrap' }}>{formatDateTime(r.at)}</span>
                      <span className="al-chev">
                        <Icon name="chev" className="sm" />
                      </span>
                    </button>
                    {isOpen && (
                      <div className="al-body">
                        <div className="al-kv">
                          <div><span>{tx('ชนิด')}</span><b><span className="al-pill"><i />{tx(TONE_LABEL[t])}</span></b></div>
                          <div><span>{tx('ผู้ทำ')}</span><b>{r.actor}</b></div>
                          <div><span>{tx('เวลา')}</span><b>{formatDateTime(r.at)}</b></div>
                          <div><span>Log ID</span><b>#{r.id}</b></div>
                        </div>
                        <div className="al-sec">
                          <h5>{tx('รายละเอียด')}</h5>
                          <DetailView detail={r.detail} />
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}

              {rows && shown.length === 0 && (
                <div className="al-empty">{rows.length === 0 ? tx('ยังไม่มีบันทึก') : tx('ไม่พบรายการที่ตรงกับตัวกรองในหน้านี้')}</div>
              )}
            </div>

            <div className="al-foot">
              <span className="al-mut">{tx('ตัวกรองและช่องค้นหาทำงานกับรายการในหน้าที่แสดงอยู่เท่านั้น')}</span>
              <div className="al-pg">
                <button type="button" disabled={loading || page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))} aria-label={tx('หน้าก่อนหน้า')}>
                  ‹
                </button>
                <span>
                  {page} / {totalPages}
                </span>
                <button type="button" disabled={loading || page >= totalPages} onClick={() => setPage((p) => Math.min(totalPages, p + 1))} aria-label={tx('หน้าถัดไป')}>
                  ›
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </Card>
  );
}

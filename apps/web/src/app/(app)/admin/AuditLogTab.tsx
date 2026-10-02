'use client';

import { useEffect, useState } from 'react';
import { Card, ErrorState, Loading } from '../../../components/ui';
import { useLang } from '../../../lib/language';

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

/** เดิมดึงทีเดียว 200 แถวสุดท้ายแล้วจบ ดูแถวเก่ากว่านั้นไม่ได้เลย (เจ้าของระบบสั่ง 24 ก.ย. 69 "ตาราง
 * activity ต้องทำ lazy loading เพื่อ performance") เปลี่ยนเป็นแบ่งหน้าจริงแบบเดียวกับแท็บ "API Activity
 * Log" ข้างๆ กัน — ปุ่มหน้าถัดไป/ก่อนหน้า ไม่ต้องดึงข้อมูลทั้งหมดมาไว้ในเบราว์เซอร์ทีเดียว */
export default function AuditLogTab() {
  const { tx } = useLang();
  const [rows, setRows] = useState<AuditLogRow[] | null>(null);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function load() {
    setLoading(true);
    setError(null);
    // ล้างแถวเดิมก่อนโหลดหน้าใหม่ — เดิมแถวของหน้าก่อนค้างอยู่จนกว่าข้อมูลหน้าใหม่จะมา ช่วงนั้นดูเหมือน "กดหน้าถัดไปแล้ว
    // ยังเป็นแถวแรกของหน้า 1" (QA ADMIN-011, 1 ต.ค. 69 — เซิร์ฟเวอร์/พร็อกซีแบ่งหน้าถูกอยู่แล้ว ตรวจกับ 125 แถวแล้ว)
    setRows(null);
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

  return (
    <Card
      title={tx('บันทึกระบบ (Audit log)')}
      right={
        <span className="sub">
          {loading ? tx('กำลังโหลด…') : `${rangeFrom.toLocaleString()} ${tx('ถึง')} ${rangeTo.toLocaleString()} ${tx('จาก')} ${total.toLocaleString()} ${tx('รายการ')}`}
        </span>
      }
    >
      {error ? (
        <ErrorState message={error} onRetry={load} />
      ) : (
      <div className="tw">
        <table>
          <thead>
            <tr>
              <th>{tx('เวลา')}</th>
              <th>{tx('ผู้ทำ')}</th>
              <th>{tx('การกระทำ')}</th>
              <th>{tx('เป้าหมาย')}</th>
              <th>{tx('รายละเอียด')}</th>
            </tr>
          </thead>
          <tbody>
            {rows?.map((r) => (
              <tr key={r.id}>
                <td className="sub" style={{ whiteSpace: 'nowrap' }}>
                  {r.at.replace('T', ' ').slice(0, 19)}
                </td>
                <td>{r.actor}</td>
                <td className="docid">{r.action}</td>
                <td className="sub">{r.entityType ? `${r.entityType} · ${r.entityId ?? ''}` : '—'}</td>
                <td>
                  {r.detail ? (
                    <details>
                      <summary style={{ cursor: 'pointer', color: 'var(--mut)' }}>▶ {tx('รายละเอียด')}</summary>
                      <pre style={{ fontSize: 12, whiteSpace: 'pre-wrap', margin: '6px 0 0' }}>{JSON.stringify(r.detail, null, 2)}</pre>
                    </details>
                  ) : (
                    '—'
                  )}
                </td>
              </tr>
            ))}
            {!rows && (
              <tr>
                <td colSpan={5}>
                  <Loading rows={4} />
                </td>
              </tr>
            )}
            {rows && rows.length === 0 && (
              <tr>
                <td colSpan={5} style={{ textAlign: 'center', color: 'var(--mut)' }}>
                  {tx('ยังไม่มีบันทึก')}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      )}
      {!error && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 10, marginTop: 14 }}>
          <button type="button" className="btn ghost sm" disabled={loading || page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>
            ‹
          </button>
          <span className="sub">{page} / {totalPages}</span>
          <button type="button" className="btn ghost sm" disabled={loading || page >= totalPages} onClick={() => setPage((p) => Math.min(totalPages, p + 1))}>
            ›
          </button>
        </div>
      )}
    </Card>
  );
}

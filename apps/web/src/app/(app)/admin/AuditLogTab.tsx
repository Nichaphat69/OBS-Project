'use client';

import { useEffect, useState } from 'react';
import { Card, ErrorState } from '../../../components/ui';
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

export default function AuditLogTab() {
  const { tx } = useLang();
  const [rows, setRows] = useState<AuditLogRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  function load() {
    setError(null);
    fetch('/api/audit-log?limit=200', { cache: 'no-store' })
      .then(async (r) => {
        if (!r.ok) {
          const data = await r.json().catch(() => ({}));
          setError(data.error ?? tx('โหลดข้อมูลไม่สำเร็จ'));
          return;
        }
        setRows(await r.json());
      })
      .catch(() => setError(tx('เชื่อมต่อเซิร์ฟเวอร์ไม่ได้')));
  }

  useEffect(load, []);

  return (
    <Card title={tx('บันทึกระบบ (Audit log)')} right={<span className="sub">{tx('ล่าสุด')} 200 {tx('รายการ')}</span>}>
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
    </Card>
  );
}
